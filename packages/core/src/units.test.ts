import { describe, expect, it } from 'vitest';
import { canonicalise, formatQuantity, parseQuantity, scale } from './units.js';

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
