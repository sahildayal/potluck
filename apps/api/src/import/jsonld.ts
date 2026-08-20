import type { RecipeDraft } from './llm.js';

/**
 * Tier 1 of the import pipeline: schema.org Recipe metadata.
 *
 * The overwhelming majority of recipe sites publish a machine-readable Recipe
 * object in a <script type="application/ld+json"> tag, because Google requires
 * it for rich results. Reading it is exact, instant, free, and burns none of
 * the LLM token budget — so it is always tried first, and the model only sees
 * pages where this comes back empty.
 *
 * The shapes in the wild vary far more than the spec suggests, which is what
 * most of this file is about.
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&frac12;': '½',
  '&frac14;': '¼',
  '&frac34;': '¾',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|frac12|frac14|frac34);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function stripHtml(text: string): string {
  return decodeEntities(text.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pulls every ld+json payload out of a page, ignoring ones that don't parse. */
export function findLdJsonBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const body = match[1];
    if (body === undefined) continue;
    try {
      blocks.push(JSON.parse(body.trim()));
    } catch {
      // A malformed block on a page is common and not worth failing over.
    }
  }
  return blocks;
}

function typesOf(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return [];
  const raw = (node as Record<string, unknown>)['@type'];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string');
  return [];
}

/**
 * Walks the whole structure looking for a Recipe node. Sites nest it under
 * @graph, inside arrays, or beside an Article node, so a shallow check misses
 * a good proportion of real pages.
 */
export function findRecipeNode(root: unknown): Record<string, unknown> | null {
  const queue: unknown[] = [root];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const node = queue.shift();
    if (typeof node !== 'object' || node === null) continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (typesOf(node).includes('Recipe')) {
      return node as Record<string, unknown>;
    }

    if (Array.isArray(node)) {
      queue.push(...node);
    } else {
      queue.push(...Object.values(node as Record<string, unknown>));
    }
  }

  return null;
}

/** "4 servings", ["6"], 4, "Serves 4-6" all have to become a number. */
export function parseYield(value: unknown): number | null {
  const candidates = Array.isArray(value) ? value : [value];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return Math.round(candidate);
    }
    if (typeof candidate === 'string') {
      const match = candidate.match(/\d+/);
      if (match) {
        const n = Number(match[0]);
        if (n > 0 && n <= 100) return n;
      }
    }
  }
  return null;
}

/**
 * Instructions arrive as plain strings, HowToStep objects, HowToSection objects
 * containing nested steps, or one HTML blob with <li> or <p> tags.
 */
export function parseInstructions(value: unknown): { body: string }[] {
  const out: { body: string }[] = [];

  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      const text = stripHtml(node);
      // A single blob containing markup is really a list; split it back apart.
      if (/<\/(li|p|br)>/i.test(node) || node.includes('\n')) {
        const parts = node
          .split(/<\/li>|<\/p>|<br\s*\/?>|\n/i)
          .map(stripHtml)
          .filter((p) => p.length > 2);
        if (parts.length > 1) {
          for (const part of parts) out.push({ body: part });
          return;
        }
      }
      if (text.length > 0) out.push({ body: text });
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (typeof node === 'object' && node !== null) {
      const record = node as Record<string, unknown>;
      // A section groups steps under itemListElement.
      if (record['itemListElement'] !== undefined) {
        visit(record['itemListElement']);
        return;
      }
      const text = record['text'] ?? record['name'] ?? record['description'];
      if (typeof text === 'string') {
        const cleaned = stripHtml(text);
        if (cleaned.length > 0) out.push({ body: cleaned });
      }
    }
  };

  visit(value);

  return out
    .map((s) => ({ body: s.body.replace(/^\s*\d+[.)]\s*/, '').trim() }))
    .filter((s) => s.body.length > 0)
    .slice(0, 100);
}

export function parseIngredients(value: unknown): { rawText: string }[] {
  if (!Array.isArray(value)) {
    if (typeof value === 'string') {
      const one = stripHtml(value);
      return one.length > 0 ? [{ rawText: one }] : [];
    }
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === 'string') return stripHtml(item);
      if (typeof item === 'object' && item !== null) {
        const text = (item as Record<string, unknown>)['name'];
        if (typeof text === 'string') return stripHtml(text);
      }
      return '';
    })
    .filter((text) => text.length > 0)
    .map((rawText) => ({ rawText }))
    .slice(0, 100);
}

/**
 * Extracts a recipe from a page's HTML.
 * Returns null when the page has no Recipe metadata, which is the signal for
 * the pipeline to fall through to the language model.
 */
export function parseRecipeFromHtml(html: string): RecipeDraft | null {
  for (const block of findLdJsonBlocks(html)) {
    const node = findRecipeNode(block);
    if (node === null) continue;

    const name = node['name'];
    const title = typeof name === 'string' ? stripHtml(name) : '';
    const ingredients = parseIngredients(node['recipeIngredient'] ?? node['ingredients']);
    const steps = parseInstructions(node['recipeInstructions']);

    // A Recipe node with no ingredients and no steps is a stub — some sites
    // emit one on category pages. Treat it as a miss so tier 2 gets a turn.
    if (ingredients.length === 0 && steps.length === 0) continue;

    const description = node['description'];

    return {
      title: title.length > 0 ? title.slice(0, 200) : 'Untitled recipe',
      servings: parseYield(node['recipeYield']),
      ingredients,
      steps,
      notes: typeof description === 'string' ? stripHtml(description).slice(0, 4000) : '',
    };
  }

  return null;
}
