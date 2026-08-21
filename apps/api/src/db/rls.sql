-- =============================================================================
-- Row-Level Security
-- =============================================================================
-- This file is the security spine of Potluck. Every authorization rule that
-- matters is expressed here, evaluated by Postgres itself, so a mistake in an
-- API handler cannot leak one user's recipes to another.
--
-- Two things make that guarantee real:
--
--   1. FORCE ROW LEVEL SECURITY — without it, policies are skipped for the
--      table's owner, and on a managed Postgres the app often connects as the
--      owner. FORCE closes that hole.
--   2. The app connects as `potluck_app`, a role with no BYPASSRLS attribute
--      and no table ownership. It cannot opt out even if it wanted to.
--
-- Identity is carried per-transaction via `SET LOCAL app.user_id`. Every
-- policy reads it through current_app_user(). A connection that forgets to set
-- it sees nothing at all, which is the correct failure direction.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Identity helper
-- ---------------------------------------------------------------------------
-- Returns NULL rather than raising when unset, so an un-scoped connection gets
-- an empty result set instead of an error that might get caught and ignored.
CREATE OR REPLACE FUNCTION current_app_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

-- Is a recipe visible to the current user? Owned, or shared and not revoked.
CREATE OR REPLACE FUNCTION can_read_recipe(target_recipe uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM recipes r
    WHERE r.id = target_recipe
      AND r.owner_id = current_app_user()
  ) OR EXISTS (
    SELECT 1 FROM recipe_shares s
    WHERE s.recipe_id = target_recipe
      AND s.recipient_id = current_app_user()
      AND s.revoked_at IS NULL
  );
$$;

-- ---------------------------------------------------------------------------
-- Application role
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'potluck_app') THEN
    CREATE ROLE potluck_app NOLOGIN NOBYPASSRLS;
  END IF;
  -- The auth handler needs its own identity: it must read sessions before it
  -- knows who the caller is, which is exactly the thing app.user_id gating
  -- cannot express. Splitting the role keeps that exception narrow and visible
  -- instead of punching a hole in the app role's policies.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'potluck_auth') THEN
    CREATE ROLE potluck_auth NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

-- The application connects as whatever login role the platform gives us
-- (neondb_owner on Neon, potluck_owner locally) and then assumes one of the two
-- roles above per transaction. That requires membership, and it is NOT granted
-- automatically: on Neon, CREATE ROLE by the owner does not confer admin on the
-- new role, so without this every SET LOCAL ROLE fails with "permission denied"
-- and the app silently runs as the owner — with none of the isolation applied.
GRANT potluck_app TO CURRENT_USER;
GRANT potluck_auth TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO potluck_app, potluck_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO potluck_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO potluck_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO potluck_app;

-- The app must never read invite codes directly; redemption goes through a
-- SECURITY DEFINER function so a code can be validated without the caller
-- being able to enumerate the table.
REVOKE ALL ON invite_codes FROM potluck_app;

-- Credentials and session tokens are off-limits to the application entirely.
-- Even a total compromise of a request handler cannot read a password hash or
-- steal a session token, because its role has no privilege on these tables.
REVOKE ALL ON sessions, accounts, verifications FROM potluck_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, accounts, verifications, users TO potluck_auth;

-- ---------------------------------------------------------------------------
-- Enable + force RLS everywhere
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'categories', 'recipes', 'ingredients', 'steps', 'recipe_photos',
    'recipe_categories', 'friendships', 'recipe_shares', 'attempts',
    'attempt_hides', 'shopping_items', 'import_jobs', 'invite_codes',
    'sessions', 'accounts', 'verifications'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Drop existing policies before recreating
-- ---------------------------------------------------------------------------
-- Postgres has no CREATE POLICY IF NOT EXISTS, and this file re-runs on every
-- deploy. Dropping first makes it genuinely declarative: what is written below
-- is exactly what the database ends up with, and deleting a policy from this
-- file actually removes it rather than leaving a stale rule enforcing something
-- nobody can find in source control.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT pol.polname, c.relname
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p.polname, p.relname);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Auth service access
-- ---------------------------------------------------------------------------
-- Scoped TO potluck_auth, so these policies simply do not exist for the
-- application role. This is the one place identity gating does not apply, and
-- confining it to three tables and one role is what keeps that honest.
CREATE POLICY sessions_auth ON sessions FOR ALL TO potluck_auth
  USING (true) WITH CHECK (true);
CREATE POLICY accounts_auth ON accounts FOR ALL TO potluck_auth
  USING (true) WITH CHECK (true);
CREATE POLICY verifications_auth ON verifications FOR ALL TO potluck_auth
  USING (true) WITH CHECK (true);
-- Signup has to create the user row before any session exists to identify them.
CREATE POLICY users_auth ON users FOR ALL TO potluck_auth
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- You can see yourself, anyone you have a friendship row with in EITHER
-- direction and at any status, and anyone who has shared a recipe with you.
--
-- Pending counts deliberately. Restricting this to accepted meant a pending
-- request joined against a user row you could not read, so the row vanished and
-- you could never see who was asking to be your friend. Someone who has sent
-- you a request has already revealed themselves to you by doing so.
CREATE POLICY users_read ON users FOR SELECT USING (
  id = current_app_user()
  OR EXISTS (
    SELECT 1 FROM friendships f
    WHERE (f.requester_id = current_app_user() AND f.addressee_id = users.id)
       OR (f.addressee_id = current_app_user() AND f.requester_id = users.id)
  )
  OR EXISTS (
    SELECT 1 FROM recipe_shares s
    WHERE s.revoked_at IS NULL
      AND ((s.owner_id = users.id AND s.recipient_id = current_app_user())
        OR (s.recipient_id = users.id AND s.owner_id = current_app_user()))
  )
);

CREATE POLICY users_update_self ON users FOR UPDATE
  USING (id = current_app_user())
  WITH CHECK (id = current_app_user());

-- ---------------------------------------------------------------------------
-- Owner-only tables
-- ---------------------------------------------------------------------------
-- categories, recipe_categories, shopping_items and import_jobs are private
-- with no sharing semantics at all, so one symmetrical policy covers each.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories', 'recipe_categories', 'shopping_items', 'import_jobs'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (owner_id = current_app_user())
         WITH CHECK (owner_id = current_app_user())',
      t || '_owner', t
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- recipes
-- ---------------------------------------------------------------------------
-- Read is owner-or-shared. Writes are owner-only: sharing a recipe never grants
-- edit rights on it. If a friend wants to change something, they fork it.
CREATE POLICY recipes_read ON recipes FOR SELECT USING (
  owner_id = current_app_user()
  OR EXISTS (
    SELECT 1 FROM recipe_shares s
    WHERE s.recipe_id = recipes.id
      AND s.recipient_id = current_app_user()
      AND s.revoked_at IS NULL
  )
);

CREATE POLICY recipes_insert ON recipes FOR INSERT
  WITH CHECK (owner_id = current_app_user());

CREATE POLICY recipes_update ON recipes FOR UPDATE
  USING (owner_id = current_app_user())
  WITH CHECK (owner_id = current_app_user());

CREATE POLICY recipes_delete ON recipes FOR DELETE
  USING (owner_id = current_app_user());

-- ---------------------------------------------------------------------------
-- Recipe children: ingredients, steps, photos
-- ---------------------------------------------------------------------------
-- Visible whenever the parent recipe is; writable only by the recipe's owner.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ingredients', 'steps', 'recipe_photos'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (
         owner_id = current_app_user() OR can_read_recipe(recipe_id))',
      t || '_read', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (owner_id = current_app_user())',
      t || '_insert', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (owner_id = current_app_user())
         WITH CHECK (owner_id = current_app_user())',
      t || '_update', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE USING (owner_id = current_app_user())',
      t || '_delete', t
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- friendships
-- ---------------------------------------------------------------------------
-- Either party can see the row. Only the requester creates it, and only the
-- addressee can accept it — which is why the UPDATE policy is asymmetric.
CREATE POLICY friendships_read ON friendships FOR SELECT USING (
  requester_id = current_app_user() OR addressee_id = current_app_user()
);

CREATE POLICY friendships_insert ON friendships FOR INSERT
  WITH CHECK (requester_id = current_app_user() AND addressee_id <> current_app_user());

CREATE POLICY friendships_update ON friendships FOR UPDATE
  USING (addressee_id = current_app_user())
  WITH CHECK (addressee_id = current_app_user());

CREATE POLICY friendships_delete ON friendships FOR DELETE USING (
  requester_id = current_app_user() OR addressee_id = current_app_user()
);

-- ---------------------------------------------------------------------------
-- recipe_shares
-- ---------------------------------------------------------------------------
-- Both sides see the share. Only the owner creates or revokes it, and only for
-- recipes they actually own — checked here rather than trusted from the API.
CREATE POLICY shares_read ON recipe_shares FOR SELECT USING (
  owner_id = current_app_user() OR recipient_id = current_app_user()
);

CREATE POLICY shares_insert ON recipe_shares FOR INSERT WITH CHECK (
  owner_id = current_app_user()
  AND EXISTS (
    SELECT 1 FROM recipes r WHERE r.id = recipe_id AND r.owner_id = current_app_user()
  )
);

CREATE POLICY shares_update ON recipe_shares FOR UPDATE
  USING (owner_id = current_app_user())
  WITH CHECK (owner_id = current_app_user());

CREATE POLICY shares_delete ON recipe_shares FOR DELETE
  USING (owner_id = current_app_user());

-- ---------------------------------------------------------------------------
-- attempts  ("I made this")
-- ---------------------------------------------------------------------------
-- Anyone who can see the recipe can see its attempts and post their own.
-- Only the cook can edit or delete theirs.
CREATE POLICY attempts_read ON attempts FOR SELECT USING (
  owner_id = current_app_user() OR can_read_recipe(recipe_id)
);

CREATE POLICY attempts_insert ON attempts FOR INSERT WITH CHECK (
  owner_id = current_app_user() AND can_read_recipe(recipe_id)
);

CREATE POLICY attempts_update ON attempts FOR UPDATE
  USING (owner_id = current_app_user())
  WITH CHECK (owner_id = current_app_user());

CREATE POLICY attempts_delete ON attempts FOR DELETE
  USING (owner_id = current_app_user());

-- The recipe owner may hide an attempt from their page, but only on a recipe
-- they own — and hiding never touches the cook's row.
CREATE POLICY attempt_hides_all ON attempt_hides FOR ALL
  USING (owner_id = current_app_user())
  WITH CHECK (
    owner_id = current_app_user()
    AND EXISTS (
      SELECT 1 FROM attempts a
      JOIN recipes r ON r.id = a.recipe_id
      WHERE a.id = attempt_id AND r.owner_id = current_app_user()
    )
  );

-- ---------------------------------------------------------------------------
-- invite_codes
-- ---------------------------------------------------------------------------
-- You can see codes you created, so the UI can show which are still unused.
-- Nobody can read the table looking for a valid code to redeem.
CREATE POLICY invite_codes_own ON invite_codes FOR SELECT
  USING (created_by = current_app_user());

CREATE POLICY invite_codes_insert ON invite_codes FOR INSERT
  WITH CHECK (created_by = current_app_user());

-- Redemption runs with the function owner's rights, atomically, and reveals
-- nothing beyond whether it worked.
CREATE OR REPLACE FUNCTION redeem_invite(p_code text, p_user uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE affected int;
BEGIN
  UPDATE invite_codes
     SET redeemed_by = p_user, redeemed_at = now()
   WHERE code = p_code
     AND redeemed_by IS NULL
     AND (expires_at IS NULL OR expires_at > now());
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END
$$;

-- ---------------------------------------------------------------------------
-- Finding someone by handle
-- ---------------------------------------------------------------------------
-- The users policy deliberately hides anyone you have no relationship with,
-- which is right — and which also makes it impossible to look up the person you
-- are trying to befriend, because you have no relationship with them yet.
--
-- This is the narrow, audited hole for that, and it is shaped so it cannot be
-- used to enumerate anyone: it takes an EXACT handle and returns at most one
-- row. There is no prefix match and no listing, so you can only find someone
-- whose handle you already know.
CREATE OR REPLACE FUNCTION find_user_by_handle(p_handle text)
RETURNS TABLE (id uuid, handle text, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id, u.handle, u.display_name
    FROM users u
   WHERE lower(u.handle) = lower(p_handle)
     AND u.id <> current_app_user()
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION find_user_by_handle(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_user_by_handle(text) TO potluck_app;

REVOKE ALL ON FUNCTION redeem_invite(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_invite(text, uuid) TO potluck_app;
GRANT EXECUTE ON FUNCTION current_app_user() TO potluck_app;
GRANT EXECUTE ON FUNCTION can_read_recipe(uuid) TO potluck_app;
