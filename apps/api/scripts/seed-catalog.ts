import postgres from 'postgres';
import { generateCatalog, type GeneratedRecipe } from '../src/catalog/generate.js';

/**
 * Fills the public catalog.
 *
 * Usage:  pnpm --filter @potluck/api catalog:seed [target]
 *
 * Safe to stop and re-run: existing slugs are loaded first and skipped, so a
 * second run fills gaps rather than starting over or duplicating.
 *
 * Runs as the migration role deliberately. The catalog has no INSERT policy,
 * so the application role cannot write to it even if it tried — which is the
 * point of the table being world-readable.
 */

const target = Number(process.argv[2] ?? 1000);
const databaseUrl = process.env['DATABASE_URL'];
const apiKey = process.env['GROQ_API_KEY'];

if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
if (apiKey === undefined || apiKey.length === 0) {
  console.error('GROQ_API_KEY is not set');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 2, prepare: false, connect_timeout: 20 });

async function insertBatch(recipes: GeneratedRecipe[]): Promise<void> {
  // onConflictDoNothing on the slug: two batches can independently invent
  // "Chipotle Chicken Bowls", and losing one is fine.
  await sql`
    INSERT INTO catalog_recipes ${sql(
      recipes.map((r) => ({
        slug: r.slug,
        title: r.title,
        summary: r.summary,
        cuisine: r.cuisine,
        meal_type: r.mealType,
        main_protein: r.mainProtein,
        tags: r.tags,
        tags_text: r.tags.join(' '),
        servings: r.servings,
        total_minutes: r.totalMinutes,
        difficulty: r.difficulty,
        protein_grams: r.proteinGrams,
        calories: r.calories,
        // sql.json, not JSON.stringify: passing a string makes postgres.js
        // store a JSON *scalar* rather than an array, and jsonb_array_length
        // then fails on every row.
        ingredients: sql.json(r.ingredients),
        ingredients_text: r.ingredients.map((i) => i.rawText).join(' | '),
        steps: sql.json(r.steps),
      })),
    )}
    ON CONFLICT (slug) DO NOTHING`;
}

async function main(): Promise<void> {
  const rows = await sql<{ slug: string }[]>`SELECT slug FROM catalog_recipes`;
  const existing = new Set(rows.map((r) => r.slug));

  const remaining = Math.max(0, target - existing.size);
  console.log(`catalog: ${existing.size} recipes present, target ${target}`);
  if (remaining === 0) {
    console.log('nothing to do');
    await sql.end({ timeout: 5 });
    return;
  }
  console.log(`generating ${remaining} more — this is paced against Groq's 6k tokens/min\n`);

  const started = Date.now();
  const result = await generateCatalog({
    apiKey: apiKey as string,
    existing,
    target: remaining,
    onBatch: insertBatch,
    onProgress: (message) => console.log(message),
  });

  const [{ count }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM catalog_recipes`;

  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(
    `\ndone in ${minutes} min — produced ${result.produced}, skipped ${result.skipped} duplicates, ${result.failed} failed batches`,
  );
  console.log(`catalog now holds ${count} recipes`);

  await sql.end({ timeout: 5 });
}

main().catch(async (error: unknown) => {
  console.error('seed failed:', error);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
