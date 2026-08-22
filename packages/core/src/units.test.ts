import { describe, expect, it } from 'vitest';
import {
  canonicalise,
  conversions,
  formatQuantity,
  parseIngredient,
  parseQuantity,
  scale,
} from './units.js';

describe('parseQuantity', () => {
  it('reads plain numbers and decimals', () => {
    expect(parseQuantity('2 cups flour')).toEqual({ value: 2, rest: 'cups flour' });
    expect(parseQuantity('1.5 kg beef')).toEqual({ value: 1.5, rest: 'kg beef' });
  });

  it('reads mixed and bare fractions', () => {
    expect(parseQuantity('1 1/2 tbsp oil')?.value).toBeCloseTo(1.5);
    expect(parseQuantity('3/4 cup milk')?.value).toBeCloseTo(0.75);
  });

  it('reads vulgar fractions, alone and mixed', () => {
    expect(parseQuantity('½ tsp salt')?.value).toBeCloseTo(0.5);
    expect(parseQuantity('1½ cups rice')?.value).toBeCloseTo(1.5);
  });

  it('takes the lower bound of a range', () => {
    // Under-buying is recoverable; over-buying is waste.
    expect(parseQuantity('2-3 cloves garlic')?.value).toBe(2);
    expect(parseQuantity('4 to 6 chillies')?.value).toBe(4);
  });

  it('returns null when there is no leading quantity', () => {
    expect(parseQuantity('salt to taste')).toBeNull();
    expect(parseQuantity('a pinch of saffron')).toBeNull();
    expect(parseQuantity('')).toBeNull();
  });
});

describe('canonicalise', () => {
  it('converts volumes to millilitres', () => {
    const cup = canonicalise('1 cup water');
    expect(cup.dimension).toBe('volume');
    expect(cup.unit).toBe('ml');
    expect(cup.qty).toBeCloseTo(236.588, 2);
  });

  it('converts masses to grams', () => {
    const lb = canonicalise('1 lb chicken');
    expect(lb.dimension).toBe('mass');
    expect(lb.unit).toBe('g');
    expect(lb.qty).toBeCloseTo(453.592, 2);
  });

  it('prefers the longer unit token so "fl oz" is not read as an ounce of mass', () => {
    const floz = canonicalise('8 fl oz stock');
    expect(floz.dimension).toBe('volume');
    expect(floz.qty).toBeCloseTo(236.588, 2);
  });

  it('treats a number with no unit as a count', () => {
    const onions = canonicalise('2 onions, finely chopped');
    expect(onions.dimension).toBe('count');
    expect(onions.qty).toBe(2);
  });

  it('refuses to invent a quantity it does not understand', () => {
    // This is the whole point of keeping raw_text. Getting this wrong silently
    // corrupts recipes, so it is asserted rather than assumed.
    const pinch = canonicalise('a pinch of saffron');
    expect(pinch.qty).toBeNull();
    expect(pinch.dimension).toBe('none');

    const taste = canonicalise('salt to taste');
    expect(taste.qty).toBeNull();
  });

  it('handles abbreviations and plurals', () => {
    expect(canonicalise('2 tbsp oil').qty).toBeCloseTo(29.57, 1);
    expect(canonicalise('2 tablespoons oil').qty).toBeCloseTo(29.57, 1);
    expect(canonicalise('500 grams flour').qty).toBe(500);
    expect(canonicalise('2 lbs potatoes').qty).toBeCloseTo(907.18, 1);
  });
});

describe('scale', () => {
  it('scales quantities between serving counts', () => {
    expect(scale(200, 4, 8)).toBe(400);
    expect(scale(200, 4, 2)).toBe(100);
  });

  it('leaves unconvertible quantities alone', () => {
    expect(scale(null, 4, 8)).toBeNull();
  });

  it('does not divide by zero servings', () => {
    expect(scale(200, 0, 8)).toBe(200);
  });
});

describe('formatQuantity', () => {
  it('renders metric with a sensible magnitude', () => {
    expect(formatQuantity({ qty: 1500, unit: 'g', dimension: 'mass' }, 'metric')).toEqual({
      value: '1.5',
      unit: 'kg',
    });
    expect(formatQuantity({ qty: 250, unit: 'ml', dimension: 'volume' }, 'metric')).toEqual({
      value: '250',
      unit: 'ml',
    });
  });

  it('uses spoons for small volumes in metric too, because cooks do', () => {
    // "4.93 ml turmeric" is technically correct and useless to a person.
    expect(formatQuantity({ qty: 4.92892, unit: 'ml', dimension: 'volume' }, 'metric')).toEqual({
      value: '1',
      unit: 'tsp',
    });
    expect(formatQuantity({ qty: 2.46446, unit: 'ml', dimension: 'volume' }, 'metric')).toEqual({
      value: '1/2',
      unit: 'tsp',
    });
    expect(formatQuantity({ qty: 29.5736, unit: 'ml', dimension: 'volume' }, 'metric')).toEqual({
      value: '2',
      unit: 'tbsp',
    });
  });

  it('keeps weights and bulk volumes decimal in both systems', () => {
    // Fractions follow the unit, not the system: nobody writes "1 1/2 kg".
    expect(formatQuantity({ qty: 1500, unit: 'g', dimension: 'mass' }, 'imperial')?.unit).toBe('lb');
    expect(formatQuantity({ qty: 250, unit: 'ml', dimension: 'volume' }, 'metric')).toEqual({
      value: '250',
      unit: 'ml',
    });
  });

  it('renders imperial volumes as cooks actually say them', () => {
    const half = formatQuantity({ qty: 118.294, unit: 'ml', dimension: 'volume' }, 'imperial');
    expect(half).toEqual({ value: '1/2', unit: 'cup' });

    const oneAndHalf = formatQuantity({ qty: 354.882, unit: 'ml', dimension: 'volume' }, 'imperial');
    expect(oneAndHalf).toEqual({ value: '1 1/2', unit: 'cup' });
  });

  it('drops to smaller imperial units for small volumes', () => {
    const spoon = formatQuantity({ qty: 14.7868, unit: 'ml', dimension: 'volume' }, 'imperial');
    expect(spoon?.unit).toBe('tbsp');

    const tiny = formatQuantity({ qty: 4.92892, unit: 'ml', dimension: 'volume' }, 'imperial');
    expect(tiny?.unit).toBe('tsp');
  });

  it('renders counts without a unit', () => {
    expect(formatQuantity({ qty: 3, unit: 'count', dimension: 'count' }, 'metric')).toEqual({
      value: '3',
      unit: '',
    });
  });

  it('returns null when there is nothing to render, so the UI shows raw text', () => {
    expect(formatQuantity({ qty: null, unit: null, dimension: 'none' }, 'metric')).toBeNull();
  });
});

describe('parseIngredient', () => {
  it('separates the quantity from the ingredient name', () => {
    // Without this the UI prints the quantity twice: once converted, and once
    // still sitting inside the raw text.
    const result = parseIngredient('2 cups flour');
    expect(result.qty).toBeCloseTo(473.18, 1);
    expect(result.unit).toBe('ml');
    expect(result.item).toBe('flour');
  });

  it('handles a count with no unit', () => {
    const result = parseIngredient('2 medium potatoes, cubed');
    expect(result.dimension).toBe('count');
    expect(result.qty).toBe(2);
    expect(result.item).toBe('medium potatoes, cubed');
  });

  it('drops a leading "of"', () => {
    expect(parseIngredient('2 cups of milk').item).toBe('milk');
  });

  it('leaves item empty when nothing parses, so raw text is shown instead', () => {
    const result = parseIngredient('a pinch of saffron');
    expect(result.qty).toBeNull();
    expect(result.item).toBe('');
  });

  it('handles fractions and abbreviations together', () => {
    const result = parseIngredient('1/2 tsp turmeric');
    expect(result.qty).toBeCloseTo(2.46, 1);
    expect(result.item).toBe('turmeric');
  });
});

describe('formatQuantity precision', () => {
  /**
   * Every catalog recipe is written in US units, so a metric reader converts on
   * essentially every line. Two decimal places there is precise and unreadable.
   */
  it('rounds a converted pound to whole grams', () => {
    const lb = canonicalise('1 lb boneless chicken thighs');
    expect(formatQuantity(lb, 'metric')).toEqual({ value: '454', unit: 'g' });
  });

  it('rounds a converted cup to whole millilitres', () => {
    const cup = canonicalise('1 cup jasmine rice');
    expect(formatQuantity(cup, 'metric')).toEqual({ value: '237', unit: 'ml' });
  });

  /**
   * Spoons survive the conversion to metric on purpose — a metric kitchen still
   * says "2 tbsp", and "30 ml of gochujang" is nobody's instruction.
   */
  it('leaves small volumes as spoons even in metric', () => {
    const tbsp = canonicalise('2 tbsp gochujang');
    expect(formatQuantity(tbsp, 'metric')).toEqual({ value: '2', unit: 'tbsp' });
  });

  it('keeps one decimal between 1 and 10, where the fraction still matters', () => {
    expect(formatQuantity({ qty: 2.46, unit: 'g', dimension: 'mass' }, 'metric')).toEqual({
      value: '2.5',
      unit: 'g',
    });
  });

  it('keeps two decimals below 1, where 0.5 g and 1 g are different amounts', () => {
    expect(formatQuantity({ qty: 0.25, unit: 'g', dimension: 'mass' }, 'metric')).toEqual({
      value: '0.25',
      unit: 'g',
    });
  });

  it('still renders kilograms with a decimal rather than a fraction', () => {
    expect(formatQuantity({ qty: 1500, unit: 'g', dimension: 'mass' }, 'metric')).toEqual({
      value: '1.5',
      unit: 'kg',
    });
  });

  it('leaves spoon measures fractional, which is how they are spoken', () => {
    const tsp = canonicalise('1/2 tsp turmeric');
    expect(formatQuantity(tsp, 'imperial')).toEqual({ value: '1/2', unit: 'tsp' });
  });
});

describe('conversions', () => {
  it('leads with the preferred system, then offers the alternatives', () => {
    const lb = canonicalise('1 lb chicken thighs');
    expect(conversions(lb, 'imperial')).toEqual([
      { value: '1', unit: 'lb' },
      { value: '454', unit: 'g' },
      { value: '16', unit: 'oz' },
    ]);
  });

  it('leads with grams for a metric cook, same quantity', () => {
    const lb = canonicalise('1 lb chicken thighs');
    expect(conversions(lb, 'metric')[0]).toEqual({ value: '454', unit: 'g' });
  });

  it('agrees in number on cups, the one unit that has to', () => {
    expect(conversions(canonicalise('2 cups rice'), 'imperial')[0]).toEqual({
      value: '2',
      unit: 'cups',
    });
    expect(conversions(canonicalise('1 cup milk'), 'imperial')[0]).toEqual({
      value: '1',
      unit: 'cup',
    });
  });

  it('does not offer a third of a tablespoon for a teaspoon', () => {
    const units = conversions(canonicalise('1 tsp turmeric'), 'metric').map((c) => c.unit);
    expect(units).not.toContain('tbsp');
  });

  it('offers nothing for a quantity it never understood', () => {
    expect(conversions(canonicalise('a pinch of saffron'), 'metric')).toEqual([]);
  });

  it('leaves counts alone rather than inventing a mass for them', () => {
    expect(conversions(canonicalise('3 eggs'), 'imperial')).toEqual([{ value: '3', unit: '' }]);
  });
});
