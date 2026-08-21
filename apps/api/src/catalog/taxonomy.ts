/**
 * The taxonomy that drives catalog generation.
 *
 * Asking a model for "1000 recipes" produces a few hundred variations on
 * chicken and rice. Asking it for one specific cell of a grid — Korean ×
 * dinner × tofu × braise — produces something distinct every time, and the grid
 * guarantees coverage rather than hoping for it.
 *
 * Weighted toward what the brief asked for: food people in their twenties
 * actually cook in the United States, protein-forward, across the cuisines that
 * are genuinely common in American kitchens rather than a tour of world cuisine
 * for its own sake.
 */

export interface Cell {
  cuisine: string;
  mealType: MealType;
  protein: string;
  technique: string;
}

export type MealType =
  | 'breakfast'
  | 'lunch'
  | 'dinner'
  | 'appetizer'
  | 'dessert'
  | 'snack'
  | 'salad'
  | 'soup'
  | 'drink';

/** Cuisines that are genuinely everyday in the US, not a world tour. */
export const CUISINES = [
  'American',
  'Tex-Mex',
  'Mexican',
  'Italian',
  'Italian-American',
  'Chinese-American',
  'Japanese',
  'Korean',
  'Thai',
  'Vietnamese',
  'Indian',
  'Mediterranean',
  'Greek',
  'Middle Eastern',
  'Southern',
  'Cajun',
  'Californian',
  'Caribbean',
  'Filipino',
  'Spanish',
  'French',
  'German',
  'Brazilian',
  'Peruvian',
  'Ethiopian',
] as const;

/**
 * Meal types with weights. Dinner dominates because that is what people cook
 * most; desserts and drinks are present because the brief asked for variety,
 * but they do not need a fifth of the catalog.
 */
export const MEAL_WEIGHTS: [MealType, number][] = [
  ['dinner', 30],
  ['lunch', 18],
  ['breakfast', 12],
  ['appetizer', 9],
  ['salad', 8],
  ['soup', 7],
  ['snack', 6],
  ['dessert', 7],
  ['drink', 3],
];

/**
 * Protein sources, weighted. Plant proteins are well represented because a
 * meaningful share of this age group eats that way, and because "high protein"
 * is not a synonym for "chicken breast".
 */
export const PROTEINS: [string, number][] = [
  ['chicken', 16],
  ['beef', 10],
  ['ground turkey', 6],
  ['pork', 7],
  ['salmon', 6],
  ['white fish', 4],
  ['shrimp', 6],
  ['tuna', 3],
  ['eggs', 8],
  ['greek yogurt', 5],
  ['cottage cheese', 4],
  ['tofu', 7],
  ['tempeh', 3],
  ['black beans', 5],
  ['chickpeas', 6],
  ['lentils', 5],
  ['edamame', 2],
  ['paneer', 3],
  ['halloumi', 2],
  ['protein powder', 3],
  ['quinoa', 3],
  ['seitan', 2],
];

/**
 * Sweet meals draw from their own pool rather than filtering the savoury one.
 *
 * Filtering was the first approach and it quietly starved the catalog: only
 * four of the twenty-two proteins are sweet-compatible, so desserts could never
 * exceed about 1.2% of rows and drinks 0.5% no matter how the meal weights were
 * set. A run of 1,019 recipes produced 10 desserts and no drinks at all, which
 * is not what "a variety of things" means to anyone reading the app.
 *
 * These are all genuine protein sources a dessert can be built on, which keeps
 * the high-protein brief intact instead of quietly abandoning it for the sweet
 * half of the catalog.
 */
export const SWEET_PROTEINS: [string, number][] = [
  ['greek yogurt', 14],
  ['protein powder', 12],
  ['cottage cheese', 10],
  ['eggs', 9],
  ['ricotta', 7],
  ['peanut butter', 7],
  ['silken tofu', 6],
  ['almond butter', 5],
  ['black beans', 4],
  ['chickpeas', 4],
  ['milk', 6],
  ['kefir', 4],
  ['oats', 6],
  ['cream cheese', 5],
  ['almonds', 4],
  ['pistachios', 3],
];

export const TECHNIQUES = [
  'sheet-pan roast',
  'one-pot',
  'stir-fry',
  'grill',
  'air fryer',
  'slow braise',
  'pressure cooker',
  'no-cook assembly',
  'skillet sear',
  'baked casserole',
  'soup pot',
  'marinated and seared',
  'meal-prep batch',
  'wrap or handheld',
  'bowl',
  'salad toss',
  'griddle',
  'poach',
  'blender',
  'overnight / make-ahead',
];

function pickWeighted<T>(entries: [T, number][], random: () => number): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1]![0];
}

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length)] as T;
}

/**
 * Deterministic PRNG so a run is reproducible from a seed. Debugging a
 * generation pipeline that produces different work every time is miserable.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Some pairings are wrong, and a model asked for them produces nonsense rather
 * than refusing — the first test run cheerfully returned "German Sheet-Pan Egg
 * & Sausage Soup" and "One-Pot Mexican Chicken & Corn Salad". A dish is not
 * both a sheet-pan roast and a soup. At a thousand recipes even a 5% nonsense
 * rate is fifty bad rows, so the grid is pruned rather than the output.
 */
const TECHNIQUES_BY_MEAL: Partial<Record<MealType, string[]>> = {
  soup: ['one-pot', 'soup pot', 'slow braise', 'pressure cooker', 'blender', 'meal-prep batch'],
  salad: ['no-cook assembly', 'salad toss', 'bowl', 'grill', 'marinated and seared', 'meal-prep batch'],
  drink: ['blender', 'no-cook assembly', 'overnight / make-ahead'],
  dessert: [
    'no-cook assembly', 'baked casserole', 'blender', 'overnight / make-ahead',
    'griddle', 'meal-prep batch',
  ],
  snack: [
    'no-cook assembly', 'air fryer', 'baked casserole', 'blender',
    'overnight / make-ahead', 'meal-prep batch', 'griddle',
  ],
  appetizer: [
    'no-cook assembly', 'air fryer', 'skillet sear', 'grill', 'griddle',
    'baked casserole', 'sheet-pan roast', 'blender',
  ],
};

function plausible(cell: Cell): boolean {
  // The sweet/savoury check that used to live here is gone: buildPlan now draws
  // dessert and drink proteins from SWEET_PROTEINS, so a salmon dessert cannot
  // be generated in the first place. Rejecting after the fact was what capped
  // the sweet half of the catalog at roughly one percent.
  const allowed = TECHNIQUES_BY_MEAL[cell.mealType];
  if (allowed !== undefined && !allowed.includes(cell.technique)) return false;

  return true;
}

export function buildPlan(count: number, seed = 20260820): Cell[] {
  const random = mulberry32(seed);
  const cells: Cell[] = [];
  const seen = new Set<string>();

  // Cap the attempts so an over-constrained taxonomy fails fast rather than
  // spinning forever looking for combinations that do not exist.
  for (let attempts = 0; cells.length < count && attempts < count * 40; attempts += 1) {
    const mealType = pickWeighted(MEAL_WEIGHTS, random);
    const sweet = mealType === 'dessert' || mealType === 'drink';
    // Draw the technique from the ones this meal actually permits, rather than
    // drawing from all twenty and discarding the misses. Rejection sampling
    // silently rescaled the meal weights by how permissive each meal was: a
    // drink allows three techniques of twenty, so asking for 3% of the catalog
    // yielded 0.45% of it. Choosing from the allowed set makes MEAL_WEIGHTS
    // mean what it says.
    const cell: Cell = {
      cuisine: pick(CUISINES, random),
      mealType,
      protein: pickWeighted(sweet ? SWEET_PROTEINS : PROTEINS, random),
      technique: pick(TECHNIQUES_BY_MEAL[mealType] ?? TECHNIQUES, random),
    };
    if (!plausible(cell)) continue;

    const key = `${cell.cuisine}|${cell.mealType}|${cell.protein}|${cell.technique}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push(cell);
  }

  return cells;
}

/**
 * Language models reach for typographic punctuation — U+2011 non-breaking
 * hyphens in "full‑fat", curly quotes, en dashes. They look fine and then
 * quietly break search: a query for "full-fat" will not match "full‑fat",
 * because to_tsvector treats them as different characters.
 */
export function normaliseText(text: string): string {
  return (
    repairMojibake(text)
      .replace(/[‐-―−]/g, '-')
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/…/g, '...')
      // Vulgar fractions render inconsistently and, worse, never match a typed
      // "1/2" in either the tsvector or the trigram index.
      .replace(/½/g, '1/2')
      .replace(/¼/g, '1/4')
      .replace(/¾/g, '3/4')
      .replace(/⅓/g, '1/3')
      .replace(/⅔/g, '2/3')
      .replace(/⅛/g, '1/8')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Undoes UTF-8 bytes that were decoded as Latin-1 somewhere upstream, which is
 * what turns "jalapeno" with a tilde into "jalapeAo" with debris in front.
 *
 * Only the sequences that can actually arise that way are rewritten, and only
 * where the result is a character that plausibly belongs in a recipe. A blanket
 * re-decode would corrupt text that was already correct, which is the usual way
 * a mojibake fix ends up worse than the problem.
 */
const MOJIBAKE: [RegExp, string][] = [
  [/Ã±/g, 'ñ'],
  [/Ã¡/g, 'á'],
  [/Ã©/g, 'é'],
  [/Ã­/g, 'í'],
  [/Ã³/g, 'ó'],
  [/Ãº/g, 'ú'],
  [/Ã¨/g, 'è'],
  [/Ã§/g, 'ç'],
  [/Ã¼/g, 'ü'],
  [/Ã¶/g, 'ö'],
  [/Ã¤/g, 'ä'],
  [/Ã®/g, 'î'],
  [/Ã«/g, 'ë'],
  [/Ã´/g, 'ô'],
  [/â€™/g, "'"],
  [/â€“/g, '-'],
];

export function repairMojibake(text: string): string {
  let out = text;
  for (const [pattern, replacement] of MOJIBAKE) out = out.replace(pattern, replacement);
  return out;
}

export function slugify(title: string): string {
  return normaliseText(title)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}
