import { describe, expect, it } from 'vitest';
import { toLines, toParagraphs } from './RecipeEditor.tsx';

/**
 * The editor takes free text and turns it into structured ingredients and
 * steps. That conversion is where a typed recipe silently loses a line or gains
 * an empty one, so it is worth pinning down even though the surrounding screen
 * is only covered end to end.
 */

describe('toLines', () => {
  it('splits ingredients one per line', () => {
    expect(toLines('2 cups flour\n1 tsp salt')).toEqual(['2 cups flour', '1 tsp salt']);
  });

  it('drops blank lines people type out of habit', () => {
    expect(toLines('2 cups flour\n\n\n1 tsp salt\n')).toEqual(['2 cups flour', '1 tsp salt']);
  });

  it('trims stray whitespace without touching the words', () => {
    expect(toLines('  a pinch of saffron  ')).toEqual(['a pinch of saffron']);
  });

  it('returns nothing for empty input rather than one empty ingredient', () => {
    expect(toLines('   \n \n ')).toEqual([]);
  });
});

describe('toParagraphs', () => {
  it('treats a blank line as a step break', () => {
    expect(toParagraphs('Heat the oil.\n\nAdd the onions.')).toEqual([
      'Heat the oil.',
      'Add the onions.',
    ]);
  });

  it('joins a wrapped step back into one sentence', () => {
    // A step typed across several lines is still one step; splitting on every
    // newline would turn a long instruction into fragments.
    expect(toParagraphs('Heat the oil until it\nshimmers, then add cumin.')).toEqual([
      'Heat the oil until it shimmers, then add cumin.',
    ]);
  });

  it('tolerates several blank lines between steps', () => {
    expect(toParagraphs('One.\n\n\n\nTwo.')).toHaveLength(2);
  });

  it('ignores trailing whitespace at the end of the box', () => {
    expect(toParagraphs('Only step.\n\n\n')).toEqual(['Only step.']);
  });
});
