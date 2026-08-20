import { describe, expect, it } from 'vitest';
import {
  findRecipeNode,
  parseIngredients,
  parseInstructions,
  parseRecipeFromHtml,
  parseYield,
} from './jsonld.js';

/**
 * These fixtures reproduce the shapes real recipe sites actually publish, not
 * the tidy example in the schema.org docs. Every case here corresponds to a
 * pattern that breaks a naive implementation.
 */

const page = (ld: unknown): string =>
  `<!doctype html><html><head><title>x</title>
   <script type="application/ld+json">${JSON.stringify(ld)}</script>
   </head><body><p>page content</p></body></html>`;

describe('findRecipeNode', () => {
  it('finds a Recipe at the top level', () => {
    expect(findRecipeNode({ '@type': 'Recipe', name: 'Dal' })).not.toBeNull();
  });

  it('finds a Recipe nested inside @graph, which WordPress sites all use', () => {
    const node = findRecipeNode({
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'WebPage' }, { '@type': 'Recipe', name: 'Dal' }],
    });
    expect(node?.['name']).toBe('Dal');
  });

  it('finds a Recipe when @type is an array', () => {
    const node = findRecipeNode({ '@type': ['Recipe', 'NewsArticle'], name: 'Dal' });
    expect(node?.['name']).toBe('Dal');
  });

  it('returns null on a page with metadata but no recipe', () => {
    expect(findRecipeNode({ '@type': 'Article', headline: 'Ten best pans' })).toBeNull();
  });
});

describe('parseYield', () => {
  it('reads a plain number', () => {
    expect(parseYield(4)).toBe(4);
  });

  it('reads "4 servings"', () => {
    expect(parseYield('4 servings')).toBe(4);
  });

  it('reads an array, which many sites emit', () => {
    expect(parseYield(['6', '6 servings'])).toBe(6);
  });

  it('takes the first number from a range', () => {
    expect(parseYield('Serves 4-6')).toBe(4);
  });

  it('returns null rather than guessing', () => {
    expect(parseYield('a generous amount')).toBeNull();
    expect(parseYield(undefined)).toBeNull();
  });
});

describe('parseIngredients', () => {
  it('reads a list of strings', () => {
    const result = parseIngredients(['2 cups flour', '1 tsp salt']);
    expect(result).toEqual([{ rawText: '2 cups flour' }, { rawText: '1 tsp salt' }]);
  });

  it('decodes HTML entities so fractions survive', () => {
    expect(parseIngredients(['1&frac12; cups sugar'])[0]?.rawText).toBe('1½ cups sugar');
    expect(parseIngredients(['salt &amp; pepper'])[0]?.rawText).toBe('salt & pepper');
  });

  it('strips inline markup', () => {
    expect(parseIngredients(['<span>2 cups</span> flour'])[0]?.rawText).toBe('2 cups flour');
  });

  it('preserves the original wording exactly, because raw_text is a promise', () => {
    // The whole units design depends on never rewording the source.
    const result = parseIngredients(['a generous pinch of saffron']);
    expect(result[0]?.rawText).toBe('a generous pinch of saffron');
  });
});

describe('parseInstructions', () => {
  it('reads HowToStep objects', () => {
    const result = parseInstructions([
      { '@type': 'HowToStep', text: 'Heat the oil.' },
      { '@type': 'HowToStep', text: 'Add the onions.' },
    ]);
    expect(result).toEqual([{ body: 'Heat the oil.' }, { body: 'Add the onions.' }]);
  });

  it('reads plain strings', () => {
    expect(parseInstructions(['Heat the oil.', 'Add the onions.'])).toHaveLength(2);
  });

  it('flattens HowToSection groups into their steps', () => {
    const result = parseInstructions([
      {
        '@type': 'HowToSection',
        name: 'For the sauce',
        itemListElement: [
          { '@type': 'HowToStep', text: 'Blend the tomatoes.' },
          { '@type': 'HowToStep', text: 'Simmer 20 minutes.' },
        ],
      },
    ]);
    expect(result).toEqual([{ body: 'Blend the tomatoes.' }, { body: 'Simmer 20 minutes.' }]);
  });

  it('splits a single HTML blob back into steps', () => {
    const result = parseInstructions('<li>Heat the oil.</li><li>Add the onions.</li>');
    expect(result).toHaveLength(2);
    expect(result[1]?.body).toBe('Add the onions.');
  });

  it('strips leading step numbers the site baked into the text', () => {
    const result = parseInstructions(['1. Heat the oil.', '2) Add the onions.']);
    expect(result).toEqual([{ body: 'Heat the oil.' }, { body: 'Add the onions.' }]);
  });
});

describe('parseRecipeFromHtml', () => {
  it('extracts a complete recipe with no AI involved', () => {
    const html = page({
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: 'Dadi&#39;s Aloo Gobi',
      recipeYield: '4 servings',
      description: 'A weeknight staple.',
      recipeIngredient: ['2 medium potatoes, cubed', '1 tsp cumin seeds'],
      recipeInstructions: [
        { '@type': 'HowToStep', text: 'Heat oil, crackle cumin 30 seconds.' },
        { '@type': 'HowToStep', text: 'Add potatoes, fry 8 minutes.' },
      ],
    });

    const recipe = parseRecipeFromHtml(html);
    expect(recipe).not.toBeNull();
    expect(recipe?.title).toBe("Dadi's Aloo Gobi");
    expect(recipe?.servings).toBe(4);
    expect(recipe?.ingredients).toHaveLength(2);
    expect(recipe?.steps[0]?.body).toBe('Heat oil, crackle cumin 30 seconds.');
    expect(recipe?.notes).toBe('A weeknight staple.');
  });

  it('handles the @graph wrapper WordPress food blogs emit', () => {
    const html = page({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'Some Blog' },
        {
          '@type': 'Recipe',
          name: 'Chana Masala',
          recipeIngredient: ['1 tin chickpeas'],
          recipeInstructions: ['Simmer everything 25 minutes.'],
        },
      ],
    });
    expect(parseRecipeFromHtml(html)?.title).toBe('Chana Masala');
  });

  it('returns null for a page with no recipe, so tier 2 gets a turn', () => {
    const html = page({ '@type': 'Article', headline: 'The ten best saucepans' });
    expect(parseRecipeFromHtml(html)).toBeNull();
  });

  it('treats an empty Recipe stub as a miss', () => {
    // Category pages sometimes emit a Recipe node with nothing in it.
    const html = page({ '@type': 'Recipe', name: 'Recipes' });
    expect(parseRecipeFromHtml(html)).toBeNull();
  });

  it('survives a malformed ld+json block elsewhere on the page', () => {
    const html = `<html><head>
      <script type="application/ld+json">{ this is not json }</script>
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Recipe',
        name: 'Khichdi',
        recipeIngredient: ['1 cup rice'],
        recipeInstructions: ['Cook until soft.'],
      })}</script></head><body></body></html>`;
    expect(parseRecipeFromHtml(html)?.title).toBe('Khichdi');
  });

  it('returns null on a page with no metadata at all', () => {
    expect(parseRecipeFromHtml('<html><body>just a page</body></html>')).toBeNull();
  });
});
