import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { normalise } from '../src/catalog/generate.js';
import type { GeneratedRecipe } from '../src/catalog/generate.js';
import type { Cell, MealType } from '../src/catalog/taxonomy.js';

/**
 * Imports catalog recipes from JSONL files produced offline.
 *
 * Usage:  pnpm --filter @potluck/api catalog:import <dir> [--dry-run]
 *
 * `catalog:seed` generates through Groq, which is bound by a daily token cap
 * that turns 1,200 recipes into a multi-night job. This path takes the same
 * taxonomy and the same normaliser, but accepts recipes written elsewhere —
 * one JSON object per line, each carrying the cell it was written for.
 *
 * It reuses `normalise` from the Groq pipeline rather than reimplementing the
 * rules. That matters: protein plausibility bounds, timer detection, tag
 * derivation and slugging all have to behave identically, or the catalog's
 * contents would depend on which route a row arrived by.
 *
 * Everything rejected is reported with a reason. A silent importer that drops
 * a fifth of its input looks exactly like a successful one.
 */

const dir = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (dir === undefined || dir.startsWith('--')) {
  console.error('usage: catalog:import <dir> [--dry-run]');
  process.exit(1);
}

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 2, prepare: false, connect_timeout: 20 });

const MEAL_TYPES = new Set<string>([
  'breakfast', 'lunch', 'dinner', 'appetizer',
  'dessert', 'snack', 'salad', 'soup', 'drink',
]);

interface Rejection {
  file: string;
  line: number;
  reason: string;
  title: string;
}

const rejections: Rejection[] = [];

/**
 * Pulls the cell out of the record itself. The offline writer is given the
 * cell in its brief and echoes it back on every line, so a recipe carries the
 * taxonomy it was written against instead of depending on file ordering — which
 * would break the moment a line was dropped or reordered.
 */
function cellOf(value: Record<string, unknown>): Cell | null {
  const cuisine = value['cuisine'];
  const mealType = value['mealType'];
  const protein = value['mainProtein'];
  const technique = value['technique'];

  if (typeof cuisine !== 'string' || cuisine.length === 0) return null;
  if (typeof mealType !== 'string' || !MEAL_TYPES.has(mealType)) return null;
  if (typeof protein !== 'string' || protein.length === 0) return null;

  return {
    cuisine,
    mealType: mealType as MealType,
    protein,
    technique: typeof technique === 'string' ? technique : '',
  };
}

/**
 * Checks the offline writer honoured the brief's shape. `normalise` already
 * drops the unusable, but it is deliberately forgiving — it will happily accept
 * a four-ingredient recipe. The brief asks for 6-14, and a catalog full of
 * minimum-effort entries is a worse outcome than a smaller honest one.
 */
/**
 * Sweet dishes are allowed one ingredient fewer.
 *
 * The floor of six was set against savoury dinners and is simply wrong for the
 * sweet end: dates, almonds, cocoa, protein powder and salt is a complete
 * energy-ball recipe, and a lassi is yogurt, fruit, honey, a spice and ice.
 * A first sweet batch lost 50 perfectly good recipes to this, and lost them
 * precisely in the meal types the catalog was already short of — the rule was
 * quietly working against the gap it was meant to help fill.
 */
const SWEET_MEALS = new Set(['dessert', 'drink', 'snack']);

function meetsBrief(recipe: GeneratedRecipe): string | null {
  const minIngredients = SWEET_MEALS.has(recipe.mealType) ? 5 : 6;
  if (recipe.ingredients.length < minIngredients) {
    return `only ${recipe.ingredients.length} ingredients`;
  }
  if (recipe.steps.length < 4) return `only ${recipe.steps.length} steps`;
  if (recipe.summary.length === 0) return 'no summary';
  if (recipe.tags.length < 2) return 'fewer than 2 tags';

  // A quantity-less ingredient line ("chicken") defeats the unit parser, so the
  // scaler and the shopping-list merge silently stop working for that row.
  const withoutQuantity = recipe.ingredients.filter((i) => !/\d/.test(i.rawText)).length;
  if (withoutQuantity > 2) return `${withoutQuantity} ingredient lines have no quantity`;

  return null;
}

async function insertBatch(recipes: GeneratedRecipe[]): Promise<void> {
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
        // sql.json, not JSON.stringify: a string would be stored as a JSON
        // scalar rather than an array, and jsonb_array_length then fails.
        ingredients: sql.json(r.ingredients),
        ingredients_text: r.ingredients.map((i) => i.rawText).join(' | '),
        steps: sql.json(r.steps),
      })),
    )}
    ON CONFLICT (slug) DO NOTHING`;
}

async function main(): Promise<void> {
  const existingRows = await sql<{ slug: string }[]>`SELECT slug FROM catalog_recipes`;
  const seen = new Set(existingRows.map((r) => r.slug));
  const before = seen.size;

  const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort();
  if (files.length === 0) {
    console.error(`no .jsonl files in ${dir}`);
    process.exit(1);
  }

  console.log(`${before} recipes already in the catalog`);
  console.log(`reading ${files.length} file(s) from ${dir}\n`);

  const accepted: GeneratedRecipe[] = [];
  let duplicates = 0;

  for (const file of files) {
    const text = await readFile(`${dir}/${file}`, 'utf8');
    const lines = text.split('\n');
    let fileAccepted = 0;

    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      let value: Record<string, unknown>;
      try {
        value = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        rejections.push({ file, line: index + 1, reason: 'invalid JSON', title: '' });
        continue;
      }

      const title = typeof value['title'] === 'string' ? value['title'] : '';
      const cell = cellOf(value);
      if (cell === null) {
        rejections.push({ file, line: index + 1, reason: 'missing or invalid cuisine/mealType/mainProtein', title });
        continue;
      }

      const recipe = normalise(value, cell);
      if (recipe === null) {
        rejections.push({ file, line: index + 1, reason: 'failed normalise (too short, or bad title)', title });
        continue;
      }

      const shortfall = meetsBrief(recipe);
      if (shortfall !== null) {
        rejections.push({ file, line: index + 1, reason: shortfall, title });
        continue;
      }

      // Deduping in memory as well as via the unique index: two slices can
      // independently land on "Chipotle Chicken Bowls", and batching them into
      // the same INSERT would otherwise fail the whole statement rather than
      // dropping the one row.
      if (seen.has(recipe.slug)) {
        duplicates += 1;
        continue;
      }
      seen.add(recipe.slug);
      accepted.push(recipe);
      fileAccepted += 1;
    }

    console.log(`  ${file}: ${fileAccepted} accepted`);
  }

  console.log(`\n${accepted.length} accepted, ${duplicates} duplicate slugs, ${rejections.length} rejected`);

  if (rejections.length > 0) {
    const byReason = new Map<string, number>();
    for (const r of rejections) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
    console.log('\nrejections by reason:');
    for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(4)}  ${reason}`);
    }
    console.log('\nfirst 10:');
    for (const r of rejections.slice(0, 10)) {
      console.log(`  ${r.file}:${r.line}  ${r.reason}  ${r.title.slice(0, 50)}`);
    }
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing written');
    await sql.end({ timeout: 5 });
    return;
  }

  for (let i = 0; i < accepted.length; i += 100) {
    await insertBatch(accepted.slice(i, i + 100));
    process.stdout.write(`\rinserted ${Math.min(i + 100, accepted.length)}/${accepted.length}`);
  }

  const [{ count }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM catalog_recipes`;
  console.log(`\n\ncatalog now holds ${count} recipes (was ${before})`);

  await sql.end({ timeout: 5 });
}

main().catch(async (error: unknown) => {
  console.error('import failed:', error);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
