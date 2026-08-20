import { describe, expect, it } from 'vitest';
import { doodleFor } from './Doodle.tsx';

/**
 * A card's doodle must be stable for a given recipe. Random would look charming
 * once and be maddening thereafter — the illustration would change on every
 * render, and the list would appear to reshuffle itself while you scrolled.
 */
describe('doodleFor', () => {
  it('returns the same doodle for the same id every time', () => {
    const id = '329af999-6615-4910-adf1-47f0fcaafe33';
    const first = doodleFor(id);
    for (let i = 0; i < 20; i += 1) {
      expect(doodleFor(id)).toBe(first);
    }
  });

  it('spreads different ids across the available doodles', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(doodleFor(`recipe-${i}`));
    // Not asserting a perfect distribution, just that it is not effectively
    // constant — a hash that always returns "pot" would pass the test above.
    expect(seen.size).toBeGreaterThan(4);
  });

  it('handles an empty seed without throwing', () => {
    expect(() => doodleFor('')).not.toThrow();
  });
});
