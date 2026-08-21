import { primaryDuration } from '@potluck/core';
import { extractJson } from '../import/extract-json.js';
import { buildPlan, normaliseText, slugify, type Cell } from './taxonomy.js';

/**
 * Catalog generation.
 *
 * The constraint that shapes everything here is Groq's free tier: 6,000 tokens
 * per minute. That is the binding limit, not the 14,400 requests per day, so
 * the pipeline batches several recipes per request and paces itself against a
 * rolling token window rather than sleeping a fixed amount and hoping.
 *
 * It is resumable by design. A run that dies at recipe 700 should not start
 * over — existing slugs are loaded up front and skipped, so re-running simply
 * fills the gaps.
 */

export interface GeneratedRecipe {
  slug: string;
  title: string;
  summary: string;
  cuisine: string;
  mealType: string;
  mainProtein: string;
  tags: string[];
  servings: number;
  totalMinutes: number | null;
  difficulty: string;
  proteinGrams: number | null;
  calories: number | null;
  ingredients: { rawText: string }[];
  steps: { body: string; durationSeconds: number | null }[];
}

const MODEL = 'openai/gpt-oss-20b';
const BATCH_SIZE = 6;

/**
 * A starting guess only. Groq reports the real budget on every response —
 * x-ratelimit-remaining-tokens and x-ratelimit-reset-tokens — so the limiter
 * follows what the service actually says rather than a number hardcoded here.
 * Measured on 2026-08-20 the limit was 8,000 tokens/min, not the 6,000 the docs
 * implied, so this was pacing 25% slower than necessary.
 */
const ASSUMED_TOKENS_PER_MINUTE = 8000;
/** Leave headroom so a long reply does not tip us over the limit. */
const SAFETY = 0.85;

function prompt(cells: Cell[]): string {
  const briefs = cells
    .map(
      (c, i) =>
        `${i + 1}. cuisine: ${c.cuisine} | meal: ${c.mealType} | main protein: ${c.protein} | method: ${c.technique}`,
    )
    .join('\n');

  return `You write recipes for a cooking app used by people aged 20-35 in the United States. Real food they would actually cook on a weeknight, not restaurant showpieces.

Write ${cells.length} DIFFERENT recipes, one for each brief below.

${briefs}

Return ONLY a JSON array. No prose, no markdown fence. Each element:
{"title": string,
 "summary": string (one short sentence, max 90 chars),
 "servings": number,
 "totalMinutes": number,
 "difficulty": "easy" | "medium" | "hard",
 "proteinGrams": number (per serving, your best estimate),
 "calories": number (per serving, your best estimate),
 "tags": string[] (3-5 lowercase, e.g. "high-protein", "meal-prep", "one-pan"),
 "ingredients": [{"rawText": string}],
 "steps": [{"body": string}]}

Rules:
- Titles must be specific and appetising. Not "Chicken Dinner" but "Gochujang Chicken Rice Bowls".
- rawText must read like a real recipe line WITH a quantity and unit: "1 lb boneless chicken thighs", "2 tbsp soy sauce". Never bare ingredient names.
- 6 to 14 ingredients. 4 to 8 steps. Steps are full sentences with real cooking detail and timings where they matter ("sear 4 minutes until golden").
- Use US supermarket ingredients and US units (cups, tbsp, oz, lb, °F).
- proteinGrams should be honest for the dish. Do not inflate it.
- Every recipe must be genuinely different from the others in this batch.`;
}

interface Usage {
  total_tokens?: number;
}

/**
 * Paces requests against what the service reports it has left.
 *
 * An earlier version modelled a rolling one-minute window locally. That works
 * until the model is wrong — and it was, by 25% — or until something else uses
 * the same key. Reading the headers is both simpler and correct.
 */
class RateLimiter {
  private remaining = ASSUMED_TOKENS_PER_MINUTE;
  private resetAt = Date.now();

  /** Feeds back what the service said after the last call. */
  observe(headers: Headers, fallbackTokens: number): void {
    const remaining = Number(headers.get('x-ratelimit-remaining-tokens'));
    const reset = parseDuration(headers.get('x-ratelimit-reset-tokens'));

    if (Number.isFinite(remaining)) {
      this.remaining = remaining;
    } else {
      this.remaining = Math.max(0, this.remaining - fallbackTokens);
    }
    this.resetAt = Date.now() + (reset ?? 60_000);
  }

  /** After a 429 the service's view is authoritative and ours is discarded. */
  reset(): void {
    this.remaining = 0;
    this.resetAt = Date.now() + 60_000;
  }

  /** Milliseconds to wait before spending roughly `expected` more tokens. */
  waitFor(expected: number): number {
    if (this.remaining >= expected / SAFETY) return 0;
    return Math.max(0, this.resetAt - Date.now() + 500);
  }
}

/** Groq expresses resets as "577ms", "1.2s", "20m9.6s". */
export function parseDuration(value: string | null): number | null {
  if (value === null || value.length === 0) return null;
  const pattern = /([0-9.]+)(ms|s|m|h)/g;
  let total = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) continue;
    matched = true;
    const unit = match[2];
    total +=
      unit === 'ms' ? amount : unit === 's' ? amount * 1000 : unit === 'm' ? amount * 60_000 : amount * 3_600_000;
  }
  return matched ? total : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Carries the service's own retry-after so the caller does not have to guess. */
export class RateLimitError extends Error {
  constructor(
    readonly retryAfterSeconds: number,
    readonly detail: string,
  ) {
    super(`rate limited, retry in ${retryAfterSeconds}s`);
    this.name = 'RateLimitError';
  }
}

export interface GenerateOptions {
  apiKey: string;
  /** Slugs already in the catalog, so a resumed run skips them. */
  existing: Set<string>;
  target: number;
  onBatch: (recipes: GeneratedRecipe[]) => Promise<void>;
  onProgress?: (message: string) => void;
  baseUrl?: string;
}

export async function generateCatalog(options: GenerateOptions): Promise<{
  produced: number;
  skipped: number;
  failed: number;
}> {
  const { apiKey, existing, target, onBatch } = options;
  const log = options.onProgress ?? (() => {});
  const baseUrl = options.baseUrl ?? 'https://api.groq.com/openai/v1';

  // Over-plan: some cells fail validation or collide on slug, and running out
  // of plan before hitting the target is a worse failure than a longer list.
  const plan = buildPlan(Math.ceil(target * 1.6));
  const limiter = new RateLimiter();

  let produced = 0;
  let skipped = 0;
  let failed = 0;
  let consecutiveFailures = 0;

  for (let i = 0; i < plan.length && produced < target; i += BATCH_SIZE) {
    const cells = plan.slice(i, i + BATCH_SIZE);

    const estimate = 700 + cells.length * 500;
    const wait = limiter.waitFor(estimate);
    if (wait > 0) {
      log(`  pacing: waiting ${Math.round(wait / 1000)}s for token budget`);
      await sleep(wait);
    }

    let batch: GeneratedRecipe[] = [];
    try {
      const { recipes, tokens, headers } = await requestBatch(baseUrl, apiKey, cells);
      limiter.observe(headers, tokens);
      batch = recipes;
      consecutiveFailures = 0;
    } catch (error) {
      failed += 1;
      consecutiveFailures += 1;

      if (error instanceof RateLimitError) {
        // Retry the same cells rather than skipping them: a rate limit says
        // "later", not "never", and dropping the batch would leave holes in the
        // taxonomy coverage the plan was built to guarantee.
        const wait = (error.retryAfterSeconds + 2) * 1000;
        log(`  rate limited — waiting ${error.retryAfterSeconds + 2}s`);
        await sleep(wait);
        limiter.reset();
        i -= BATCH_SIZE;
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      log(`  batch failed (${message.slice(0, 140)})`);

      if (consecutiveFailures >= 3) {
        log('  backing off 60s after repeated failures');
        await sleep(60_000);
        consecutiveFailures = 0;
      }
      continue;
    }

    const fresh: GeneratedRecipe[] = [];
    for (const recipe of batch) {
      if (existing.has(recipe.slug)) {
        skipped += 1;
        continue;
      }
      existing.add(recipe.slug);
      fresh.push(recipe);
    }

    if (fresh.length > 0) {
      await onBatch(fresh);
      produced += fresh.length;
      log(`  +${fresh.length} (${produced}/${target}) — ${fresh[0]?.title ?? ''}`);
    }
  }

  return { produced, skipped, failed };
}

async function requestBatch(
  baseUrl: string,
  apiKey: string,
  cells: Cell[],
): Promise<{ recipes: GeneratedRecipe[]; tokens: number; headers: Headers }> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt(cells) }],
      // A little heat, or every Mexican dinner comes out as the same bowl.
      temperature: 0.85,
      max_tokens: 4000,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 429) {
      // Groq tells us exactly how long to wait. Honouring that beats any
      // estimate we could make from our own token accounting, which cannot see
      // usage from other clients on the same key.
      const header = response.headers.get('retry-after');
      const seconds = header !== null ? Number(header) : Number.NaN;
      const fromBody = /try again in ([0-9.]+)s/.exec(body)?.[1];
      const wait = Number.isFinite(seconds)
        ? seconds
        : fromBody !== undefined
          ? Number(fromBody)
          : 30;
      throw new RateLimitError(Math.ceil(wait), body.slice(0, 300));
    }
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: Usage;
  };

  const reply = payload.choices?.[0]?.message?.content ?? '';
  const raw = extractJson<unknown[]>(reply);
  if (!Array.isArray(raw)) throw new Error('Model did not return an array');

  const recipes = raw
    .map((item, index) => normalise(item, cells[index] ?? (cells[0] as Cell)))
    .filter((r): r is GeneratedRecipe => r !== null);

  return { recipes, tokens: payload.usage?.total_tokens ?? 2500, headers: response.headers };
}

/**
 * Validates and normalises one generated recipe.
 *
 * Returns null rather than throwing for anything unusable: one malformed
 * element should cost that recipe, not the whole batch of four.
 *
 * Exported because the offline JSONL importer must produce byte-identical rows
 * to this pipeline. Two normalisers that drift apart would mean the catalog's
 * shape depends on which route a recipe arrived by, which is exactly the kind
 * of inconsistency that is invisible until a query returns half the data.
 */
export function normalise(raw: unknown, cell: Cell): GeneratedRecipe | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;

  const title = typeof value['title'] === 'string' ? normaliseText(value['title']) : '';
  if (title.length < 3 || title.length > 120) return null;

  const ingredients = Array.isArray(value['ingredients'])
    ? value['ingredients']
        .map((i) => ({ rawText: normaliseText(String((i as { rawText?: unknown })?.rawText ?? '')) }))
        .filter((i) => i.rawText.length > 2)
    : [];

  const steps = Array.isArray(value['steps'])
    ? value['steps']
        .map((s) => normaliseText(String((s as { body?: unknown })?.body ?? '')).replace(/^\d+[.)]\s*/, ''))
        .filter((body) => body.length > 8)
        .map((body) => ({ body, durationSeconds: primaryDuration(body) }))
    : [];

  // A recipe with two ingredients and one step is not a recipe; it is the model
  // running out of attention. Better to drop it than to ship a stub.
  if (ingredients.length < 4 || steps.length < 3) return null;

  const number = (key: string, min: number, max: number): number | null => {
    const n = value[key];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    return n >= min && n <= max ? Math.round(n) : null;
  };

  const tags = Array.isArray(value['tags'])
    ? value['tags']
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.toLowerCase().trim())
        .filter((t) => t.length > 1 && t.length < 30)
        .slice(0, 6)
    : [];

  /**
   * Models inflate protein. A first run produced "73 g" for a pork serving and
   * "50 g" for a chicken salad; a realistic single portion is 15-50 g and
   * anything past 65 g means it costed the whole pan rather than one plate.
   * Since the default sort is protein-descending, the inflated values were
   * landing at the top of the catalog — the worst possible place for them.
   * Implausible figures become null rather than being clamped, because a
   * missing estimate is honest and a clamped one is a quiet fiction.
   */
  const protein = number('proteinGrams', 0, 65);
  if (protein !== null && protein >= 20 && !tags.includes('high-protein')) {
    tags.push('high-protein');
  }

  const summary =
    typeof value['summary'] === 'string' ? normaliseText(value['summary']).slice(0, 160) : '';
  const difficulty = ['easy', 'medium', 'hard'].includes(String(value['difficulty']))
    ? String(value['difficulty'])
    : 'easy';

  return {
    slug: slugify(title),
    title,
    summary,
    cuisine: cell.cuisine,
    mealType: cell.mealType,
    mainProtein: cell.protein,
    tags,
    servings: number('servings', 1, 24) ?? 2,
    totalMinutes: number('totalMinutes', 1, 1440),
    difficulty,
    proteinGrams: protein,
    calories: number('calories', 20, 3000),
    ingredients: ingredients.slice(0, 30),
    steps: steps.slice(0, 20),
  };
}
