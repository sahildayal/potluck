import { canonicalise } from '@potluck/core';
import postgres from 'postgres';

/**
 * Finds catalog rows whose protein claim the ingredients cannot support.
 *
 * Usage:  pnpm --filter @potluck/api catalog:protein [--fix]
 *
 * The generator is told protein is per serving and still, reliably, some rows
 * come back costed for the whole pan. The existing 0-65 g bound in `normalise`
 * only catches the extremes: 8 oz of seitan split two ways is about 28 g a
 * plate, and a claim of 60 g sails through a ceiling of 65.
 *
 * This matters more than the size of the error suggests, because "high
 * protein" is the premise of the catalog and protein-descending is a sort the
 * UI offers. Every inflated row is therefore pushed to the top of the first
 * screen a person sees — the failure mode lands its damage exactly where it is
 * most visible.
 *
 * The check is deliberately crude and deliberately lenient. It reads the one
 * ingredient line matching the row's main protein, converts it with the same
 * canonical unit parser the app uses, and compares the claim against what that
 * quantity could yield. Only a claim exceeding the estimate by more than 60%
 * is treated as wrong, which leaves room for eggs in the batter, cheese on
 * top, beans in the side, and for the reference figures below being averages.
 *
 * Offenders are nulled rather than corrected. A missing estimate reads as
 * missing; a recomputed one would look authoritative while resting on a table
 * of approximations, which is a worse lie than the one being fixed.
 */

/**
 * Grams of protein per 100 g, as the ingredient is typically used.
 *
 * Secondary sources are listed alongside the headline ones on purpose. Costing
 * only the main protein makes any dish that leans on eggs, cheese or beans look
 * like it is over-claiming when it is not, and a check that cannot tell an
 * inflated number from a composite one is not worth running.
 */
const PROTEIN_PER_100G: Record<string, number> = {
  // Headline proteins, with the cuts and market names people actually write.
  chicken: 31, 'chicken thigh': 26, 'chicken breast': 31,
  beef: 26, steak: 27, sirloin: 27, ribeye: 24, 'ground beef': 26,
  turkey: 27, pork: 27, 'pork tenderloin': 26, lamb: 25,
  salmon: 25, 'white fish': 20, fish: 20, cod: 20, haddock: 20,
  halibut: 23, tilapia: 26, snapper: 20, tuna: 29,
  shrimp: 24, crawfish: 15, crab: 19, scallops: 20,
  egg: 13, eggs: 13, tofu: 8, tempeh: 19, seitan: 25,
  paneer: 18, halloumi: 22, edamame: 11,
  // Legumes and grains, cooked weights.
  lentils: 9, chickpeas: 9, beans: 9, quinoa: 4.4,
  rice: 2.7, pasta: 5, couscous: 3.6, oats: 13, farro: 5,
  // Dairy.
  yogurt: 10, 'cottage cheese': 11, ricotta: 11, cheese: 25,
  parmesan: 35, cheddar: 25, mozzarella: 22, feta: 14,
  'cream cheese': 6, milk: 3.4, kefir: 3.3,
  // Cured and processed.
  sausage: 18, bacon: 37, ham: 22, chorizo: 24, prosciutto: 28,
  // Nuts, seeds, powders.
  'peanut butter': 25, 'almond butter': 21, peanuts: 26,
  almonds: 21, pistachios: 20, walnuts: 15, cashews: 18,
  tahini: 17, 'protein powder': 75, 'chia seeds': 17,
  // Flours and breads.
  flour: 10, bread: 9, tortilla: 8, breadcrumbs: 13,
};

/**
 * The sources substantial enough to anchor a judgement.
 *
 * Rice, flour and a spoon of tahini are real protein and are counted, but a
 * recipe whose only resolvable lines are those is not one this script
 * understands. Treating that as a low estimate is how "1 lb cod, 4 servings"
 * came out at 3 g and a correct claim looked like a lie.
 */
const HEADLINE = new Set([
  'chicken', 'chicken thigh', 'chicken breast', 'beef', 'steak', 'sirloin',
  'ribeye', 'ground beef', 'turkey', 'pork', 'pork tenderloin', 'lamb',
  'salmon', 'white fish', 'fish', 'cod', 'haddock', 'halibut', 'tilapia',
  'snapper', 'tuna', 'shrimp', 'crawfish', 'crab', 'scallops', 'egg', 'eggs',
  'tofu', 'tempeh', 'seitan', 'paneer', 'halloumi', 'edamame', 'lentils',
  'chickpeas', 'beans', 'cottage cheese', 'yogurt', 'ricotta', 'protein powder',
  'peanut butter', 'almond butter', 'sausage', 'bacon', 'ham', 'chorizo',
]);

/** Longest names first, so "cottage cheese" is not matched as "cheese". */
const PROTEIN_KEYS = Object.keys(PROTEIN_PER_100G).sort((a, b) => b.length - a.length);

/**
 * How far over the estimate a claim may sit before it is treated as wrong.
 *
 * Two times, not the 1.6 first tried. The reference figures above are averages
 * over cuts, fat contents and cooked-versus-raw weights, so the estimate
 * carries real error of its own — and nulling an honest row costs the catalog
 * a recipe in the "high protein" filter that is the whole point of it.
 * At double, the claim is not arguable: the pan has been costed once and
 * served twice. Override with --tolerance=N to inspect the borderline band.
 */
const toleranceArg = process.argv.find((a) => a.startsWith('--tolerance='));
const TOLERANCE =
  toleranceArg === undefined ? 2.0 : Number(toleranceArg.slice('--tolerance='.length));

const fix = process.argv.includes('--fix');

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 2, prepare: false, connect_timeout: 20 });

interface Row {
  id: string;
  title: string;
  servings: number;
  main_protein: string;
  protein_grams: number | null;
  ingredients: { rawText: string }[];
}

/**
 * Total grams of protein the whole recipe's ingredients could supply.
 *
 * Returns null when nothing was recognisable, so those rows are skipped rather
 * than judged against an estimate of zero.
 */
function estimateRecipeProtein(row: Row): number | null {
  let total = 0;
  let matched = 0;
  let anchored = false;

  for (const { rawText } of row.ingredients) {
    const lower = rawText.toLowerCase();
    const key = PROTEIN_KEYS.find((k) => lower.includes(k));
    if (key === undefined) continue;

    const q = canonicalise(rawText);

    let grams: number | null = null;
    if (q.qty !== null) {
      if (q.unit === 'g') {
        grams = q.qty;
      } else if (q.unit === 'count' && (key === 'egg' || key === 'eggs')) {
        grams = q.qty * 50;
      } else if (q.unit === 'ml') {
        // Milk, kefir and yogurt are given by volume, near enough to 1 g/ml.
        grams = q.qty;
      }
    }

    // A protein line that will not convert makes the whole recipe unknowable,
    // not merely lighter.
    //
    // "4 salmon fillets" parses as a count, which yields no grams. Skipping just
    // that line leaves the estimate built from the rice underneath it, so a
    // correct 34 g claim gets measured against 2 g and reported as inflated.
    // The first version of this script did exactly that and flagged 247 rows,
    // most of them fine. Returning null costs coverage and buys the right to
    // trust what is left.
    if (grams === null) return null;

    matched += 1;
    if (HEADLINE.has(key)) anchored = true;
    total += (grams * (PROTEIN_PER_100G[key] as number)) / 100;
  }

  return matched === 0 || !anchored ? null : total;
}

async function main(): Promise<void> {
  const rows = await sql<Row[]>`
    SELECT id, title, servings, main_protein, protein_grams, ingredients
      FROM catalog_recipes
     WHERE protein_grams IS NOT NULL
     ORDER BY protein_grams DESC`;

  const bad: { row: Row; estimate: number }[] = [];
  let checked = 0;

  for (const row of rows) {
    const totalProtein = estimateRecipeProtein(row);
    if (totalProtein === null) continue;
    checked += 1;

    const servings = row.servings > 0 ? row.servings : 1;
    const estimate = totalProtein / servings;
    if (estimate <= 0) continue;

    if ((row.protein_grams ?? 0) > estimate * TOLERANCE) {
      bad.push({ row, estimate });
    }
  }

  console.log(`${rows.length} rows with a protein figure, ${checked} checkable`);
  console.log(`${bad.length} claim more than the ingredients support\n`);

  for (const { row, estimate } of bad.slice(0, 15)) {
    console.log(
      `  ${String(row.protein_grams).padStart(3)}g claimed vs ~${estimate.toFixed(0)}g  ` +
        `x${row.servings}  ${row.title.slice(0, 52)}`,
    );
  }
  if (bad.length > 15) console.log(`  ... and ${bad.length - 15} more`);

  if (!fix) {
    console.log('\nnot writing. pass --fix to null these out.');
    await sql.end({ timeout: 5 });
    return;
  }

  for (const { row } of bad) {
    await sql`UPDATE catalog_recipes SET protein_grams = NULL WHERE id = ${row.id}`;
  }

  const [{ left }] = await sql<{ left: number }[]>`
    SELECT count(*)::int AS left FROM catalog_recipes WHERE protein_grams IS NULL`;
  console.log(`\nnulled ${bad.length}; ${left} rows now have no protein estimate`);

  await sql.end({ timeout: 5 });
}

main().catch(async (error: unknown) => {
  console.error('audit failed:', error);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
