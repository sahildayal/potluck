import { writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { buildPlan, type Cell } from '../src/catalog/taxonomy.js';

/**
 * Emits the generation plan as a set of disjoint slices.
 *
 * Usage:  pnpm --filter @potluck/api catalog:plan <total> <slices> <outDir>
 *
 * The Groq pipeline in `catalog:seed` is bound by a *daily* token cap that only
 * reveals itself as a 30-minute backoff, which put 1,200 recipes several nights
 * away. This script exists so the same taxonomy can be handed to a different
 * writer instead — each slice is a self-contained brief that can be worked on
 * independently and in parallel.
 *
 * Disjointness is the whole point. Two writers given the same brief invent the
 * same dish, and the slug unique index then silently drops one of them, so the
 * run produces fewer recipes than it appears to. Slicing the plan up front
 * means every unit of work is spent on something new.
 */

const total = Number(process.argv[2] ?? 1300);
const slices = Number(process.argv[3] ?? 10);
const outDir = process.argv[4] ?? '.';

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 20 });

async function main(): Promise<void> {
  const rows = await sql<{ cuisine: string; meal_type: string; main_protein: string }[]>`
    SELECT cuisine, meal_type, main_protein FROM catalog_recipes`;

  // Combinations already in the catalog are *deprioritised*, not excluded.
  //
  // Excluding them outright was the first attempt and it silently capped the
  // catalog: the table records cuisine, meal and protein but not technique, so
  // dropping every covered triple also threw away Korean/dinner/tofu as a
  // stir-fry merely because a slow braise already existed. Those are different
  // dishes. With 500 recipes in the table the survivors ran out at 466 cells,
  // several hundred short of the target, and the shortfall looked like the
  // taxonomy being exhausted rather than the filter being wrong.
  //
  // So: uncovered triples first, because they add the most variety, then the
  // covered ones to fill the remainder. buildPlan already dedupes on the full
  // four-part cell, and the slug unique index catches anything that still
  // lands on the same title.
  const covered = new Set(rows.map((r) => `${r.cuisine}|${r.meal_type}|${r.main_protein}`));

  const plan = buildPlan(Math.ceil(total * 2.5), 20260821);
  const fresh = plan.filter((c) => !covered.has(`${c.cuisine}|${c.mealType}|${c.protein}`));
  const rest = plan.filter((c) => covered.has(`${c.cuisine}|${c.mealType}|${c.protein}`));

  console.log(`${fresh.length} cells on uncovered combinations, ${rest.length} on covered ones`);

  const wanted = [...fresh, ...rest].slice(0, total);
  const perSlice = Math.ceil(wanted.length / slices);

  console.log(`${rows.length} recipes already in the catalog`);
  console.log(`${covered.size} cuisine/meal/protein combinations already covered`);
  console.log(`planned ${wanted.length} new cells across ${slices} slices (~${perSlice} each)\n`);

  for (let i = 0; i < slices; i += 1) {
    const cells: Cell[] = wanted.slice(i * perSlice, (i + 1) * perSlice);
    if (cells.length === 0) continue;

    const path = `${outDir}/slice-${String(i + 1).padStart(2, '0')}.json`;
    await writeFile(path, JSON.stringify({ slice: i + 1, cells }, null, 2), 'utf8');
    console.log(`slice ${i + 1}: ${cells.length} cells -> ${path}`);
  }

  await sql.end({ timeout: 5 });
}

main().catch(async (error: unknown) => {
  console.error('plan failed:', error);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
