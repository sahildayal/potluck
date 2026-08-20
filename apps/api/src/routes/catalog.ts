import { and, asc, desc, eq, gte, sql as raw, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { parseIngredient, primaryDuration } from '@potluck/core';
import { asUser } from '../db/client.js';
import { catalogRecipes, ingredients, recipes, steps } from '../db/schema.js';
import { currentUserId, requireUser, type AppEnv } from '../middleware/session.js';

/**
 * The public catalog.
 *
 * Search happens in Postgres, not the browser. The personal collection is a
 * thousand short rows and filtering it client-side is instant; the catalog is
 * an order of magnitude larger and growing, and shipping it to a phone to grep
 * would be absurd.
 *
 * Two matchers, because they answer different questions. Full-text handles real
 * queries with stemming and relevance ranking. Trigram similarity catches the
 * typos and half-words that a tsvector simply misses — "chiken" and "shakshu"
 * find nothing by full-text and match fine by trigram.
 */

const browseQuery = z.object({
  q: z.string().max(120).optional(),
  meal: z.string().max(40).optional(),
  cuisine: z.string().max(60).optional(),
  minProtein: z.coerce.number().min(0).max(200).optional(),
  sort: z.enum(['relevance', 'protein', 'quick', 'newest']).default('relevance'),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export function catalogRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireUser);

  /** Facets for the filter UI, so the client never invents a cuisine. */
  app.get('/facets', async (c) => {
    const [cuisines, meals, total] = await asUser(currentUserId(c), async (tx) => {
      return Promise.all([
        tx
          .select({ value: catalogRecipes.cuisine, count: raw<number>`count(*)::int` })
          .from(catalogRecipes)
          .groupBy(catalogRecipes.cuisine)
          .orderBy(desc(raw`count(*)`)),
        tx
          .select({ value: catalogRecipes.mealType, count: raw<number>`count(*)::int` })
          .from(catalogRecipes)
          .groupBy(catalogRecipes.mealType)
          .orderBy(desc(raw`count(*)`)),
        tx.select({ count: raw<number>`count(*)::int` }).from(catalogRecipes),
      ]);
    });

    return c.json({ cuisines, meals, total: total[0]?.count ?? 0 });
  });

  app.get('/', async (c) => {
    const parsed = browseQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: 'Invalid search' }, 400);
    const { q, meal, cuisine, minProtein, sort, limit, offset } = parsed.data;

    const term = q?.trim() ?? '';
    const searching = term.length > 0;

    const filters: SQL[] = [];
    if (meal !== undefined && meal.length > 0) filters.push(eq(catalogRecipes.mealType, meal));
    if (cuisine !== undefined && cuisine.length > 0) {
      filters.push(eq(catalogRecipes.cuisine, cuisine));
    }
    if (minProtein !== undefined) filters.push(gte(catalogRecipes.proteinGrams, minProtein));

    if (searching) {
      // websearch_to_tsquery understands quotes and OR the way people type into
      // a search box, and — unlike to_tsquery — never throws on odd input.
      // `<%` is word_similarity, not `%` (whole-string similarity). Against a
      // long title a short typo scores far below the 0.3 threshold — "chiken"
      // vs "Greek Chicken & Veggie Stir-Fry" is barely similar as whole
      // strings, but matches one word of it closely. `%` returned nothing for
      // every typo; `<%` is what makes the trigram index earn its place.
      filters.push(
        raw`(search_vector @@ websearch_to_tsquery('english', ${term})
             OR ${term} <% title)`,
      );
    }

    const where = filters.length > 0 ? and(...filters) : undefined;

    const rank = raw<number>`
      ts_rank(search_vector, websearch_to_tsquery('english', ${term}))
      + word_similarity(${term}, title)`;

    const order =
      sort === 'protein'
        ? [desc(catalogRecipes.proteinGrams)]
        : sort === 'quick'
          ? [asc(catalogRecipes.totalMinutes)]
          : sort === 'newest'
            ? [desc(catalogRecipes.createdAt)]
            : searching
              ? [desc(rank)]
              : [desc(catalogRecipes.proteinGrams)];

    const { rows, total } = await asUser(currentUserId(c), async (tx) => {
      if (searching) {
        // The `<%` operator tests against pg_trgm.word_similarity_threshold,
        // which defaults to 0.6. "chiken" scores about 0.57 against "chicken"
        // — just under, so the single most likely typo in a recipe app found
        // nothing. 0.42 catches realistic misspellings without matching
        // unrelated words. SET LOCAL so it dies with the transaction rather
        // than leaking onto the next request through the pool.
        await tx.execute(raw`SET LOCAL pg_trgm.word_similarity_threshold = 0.42`);
      }

      const listed = await tx
        .select({
          id: catalogRecipes.id,
          slug: catalogRecipes.slug,
          title: catalogRecipes.title,
          summary: catalogRecipes.summary,
          cuisine: catalogRecipes.cuisine,
          mealType: catalogRecipes.mealType,
          mainProtein: catalogRecipes.mainProtein,
          tags: catalogRecipes.tags,
          servings: catalogRecipes.servings,
          totalMinutes: catalogRecipes.totalMinutes,
          difficulty: catalogRecipes.difficulty,
          proteinGrams: catalogRecipes.proteinGrams,
          calories: catalogRecipes.calories,
        })
        .from(catalogRecipes)
        .where(where)
        .orderBy(...order)
        .limit(limit)
        .offset(offset);

      const counted = await tx
        .select({ count: raw<number>`count(*)::int` })
        .from(catalogRecipes)
        .where(where);

      return { rows: listed, total: counted[0]?.count ?? 0 };
    });

    return c.json({ recipes: rows, total, limit, offset });
  });

  app.get('/:slug', async (c) => {
    const rows = await asUser(currentUserId(c), (tx) =>
      tx.select().from(catalogRecipes).where(eq(catalogRecipes.slug, c.req.param('slug'))).limit(1),
    );
    const recipe = rows[0];
    if (recipe === undefined) return c.json({ error: 'Not found' }, 404);
    return c.json({ recipe });
  });

  /**
   * "Make it" — copies a catalog recipe into the caller's own collection.
   *
   * A copy, not a reference: once it is yours you can rate it, tweak the salt
   * and cook from it, and the catalog original stays pristine. Exactly the same
   * semantics as forking a friend's recipe, which is why the shapes match.
   */
  app.post('/:slug/save', async (c) => {
    const userId = currentUserId(c);
    const slug = c.req.param('slug');

    const saved = await asUser(userId, async (tx) => {
      const found = await tx
        .select()
        .from(catalogRecipes)
        .where(eq(catalogRecipes.slug, slug))
        .limit(1);
      const source = found[0];
      if (source === undefined) return null;

      const sourceIngredients = source.ingredients as { rawText: string }[];
      const sourceSteps = source.steps as { body: string; durationSeconds: number | null }[];

      const created = await tx
        .insert(recipes)
        .values({
          ownerId: userId,
          title: source.title,
          servings: source.servings,
          notes: source.summary,
          sourceType: 'catalog',
          attributedTo: '',
        })
        .returning();

      const recipe = created[0];
      if (recipe === undefined) return null;

      if (sourceIngredients.length > 0) {
        await tx.insert(ingredients).values(
          sourceIngredients.map((line, index) => {
            // Re-parse rather than trusting the catalog's own numbers: the
            // canonical quantities are what the scaler and shopping-list merge
            // depend on, and they must be derived the same way for every entry
            // point into the app.
            const parsed = parseIngredient(line.rawText);
            return {
              recipeId: recipe.id,
              ownerId: userId,
              position: index,
              rawText: line.rawText,
              item: parsed.item,
              qtyCanonical: parsed.qty,
              unitCanonical: parsed.unit,
              dimension: parsed.dimension,
            };
          }),
        );
      }

      if (sourceSteps.length > 0) {
        await tx.insert(steps).values(
          sourceSteps.map((step, index) => ({
            recipeId: recipe.id,
            ownerId: userId,
            position: index,
            body: step.body,
            durationSeconds: step.durationSeconds ?? primaryDuration(step.body),
          })),
        );
      }

      return recipe;
    });

    if (saved === null) return c.json({ error: 'Not found' }, 404);
    return c.json({ recipe: { id: saved.id, title: saved.title } }, 201);
  });

  return app;
}
