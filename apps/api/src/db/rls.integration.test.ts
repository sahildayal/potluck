import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';

/**
 * These tests are the proof behind the security claim in the architecture doc.
 *
 * They do not test that the API remembers to filter by owner — they test that
 * it does not matter whether it remembers. Every query below is written the way
 * a careless handler would write it: no WHERE owner_id clause anywhere. If any
 * of them return another user's data, row-level security is not doing its job.
 */

let container: StartedPostgreSqlContainer;
let sql: postgres.Sql;

/** Alice owns everything; Bob is the user who must not see it. */
let alice: string;
let bob: string;
let carol: string;
let aliceRecipe: string;

/**
 * Runs a statement as the application role with an identity stamped on the
 * transaction — exactly what asUser() does in production.
 */
async function as<T>(userId: string | null, run: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE potluck_app`;
    if (userId !== null) {
      await tx`SELECT set_config('app.user_id', ${userId}, true)`;
    }
    return run(tx);
  }) as Promise<T>;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('potluck')
    .withUsername('potluck_owner')
    .withPassword('test-password')
    .start();

  const url = container.getConnectionUri();
  await runMigrations(url);
  sql = postgres(url, { max: 4, prepare: false });

  // The app role must be able to assume its identity from the owner session.
  await sql`GRANT potluck_app TO potluck_owner`;
  await sql`GRANT potluck_auth TO potluck_owner`;

  const [a] = await sql<{ id: string }[]>`
    INSERT INTO users (handle, display_name, email)
    VALUES ('alice', 'Alice', 'alice@example.com') RETURNING id`;
  const [b] = await sql<{ id: string }[]>`
    INSERT INTO users (handle, display_name, email)
    VALUES ('bob', 'Bob', 'bob@example.com') RETURNING id`;
  const [c] = await sql<{ id: string }[]>`
    INSERT INTO users (handle, display_name, email)
    VALUES ('carol', 'Carol', 'carol@example.com') RETURNING id`;

  alice = a!.id;
  bob = b!.id;
  carol = c!.id;

  const [r] = await sql<{ id: string }[]>`
    INSERT INTO recipes (owner_id, title, servings)
    VALUES (${alice}, 'Alice''s Biryani', 4) RETURNING id`;
  aliceRecipe = r!.id;

  await sql`
    INSERT INTO ingredients (recipe_id, owner_id, position, raw_text, item)
    VALUES (${aliceRecipe}, ${alice}, 0, '500 g basmati rice', 'basmati rice')`;
}, 180_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await container?.stop();
});

describe('recipe isolation', () => {
  it('lets the owner read their own recipe', async () => {
    const rows = await as(alice, (tx) => tx`SELECT id, title FROM recipes`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!['title']).toBe("Alice's Biryani");
  });

  it('returns nothing to a user with no relationship to the recipe', async () => {
    // Note the query: no owner filter. A buggy handler would leak here.
    const rows = await as(bob, (tx) => tx`SELECT id, title FROM recipes`);
    expect(rows).toHaveLength(0);
  });

  it('refuses a direct fetch by primary key, which is the real attack', async () => {
    // Guessing or leaking an id must not be enough to read the row.
    const rows = await as(bob, (tx) => tx`SELECT * FROM recipes WHERE id = ${aliceRecipe}`);
    expect(rows).toHaveLength(0);
  });

  it('hides child rows too, so ingredients cannot be read around the recipe', async () => {
    const rows = await as(bob, (tx) => tx`SELECT * FROM ingredients`);
    expect(rows).toHaveLength(0);
  });

  it('shows nothing at all to a connection that never set an identity', async () => {
    // The failure direction matters: forgetting to scope shows zero rows,
    // not every row.
    const rows = await as(null, (tx) => tx`SELECT * FROM recipes`);
    expect(rows).toHaveLength(0);
  });

  it('does not let another user update a recipe', async () => {
    await as(bob, (tx) => tx`UPDATE recipes SET title = 'Bob''s now' WHERE id = ${aliceRecipe}`);
    const rows = await as(alice, (tx) => tx`SELECT title FROM recipes WHERE id = ${aliceRecipe}`);
    expect(rows[0]!['title']).toBe("Alice's Biryani");
  });

  it('does not let another user delete a recipe', async () => {
    await as(bob, (tx) => tx`DELETE FROM recipes WHERE id = ${aliceRecipe}`);
    const rows = await as(alice, (tx) => tx`SELECT id FROM recipes WHERE id = ${aliceRecipe}`);
    expect(rows).toHaveLength(1);
  });

  it('stops a user forging a recipe owned by someone else', async () => {
    await expect(
      as(bob, (tx) => tx`INSERT INTO recipes (owner_id, title) VALUES (${alice}, 'forged')`),
    ).rejects.toThrow();
  });
});

describe('sharing', () => {
  it('makes a shared recipe readable, and only to the recipient', async () => {
    await as(alice, (tx) => tx`
      INSERT INTO recipe_shares (recipe_id, owner_id, recipient_id)
      VALUES (${aliceRecipe}, ${alice}, ${bob})`);

    const bobSees = await as(bob, (tx) => tx`SELECT id FROM recipes`);
    expect(bobSees).toHaveLength(1);

    // Carol was not shared with and must still see nothing.
    const carolSees = await as(carol, (tx) => tx`SELECT id FROM recipes`);
    expect(carolSees).toHaveLength(0);
  });

  it('exposes the shared recipe ingredients as well', async () => {
    const rows = await as(bob, (tx) => tx`SELECT raw_text FROM ingredients`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!['raw_text']).toBe('500 g basmati rice');
  });

  it('still refuses edits — sharing grants reading, never writing', async () => {
    await as(bob, (tx) => tx`UPDATE recipes SET title = 'edited' WHERE id = ${aliceRecipe}`);
    const rows = await as(alice, (tx) => tx`SELECT title FROM recipes WHERE id = ${aliceRecipe}`);
    expect(rows[0]!['title']).toBe("Alice's Biryani");
  });

  it('revokes access when the share is revoked', async () => {
    await as(alice, (tx) => tx`
      UPDATE recipe_shares SET revoked_at = now()
      WHERE recipe_id = ${aliceRecipe} AND recipient_id = ${bob}`);

    const rows = await as(bob, (tx) => tx`SELECT id FROM recipes`);
    expect(rows).toHaveLength(0);

    // Put it back for the attempts tests below.
    await as(alice, (tx) => tx`
      UPDATE recipe_shares SET revoked_at = NULL
      WHERE recipe_id = ${aliceRecipe} AND recipient_id = ${bob}`);
  });

  it('stops a user sharing a recipe they do not own', async () => {
    await expect(
      as(bob, (tx) => tx`
        INSERT INTO recipe_shares (recipe_id, owner_id, recipient_id)
        VALUES (${aliceRecipe}, ${bob}, ${carol})`),
    ).rejects.toThrow();
  });
});

describe('attempts — "I made this"', () => {
  it('lets someone with access post an attempt on the recipe', async () => {
    const rows = await as(bob, (tx) => tx`
      INSERT INTO attempts (recipe_id, owner_id, bytes, byte_size, caption)
      VALUES (${aliceRecipe}, ${bob}, '\x89504e47'::bytea, 4, 'mine collapsed')
      RETURNING id`);
    expect(rows).toHaveLength(1);
  });

  it('refuses an attempt from someone who cannot see the recipe', async () => {
    await expect(
      as(carol, (tx) => tx`
        INSERT INTO attempts (recipe_id, owner_id, bytes, byte_size)
        VALUES (${aliceRecipe}, ${carol}, '\x89504e47'::bytea, 4)`),
    ).rejects.toThrow();
  });

  it("does not let the recipe owner rewrite the cook's caption", async () => {
    // Alice owns the recipe but not Bob's photo of it.
    await as(alice, (tx) => tx`UPDATE attempts SET caption = 'rewritten by Alice'`);
    const rows = await as(bob, (tx) => tx`SELECT caption FROM attempts`);
    expect(rows[0]!['caption']).toBe('mine collapsed');
  });

  it('does let the recipe owner hide an attempt from their page', async () => {
    const [attempt] = await as(bob, (tx) => tx`SELECT id FROM attempts LIMIT 1`);
    const rows = await as(alice, (tx) => tx`
      INSERT INTO attempt_hides (attempt_id, owner_id)
      VALUES (${attempt!['id'] as string}, ${alice}) RETURNING attempt_id`);
    expect(rows).toHaveLength(1);
  });
});

describe('recipe photos', () => {
  it('lets the owner attach a photo to their own recipe', async () => {
    const rows = await as(alice, (tx) => tx`
      INSERT INTO recipe_photos (recipe_id, owner_id, bytes, byte_size)
      VALUES (${aliceRecipe}, ${alice}, '\x89504e47'::bytea, 4)
      RETURNING id`);
    expect(rows).toHaveLength(1);
  });

  it('stops someone who can only read the recipe from attaching a photo to it', async () => {
    // Bob has a live share on aliceRecipe from the sharing tests above, so he
    // can read it — reading must not be enough to write a photo onto it.
    await expect(
      as(bob, (tx) => tx`
        INSERT INTO recipe_photos (recipe_id, owner_id, bytes, byte_size)
        VALUES (${aliceRecipe}, ${bob}, '\x89504e47'::bytea, 4)`),
    ).rejects.toThrow();
  });

  it('stops a forged recipe_id the caller has no relationship to at all', async () => {
    await expect(
      as(carol, (tx) => tx`
        INSERT INTO recipe_photos (recipe_id, owner_id, bytes, byte_size)
        VALUES (${aliceRecipe}, ${carol}, '\x89504e47'::bytea, 4)`),
    ).rejects.toThrow();
  });
});

describe('invite codes', () => {
  it('does not let the application role read the invite table at all', async () => {
    await expect(as(bob, (tx) => tx`SELECT * FROM invite_codes`)).rejects.toThrow();
  });

  it('redeems a valid code exactly once', async () => {
    await sql`INSERT INTO invite_codes (code, created_by) VALUES ('GOLDEN-TICKET', ${alice})`;

    const first = await as(bob, (tx) =>
      tx`SELECT redeem_invite('GOLDEN-TICKET', ${bob}) AS ok`);
    expect(first[0]!['ok']).toBe(true);

    const second = await as(carol, (tx) =>
      tx`SELECT redeem_invite('GOLDEN-TICKET', ${carol}) AS ok`);
    expect(second[0]!['ok']).toBe(false);
  });

  it('rejects an expired code', async () => {
    await sql`
      INSERT INTO invite_codes (code, created_by, expires_at)
      VALUES ('STALE', ${alice}, now() - interval '1 day')`;

    const result = await as(carol, (tx) => tx`SELECT redeem_invite('STALE', ${carol}) AS ok`);
    expect(result[0]!['ok']).toBe(false);
  });
});

describe('credential isolation', () => {
  it('does not let the application role read session tokens', async () => {
    // A compromised request handler must not be able to steal a session.
    await expect(as(alice, (tx) => tx`SELECT token FROM sessions`)).rejects.toThrow();
  });

  it('does not let the application role read password hashes', async () => {
    await expect(as(alice, (tx) => tx`SELECT password FROM accounts`)).rejects.toThrow();
  });

  it('does not let the application role read verification tokens', async () => {
    await expect(as(alice, (tx) => tx`SELECT value FROM verifications`)).rejects.toThrow();
  });

  it('does not let the application role write a session either', async () => {
    await expect(
      as(alice, (tx) => tx`
        INSERT INTO sessions (user_id, token, expires_at)
        VALUES (${alice}, 'forged-token', now() + interval '1 day')`),
    ).rejects.toThrow();
  });

  it('lets the auth role do its job', async () => {
    // The exception exists, is narrow, and is asserted rather than assumed.
    const rows = await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE potluck_auth`;
      await tx`
        INSERT INTO sessions (user_id, token, expires_at)
        VALUES (${alice}, 'real-token', now() + interval '1 day')`;
      return tx`SELECT token FROM sessions WHERE token = 'real-token'`;
    });
    expect(rows).toHaveLength(1);
  });

  it('confines the auth role to auth tables — it cannot read recipes', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE potluck_auth`;
        return tx`SELECT * FROM recipes`;
      }),
    ).rejects.toThrow();
  });
});

describe('production parity: the login role bypasses RLS', () => {
  /**
   * This is the most important test in the file and the least obvious.
   *
   * Neon's neondb_owner has rolbypassrls = true, and the container's owner is a
   * superuser, so in BOTH environments the role the app logs in as ignores every
   * policy. All the isolation above depends entirely on asUser() issuing
   * `SET LOCAL ROLE potluck_app` first. These two tests pin that down so nobody
   * later "simplifies" the role switch away and silently disables the lot.
   */
  it('leaks everything when the role is NOT switched — this is the failure mode', async () => {
    const rows = await sql`SELECT id FROM recipes`;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('blocks correctly the moment the role IS switched', async () => {
    const rows = await as(carol, (tx) => tx`SELECT id FROM recipes`);
    expect(rows).toHaveLength(0);
  });

  it('reports a login role that can bypass RLS, which is what the boot guard checks', async () => {
    const [login] = await sql<{ bypass: boolean }[]>`
      SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
    expect(login!.bypass).toBe(true);

    const [assumed] = await as(alice, (tx) => tx`
      SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`);
    expect(assumed!['bypass']).toBe(false);
  });
});

describe('policy coverage', () => {
  it('has row-level security enabled and forced on every user-data table', async () => {
    // This is the guard that stops a future table from shipping unprotected.
    const rows = await sql<{ tablename: string }[]>`
      SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname NOT IN ('__drizzle_migrations')
        AND (c.relrowsecurity = false OR c.relforcerowsecurity = false)`;

    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('has at least one policy on every table that has RLS enabled', async () => {
    const rows = await sql<{ tablename: string }[]>`
      SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relrowsecurity = true
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)`;

    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it('runs the application as a role that cannot bypass RLS', async () => {
    const rows = await sql<{ rolbypassrls: boolean }[]>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = 'potluck_app'`;
    expect(rows[0]!.rolbypassrls).toBe(false);
  });
});
