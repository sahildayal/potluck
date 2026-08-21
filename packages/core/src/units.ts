/**
 * Unit handling for ingredient quantities.
 *
 * The rule this file exists to enforce: we store a canonical quantity when — and
 * only when — we genuinely understand the measurement, and we always keep the
 * source's original wording alongside it. "200 g" canonicalises cleanly. "a
 * pinch of saffron" and "2 medium onions" do not, and pretending otherwise
 * produces confidently wrong recipes, which is worse than no conversion at all.
 *
 * Canonical units are grams for mass and millilitres for volume, because every
 * other unit in a kitchen converts to one of those without loss.
 */

export type Dimension = 'mass' | 'volume' | 'count' | 'none';

export type UnitSystem = 'metric' | 'imperial';

export interface CanonicalQuantity {
  /** Quantity in the canonical unit for its dimension, or null if unconvertible. */
  qty: number | null;
  /** 'g' for mass, 'ml' for volume, 'count' for countable, null otherwise. */
  unit: 'g' | 'ml' | 'count' | null;
  dimension: Dimension;
}

interface UnitDef {
  dimension: Exclude<Dimension, 'none'>;
  /** How many canonical units one of this unit represents. */
  factor: number;
}

/**
 * US customary volumes, because the overwhelming majority of recipe sites we
 * import from are American. A UK "cup" differs and we do not attempt to detect
 * it — that ambiguity is exactly why raw_text is preserved.
 */
const UNITS: Record<string, UnitDef> = {
  // volume -> ml
  ml: { dimension: 'volume', factor: 1 },
  millilitre: { dimension: 'volume', factor: 1 },
  milliliter: { dimension: 'volume', factor: 1 },
  cl: { dimension: 'volume', factor: 10 },
  dl: { dimension: 'volume', factor: 100 },
  l: { dimension: 'volume', factor: 1000 },
  litre: { dimension: 'volume', factor: 1000 },
  liter: { dimension: 'volume', factor: 1000 },
  tsp: { dimension: 'volume', factor: 4.92892 },
  teaspoon: { dimension: 'volume', factor: 4.92892 },
  tbsp: { dimension: 'volume', factor: 14.7868 },
  tablespoon: { dimension: 'volume', factor: 14.7868 },
  floz: { dimension: 'volume', factor: 29.5735 },
  cup: { dimension: 'volume', factor: 236.588 },
  pint: { dimension: 'volume', factor: 473.176 },
  quart: { dimension: 'volume', factor: 946.353 },
  gallon: { dimension: 'volume', factor: 3785.41 },

  // mass -> g
  mg: { dimension: 'mass', factor: 0.001 },
  g: { dimension: 'mass', factor: 1 },
  gram: { dimension: 'mass', factor: 1 },
  gramme: { dimension: 'mass', factor: 1 },
  kg: { dimension: 'mass', factor: 1000 },
  kilogram: { dimension: 'mass', factor: 1000 },
  oz: { dimension: 'mass', factor: 28.3495 },
  ounce: { dimension: 'mass', factor: 28.3495 },
  lb: { dimension: 'mass', factor: 453.592 },
  pound: { dimension: 'mass', factor: 453.592 },
};

/** Spellings that map onto a canonical key above. */
const ALIASES: Record<string, string> = {
  t: 'tsp',
  ts: 'tsp',
  tsps: 'tsp',
  teaspoons: 'teaspoon',
  T: 'tbsp',
  tbs: 'tbsp',
  tbsps: 'tbsp',
  tblsp: 'tbsp',
  tablespoons: 'tablespoon',
  'fl oz': 'floz',
  'fluid ounce': 'floz',
  'fluid ounces': 'floz',
  cups: 'cup',
  c: 'cup',
  pints: 'pint',
  pt: 'pint',
  quarts: 'quart',
  qt: 'quart',
  gallons: 'gallon',
  gal: 'gallon',
  grams: 'gram',
  grammes: 'gramme',
  kilograms: 'kilogram',
  kilos: 'kilogram',
  kilo: 'kilogram',
  ounces: 'ounce',
  pounds: 'pound',
  lbs: 'lb',
  litres: 'litre',
  liters: 'liter',
  millilitres: 'millilitre',
  milliliters: 'milliliter',
};

const VULGAR_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅕': 0.2,
  '⅖': 0.4,
  '⅗': 0.6,
  '⅘': 0.8,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

/**
 * Parses the leading quantity of an ingredient string.
 * Handles "2", "1.5", "1/2", "1 1/2", "1½", "½", and ranges like "2-3" (which
 * take the lower bound, because under-buying is recoverable and over-buying is
 * waste).
 *
 * Returns null when there is no leading number at all — "salt to taste".
 */
export function parseQuantity(input: string): { value: number; rest: string } | null {
  const text = input.trim();
  if (text.length === 0) return null;

  // Leading vulgar fraction on its own, e.g. "½ cup"
  const firstChar = text[0];
  if (firstChar !== undefined && firstChar in VULGAR_FRACTIONS) {
    return { value: VULGAR_FRACTIONS[firstChar] as number, rest: text.slice(1).trim() };
  }

  // Order matters. "3/4" must be tested before the plain-number branch, or the
  // leading 3 is consumed and the quantity comes out four times too large.

  // "1 1/2 tbsp" — whole number followed by a slash fraction.
  const mixed = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/);
  if (mixed && mixed[1] !== undefined && mixed[2] !== undefined && mixed[3] !== undefined) {
    const denom = Number(mixed[3]);
    if (denom !== 0) {
      return {
        value: Number(mixed[1]) + Number(mixed[2]) / denom,
        rest: text.slice(mixed[0].length).trim(),
      };
    }
  }

  // "1½ cups" — whole number followed immediately by a vulgar fraction.
  const mixedVulgar = text.match(/^(\d+)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/);
  if (mixedVulgar && mixedVulgar[1] !== undefined && mixedVulgar[2] !== undefined) {
    return {
      value: Number(mixedVulgar[1]) + (VULGAR_FRACTIONS[mixedVulgar[2]] as number),
      rest: text.slice(mixedVulgar[0].length).trim(),
    };
  }

  // "3/4 cup" — bare fraction, no whole part.
  const frac = text.match(/^(\d+)\s*\/\s*(\d+)/);
  if (frac && frac[1] !== undefined && frac[2] !== undefined) {
    const denom = Number(frac[2]);
    if (denom !== 0) {
      return { value: Number(frac[1]) / denom, rest: text.slice(frac[0].length).trim() };
    }
  }

  // "2", "1.5", "2-3", "2 to 3" — ranges take the lower bound.
  const plain = text.match(/^(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?/);
  if (plain && plain[1] !== undefined) {
    return { value: Number(plain[1]), rest: text.slice(plain[0].length).trim() };
  }

  return null;
}

function normaliseUnitToken(token: string): string | null {
  const cleaned = token
    .toLowerCase()
    .replace(/\./g, '')
    .trim();
  if (cleaned.length === 0) return null;
  if (cleaned in UNITS) return cleaned;
  const alias = ALIASES[cleaned] ?? ALIASES[token.trim()];
  if (alias !== undefined && alias in UNITS) return alias;
  return null;
}

/**
 * Canonicalises a free-text ingredient measurement.
 *
 * `canonicalise("2 cups flour")` -> 473.18 ml, volume
 * `canonicalise("a pinch of saffron")` -> null qty, 'none'
 * `canonicalise("2 onions")` -> 2, 'count'
 */
export function canonicalise(raw: string): CanonicalQuantity {
  const parsed = parseQuantity(raw);
  if (parsed === null) {
    return { qty: null, unit: null, dimension: 'none' };
  }

  // Try progressively longer unit tokens so "fl oz" beats "fl".
  const words = parsed.rest.split(/\s+/).filter((w) => w.length > 0);
  for (const take of [2, 1]) {
    if (words.length < take) continue;
    const token = words.slice(0, take).join(' ');
    const key = normaliseUnitToken(token);
    if (key !== null) {
      const def = UNITS[key] as UnitDef;
      return {
        qty: round(parsed.value * def.factor, 4),
        unit: def.dimension === 'mass' ? 'g' : 'ml',
        dimension: def.dimension,
      };
    }
  }

  // A number with no recognised unit is a count: "2 onions", "3 eggs".
  return { qty: parsed.value, unit: 'count', dimension: 'count' };
}

/**
 * Canonicalises a measurement AND returns what is left of the line.
 *
 * The remainder is the ingredient name with the quantity and unit consumed, so
 * the UI can show a scaled quantity next to "potatoes, cubed" rather than
 * printing the number twice — once converted and once still inside the raw
 * text. When nothing could be parsed, `item` is empty and the caller falls back
 * to showing the source's own words.
 */
export function parseIngredient(raw: string): CanonicalQuantity & { item: string } {
  const parsed = parseQuantity(raw);
  if (parsed === null) {
    return { qty: null, unit: null, dimension: 'none', item: '' };
  }

  const words = parsed.rest.split(/\s+/).filter((w) => w.length > 0);
  for (const take of [2, 1]) {
    if (words.length < take) continue;
    const key = normaliseUnitToken(words.slice(0, take).join(' '));
    if (key !== null) {
      const def = UNITS[key] as UnitDef;
      return {
        qty: round(parsed.value * def.factor, 4),
        unit: def.dimension === 'mass' ? 'g' : 'ml',
        dimension: def.dimension,
        item: cleanItem(words.slice(take).join(' ')),
      };
    }
  }

  return {
    qty: parsed.value,
    unit: 'count',
    dimension: 'count',
    item: cleanItem(parsed.rest),
  };
}

/** Drops a leading "of" left behind by "2 cups of flour". */
function cleanItem(text: string): string {
  return text.replace(/^of\s+/i, '').trim();
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Scales a canonical quantity for a different serving count. */
export function scale(qty: number | null, fromServings: number, toServings: number): number | null {
  if (qty === null) return null;
  if (fromServings <= 0 || toServings <= 0) return qty;
  return round((qty * toServings) / fromServings, 4);
}

interface DisplayStep {
  unit: string;
  factor: number;
  /** Use this unit when the canonical value is at least this large. */
  min: number;
}

/**
 * Spoons and cups are how people say small volumes in BOTH systems — a metric
 * recipe says "1 tsp turmeric", never "4.93 ml turmeric". So the metric ladder
 * drops to tbsp and tsp below the point where millilitres stop sounding like
 * something a person would measure.
 */
const DISPLAY: Record<UnitSystem, Record<'mass' | 'volume', DisplayStep[]>> = {
  metric: {
    mass: [
      { unit: 'kg', factor: 1000, min: 1000 },
      { unit: 'g', factor: 1, min: 0 },
    ],
    volume: [
      { unit: 'l', factor: 1000, min: 1000 },
      { unit: 'ml', factor: 1, min: 50 },
      { unit: 'tbsp', factor: 14.7868, min: 11 },
      { unit: 'tsp', factor: 4.92892, min: 0 },
    ],
  },
  imperial: {
    mass: [
      { unit: 'lb', factor: 453.592, min: 453.592 },
      { unit: 'oz', factor: 28.3495, min: 0 },
    ],
    // Threshold is a quarter cup (59 ml), not half: cooks say "1/4 cup", but
    // they say "2 tbsp" rather than "1/8 cup".
    volume: [
      { unit: 'cup', factor: 236.588, min: 59 },
      { unit: 'tbsp', factor: 14.7868, min: 11 },
      { unit: 'tsp', factor: 4.92892, min: 0 },
    ],
  },
};

/**
 * Renders a canonical quantity in the user's preferred system.
 *
 * Returns null when there is nothing sensible to render, which the UI treats as
 * "show the raw text instead".
 */
export function formatQuantity(
  q: CanonicalQuantity,
  system: UnitSystem,
): { value: string; unit: string } | null {
  if (q.qty === null) return null;
  if (q.dimension === 'count') {
    return { value: formatNumber(q.qty, ''), unit: '' };
  }
  if (q.dimension === 'none') return null;

  const steps = DISPLAY[system][q.dimension];
  const step = steps.find((s) => q.qty !== null && q.qty >= s.min) ?? steps[steps.length - 1];
  if (step === undefined) return null;

  return { value: formatNumber(q.qty / step.factor, step.unit), unit: step.unit };
}

/**
 * Fractions belong to spoon-and-cup measures, decimals to weights and bulk
 * volumes. That split follows how the units are actually spoken rather than
 * which system they belong to: people say "1/2 tsp" and "1 1/2 cups", but
 * "1.5 kg" and "250 ml" — and "1 1/2 kg" on a recipe card would look wrong in
 * either system.
 */
const FRACTIONAL_UNITS = new Set(['tsp', 'tbsp', 'cup']);

/**
 * Precision follows magnitude, because significant figures are what a cook
 * actually needs and decimal places are not.
 *
 * A pound of chicken is 453.592 g, and rendering that as "453.59 g" is precise
 * and useless — nobody weighs poultry to a hundredth of a gram. Worse, every
 * catalog recipe is written in US units, so a metric reader would meet a
 * two-decimal number on essentially every line. "454 g" is the same fact,
 * legible. Small quantities keep their decimals, since 0.5 g of saffron and
 * 1 g of saffron are genuinely different amounts.
 */
function significantRound(n: number): number {
  if (n >= 10) return Math.round(n);
  if (n >= 1) return round(n, 1);
  return round(n, 2);
}

function formatNumber(n: number, unit: string): string {
  if (!FRACTIONAL_UNITS.has(unit)) {
    return String(significantRound(n));
  }
  const whole = Math.floor(n);
  const frac = n - whole;
  const known: Array<[number, string]> = [
    [0.125, '1/8'],
    [0.25, '1/4'],
    [1 / 3, '1/3'],
    [0.375, '3/8'],
    [0.5, '1/2'],
    [0.625, '5/8'],
    [2 / 3, '2/3'],
    [0.75, '3/4'],
    [0.875, '7/8'],
  ];
  for (const [value, label] of known) {
    if (Math.abs(frac - value) < 0.02) {
      return whole === 0 ? label : `${whole} ${label}`;
    }
  }
  if (frac < 0.02) return String(whole);
  return String(round(n, 2));
}
