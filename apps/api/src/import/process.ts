import { parseRecipeFromHtml } from './jsonld.js';
import { GroqProvider, LlmUnavailableError, type LlmProvider, type RecipeDraft } from './llm.js';

/**
 * Turning one import job into a recipe draft.
 *
 * Tiered deliberately, cheapest and most reliable first:
 *
 *   1. schema.org metadata on the page. Exact, instant, free, and it covers the
 *      overwhelming majority of recipe sites.
 *   2. the page's visible text through a language model, when tier 1 finds
 *      nothing.
 *   3. for photos, a vision model reading the image directly.
 *
 * Nothing here writes a recipe. Every path produces a DRAFT that a human
 * confirms on the review screen, which is what makes an unreliable extractor
 * acceptable: a bad parse becomes an edit, not a corrupted recipe.
 */

export type JobKind = 'url' | 'image' | 'text';

export interface ProcessResult {
  draft: RecipeDraft;
  /** Which tier produced it, so the review screen can set expectations. */
  via: 'metadata' | 'model' | 'vision';
}

export class UnprocessableImport extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'UnprocessableImport';
  }
}

/** Platforms that will not give us the content, however politely we ask. */
const WALLED = [
  'instagram.com',
  'tiktok.com',
  'facebook.com',
  'fb.watch',
  'pinterest.com',
];

export async function processJob(
  kind: JobKind,
  payload: string,
  options: { llm?: LlmProvider; groqApiKey?: string | undefined } = {},
): Promise<ProcessResult> {
  const llm =
    options.llm ??
    (options.groqApiKey !== undefined && options.groqApiKey.length > 0
      ? new GroqProvider({ apiKey: options.groqApiKey })
      : undefined);

  if (kind === 'text') {
    if (llm === undefined) throw new UnprocessableImport('Extraction is not configured', false);
    return { draft: await llm.fromText(payload), via: 'model' };
  }

  if (kind === 'image') {
    if (llm === undefined) throw new UnprocessableImport('Extraction is not configured', false);
    const [meta, data] = splitDataUrl(payload);
    return { draft: await llm.fromImage(data, meta), via: 'vision' };
  }

  return processUrl(payload, llm);
}

async function processUrl(url: string, llm: LlmProvider | undefined): Promise<ProcessResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnprocessableImport('That does not look like a link', false);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnprocessableImport('Only http and https links can be read', false);
  }

  const host = parsed.hostname.replace(/^www\./, '');
  if (WALLED.some((walled) => host === walled || host.endsWith(`.${walled}`))) {
    // Being honest beats failing mysteriously. These platforms prohibit
    // programmatic access to post content and do not expose it to third
    // parties; scraping them would breach their terms and break within months.
    throw new UnprocessableImport(
      `${host} does not let apps read its posts. Screenshot the recipe and import that instead — it works every time.`,
      false,
    );
  }

  let html: string;
  try {
    const response = await fetch(parsed.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PotluckBot/0.1; +https://github.com/sahildayal/potluck)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new UnprocessableImport(
        `That page returned ${response.status}. Check the link, or screenshot the recipe instead.`,
        response.status >= 500,
      );
    }
    html = await response.text();
  } catch (error) {
    if (error instanceof UnprocessableImport) throw error;
    throw new UnprocessableImport('Could not reach that page', true);
  }

  const fromMetadata = parseRecipeFromHtml(html);
  if (fromMetadata !== null) {
    return { draft: fromMetadata, via: 'metadata' };
  }

  if (llm === undefined) {
    throw new UnprocessableImport(
      'That page has no recipe data we can read, and extraction is not configured.',
      false,
    );
  }

  try {
    return { draft: await llm.fromText(visibleText(html)), via: 'model' };
  } catch (error) {
    if (error instanceof LlmUnavailableError) {
      throw new UnprocessableImport(error.message, error.retryable);
    }
    throw new UnprocessableImport('Could not read a recipe from that page', false);
  }
}

/**
 * Strips a page down to readable text before sending it to a model.
 *
 * Not for tidiness — for cost. A modern recipe page is mostly script, style and
 * navigation, and the free tier allows 6,000 tokens a minute. Sending the raw
 * HTML would spend the whole budget on markup.
 */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12_000);
}

function splitDataUrl(payload: string): [string, Buffer] {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(payload);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new UnprocessableImport('That image could not be read', false);
  }
  return [match[1], Buffer.from(match[2], 'base64')];
}
