-- =============================================================================
-- Catalog full-text search
-- =============================================================================
-- The personal collection is small enough to filter in the browser. The public
-- catalog is not — it is thousands of rows and growing, and shipping it to a
-- phone to grep would be absurd. So catalog search happens in Postgres.
--
-- Two indexes, because they answer different questions:
--
--   * a GIN index over a generated tsvector handles real search — stemming, so
--     "grilled chicken" matches "grill the chicken", and ranking by relevance.
--   * a trigram index handles typos and partial words, which full-text search
--     is bad at: "chiken" and "shakshu" find nothing in a tsvector but match
--     fine by trigram similarity. Queried with the word_similarity operator
--     `<%`, not `%` — whole-string similarity between a short query and a long
--     title is always below threshold, so `%` silently matches nothing.
--
-- Run after migrations, and idempotent, because it re-runs on every deploy.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Weighted so a title match outranks a tag match, which outranks an ingredient
-- mention. Without weights, a recipe that merely lists chicken ranks equally
-- with one actually called "Chicken Shawarma".
--
-- Ingredients come from the flat ingredients_text column rather than the jsonb:
-- generated columns may not contain subqueries, so jsonb_array_elements is not
-- available here.
--
-- Tags are flattened into tags_text for the same reason: array_to_string is
-- STABLE rather than IMMUTABLE, so Postgres rejects it inside a generated
-- column with "generation expression is not immutable". Both flat columns are
-- written by the seeder alongside their structured originals.
ALTER TABLE catalog_recipes
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
      setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A')
   || setweight(to_tsvector('english'::regconfig, coalesce(main_protein, '')), 'B')
   || setweight(to_tsvector('english'::regconfig, coalesce(cuisine, '')), 'B')
   || setweight(to_tsvector('english'::regconfig, coalesce(tags_text, '')), 'B')
   || setweight(to_tsvector('english'::regconfig, coalesce(summary, '')), 'C')
   || setweight(to_tsvector('english'::regconfig, coalesce(ingredients_text, '')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS catalog_recipes_search_idx
  ON catalog_recipes USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS catalog_recipes_title_trgm_idx
  ON catalog_recipes USING GIN (title gin_trgm_ops);

-- The catalog is world-readable to signed-in users and writable by nobody
-- through the app. Note the absence of INSERT/UPDATE/DELETE policies: with RLS
-- forced and no policy, those operations are denied outright, so the seed
-- pipeline running as the owner is the only writer.
ALTER TABLE catalog_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_recipes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_read ON catalog_recipes;
CREATE POLICY catalog_read ON catalog_recipes FOR SELECT USING (true);

REVOKE ALL ON catalog_recipes FROM potluck_app;
GRANT SELECT ON catalog_recipes TO potluck_app;
