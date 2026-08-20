import { extractJson } from './extract-json.js';

/**
 * The language-model seam.
 *
 * Everything the app needs from an LLM goes through this interface, so the
 * provider is a swap rather than a rewrite. That matters more than usual here:
 * we are on a free tier that has already moved once. The architecture doc
 * assumed Llama 4 Scout for vision; when the key was issued, Scout was not
 * available on the account and qwen3.6-27b was. Nothing above this file changed.
 */

export interface RecipeDraft {
  title: string;
  servings: number | null;
  ingredients: { rawText: string }[];
  steps: { body: string }[];
  notes?: string;
}

export interface LlmProvider {
  /** Turn a block of recipe text into structured fields. */
  fromText(text: string): Promise<RecipeDraft>;
  /** Read a photo or screenshot of a recipe. */
  fromImage(image: Buffer, contentType: string): Promise<RecipeDraft>;
}

export class LlmUnavailableError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

const SCHEMA_PROMPT = `Extract the recipe as JSON only. No prose, no explanation.

Schema:
{"title": string,
 "servings": number or null,
 "ingredients": [{"rawText": string}],
 "steps": [{"body": string}],
 "notes": string}

Rules:
- rawText must be the ingredient line EXACTLY as written, including quantities
  and units. Do not normalise, convert, or reword it.
- steps must be in order, one instruction each, without leading numbers.
- If a field is genuinely absent, use null or an empty array. Never invent
  quantities, servings, or steps that are not present.`;

interface GroqOptions {
  apiKey: string;
  /** Text-only extraction. Cheap and fast. */
  textModel?: string;
  /** Vision-capable model for photos and screenshots. */
  visionModel?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

interface ChatContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export class GroqProvider implements LlmProvider {
  private readonly apiKey: string;
  private readonly textModel: string;
  private readonly visionModel: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: GroqOptions) {
    this.apiKey = options.apiKey;
    // Verified available on the free tier on 2026-08-19. gpt-oss-20b handles
    // text extraction in ~280 tokens; qwen3.6-27b is the only multimodal model
    // the account can reach.
    this.textModel = options.textModel ?? 'openai/gpt-oss-20b';
    this.visionModel = options.visionModel ?? 'qwen/qwen3.6-27b';
    this.baseUrl = options.baseUrl ?? 'https://api.groq.com/openai/v1';
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  async fromText(text: string): Promise<RecipeDraft> {
    // Trim aggressively: the free tier allows 6,000 tokens per minute, and a
    // whole scraped page will blow that on a single import.
    const clipped = text.slice(0, 12_000);
    return this.complete(this.textModel, [
      { type: 'text', text: `${SCHEMA_PROMPT}\n\nRecipe text:\n${clipped}` },
    ]);
  }

  async fromImage(image: Buffer, contentType: string): Promise<RecipeDraft> {
    const dataUrl = `data:${contentType};base64,${image.toString('base64')}`;
    return this.complete(this.visionModel, [
      { type: 'text', text: SCHEMA_PROMPT },
      { type: 'image_url', image_url: { url: dataUrl } },
    ]);
  }

  private async complete(model: string, content: ChatContentPart[]): Promise<RecipeDraft> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content }],
          temperature: 0,
          max_tokens: 2000,
        }),
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new LlmUnavailableError(
        aborted ? 'Extraction timed out' : 'Could not reach the extraction service',
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // 429 is the free tier's tokens-per-minute ceiling. It is expected under
      // load and the job should go back on the queue rather than fail the user.
      const retryable = response.status === 429 || response.status >= 500;
      throw new LlmUnavailableError(
        `Extraction service returned ${response.status}: ${body.slice(0, 200)}`,
        retryable,
      );
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const reply = payload.choices?.[0]?.message?.content;
    if (reply === undefined || reply.length === 0) {
      throw new LlmUnavailableError('Extraction service returned an empty reply', true);
    }

    return normaliseDraft(extractJson<Partial<RecipeDraft>>(reply));
  }
}

/**
 * Models are cooperative but not reliable about shape. Normalise before this
 * ever reaches the review screen, so the UI can assume the structure holds.
 */
export function normaliseDraft(raw: Partial<RecipeDraft>): RecipeDraft {
  const ingredients = Array.isArray(raw.ingredients) ? raw.ingredients : [];
  const steps = Array.isArray(raw.steps) ? raw.steps : [];

  return {
    title: typeof raw.title === 'string' && raw.title.trim().length > 0
      ? raw.title.trim().slice(0, 200)
      : 'Untitled recipe',
    servings:
      typeof raw.servings === 'number' && Number.isFinite(raw.servings) && raw.servings > 0
        ? Math.round(raw.servings)
        : null,
    ingredients: ingredients
      .map((i) => ({ rawText: String((i as { rawText?: unknown })?.rawText ?? '').trim() }))
      .filter((i) => i.rawText.length > 0)
      .slice(0, 100),
    steps: steps
      .map((s) => ({
        // Models re-add "1. " despite being asked not to; strip it once here
        // rather than in every consumer.
        body: String((s as { body?: unknown })?.body ?? '')
          .trim()
          .replace(/^\s*\d+[.)]\s*/, ''),
      }))
      .filter((s) => s.body.length > 0)
      .slice(0, 100),
    notes: typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 4000) : '',
  };
}
