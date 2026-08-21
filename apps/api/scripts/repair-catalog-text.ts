import postgres from 'postgres';
import { normaliseText } from '../src/catalog/taxonomy.js';

/**
 * Re-normalises catalog text that was written before the normaliser existed.
 *
 * Usage:  pnpm --filter @potluck/api catalog:repair [--dry-run]
 *
 * The first generation run predates `normaliseText`, so those rows still carry
 * what the model actually emitted: U+2011 non-breaking hyphens in "One-Pot",
 * vulgar fractions, and UTF-8 that was decoded as Latin-1 somewhere upstream so
 * that "jalapeno" grew debris. All three look almost right and none of them
 * match what a person types, because to_tsvector and pg_trgm both compare
 * codepoints — a search for "one-pot" simply misses "one‑pot".
 *
 * It reuses the same `normaliseText` the importer calls rather than doing its
 * own cleanup, so a repaired row is byte-identical to a freshly imported one.
 *
 * search_vector, ingredients_text and tags_text are generated or derived, so
 * rewriting the source columns is enough to fix search as well as display.
 */

const dryRun = process.argv.includes('--dry-run');

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 2, prepare: false, connect_timeout: 20 });

interface Row {
  id: string;
  title: string;
  summary: string;
  ingredients: { rawText: string }[];
  steps: { body: string; durationSeconds: number | null }[];
}

async function main(): Promise<void> {
  const rows = await sql<Row[]>`
    SELECT id, title, summary, ingredients, steps FROM catalog_recipes`;

  let changed = 0;
  const examples: string[] = [];

  for (const row of rows) {
    const title = normaliseText(row.title);
    const summary = normaliseText(row.summary);
    const ingredients = row.ingredients.map((i) => ({ rawText: normaliseText(i.rawText) }));
    const steps = row.steps.map((s) => ({ ...s, body: normaliseText(s.body) }));

    const dirty =
      title !== row.title ||
      summary !== row.summary ||
      ingredients.some((i, n) => i.rawText !== row.ingredients[n]?.rawText) ||
      steps.some((s, n) => s.body !== row.steps[n]?.body);

    if (!dirty) continue;
    changed += 1;
    if (examples.length < 8 && title !== row.title) {
      examples.push(`${row.title}  ->  ${title}`);
    }

    if (dryRun) continue;

    // The slug is deliberately left alone. It is the dedup key and may already
    // be linked from a saved recipe, so churning it to fix punctuation would
    // trade a cosmetic problem for a broken reference.
    await sql`
      UPDATE catalog_recipes
         SET title = ${title},
             summary = ${summary},
             ingredients = ${sql.json(ingredients)},
             ingredients_text = ${ingredients.map((i) => i.rawText).join(' | ')},
             steps = ${sql.json(steps)}
       WHERE id = ${row.id}`;
  }

  console.log(`${rows.length} rows scanned, ${changed} ${dryRun ? 'would be' : ''} repaired`);
  for (const line of examples) console.log(`  ${line}`);

  if (!dryRun) {
    const [{ left }] = await sql<{ left: number }[]>`
      SELECT count(*)::int AS left FROM catalog_recipes
       WHERE title ~ '[^\\x20-\\x7E]' OR ingredients_text ~ '[^\\x20-\\x7E]'`;
    console.log(`rows still holding non-ASCII: ${left} (accented words like jalapeno are expected)`);
  }

  await sql.end({ timeout: 5 });
}

main().catch(async (error: unknown) => {
  console.error('repair failed:', error);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
