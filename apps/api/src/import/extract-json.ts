/**
 * Pulling structured data back out of a language model's reply.
 *
 * This is less trivial than it looks and it is worth doing carefully, because
 * every recipe import depends on it. The models available to us wrap their
 * answers in ways that break a naive JSON.parse:
 *
 *   - qwen3.6 emits a <think>...</think> block of reasoning first
 *   - most models fence the payload in ```json ... ```
 *   - some add a sentence of preamble no matter how firmly you ask them not to
 *   - occasionally the reply is truncated mid-object by a token limit
 *
 * Rather than fight the model with prompt tuning, we accept all of the above
 * and extract defensively.
 */

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

/** Strips reasoning blocks that some models emit before their real answer. */
export function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    // An unclosed block means the reply was cut off inside the reasoning; there
    // is no answer after it, so drop everything from the opening tag.
    .replace(/<think(?:ing)?>[\s\S]*$/i, '')
    .trim();
}

/**
 * Finds the first balanced JSON object or array in a string.
 *
 * Scans rather than regexes, because braces nest and appear inside strings —
 * `{"note":"use a 1/2 } cup"}` defeats any regex worth reading.
 */
export function findJsonSpan(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;

  const opener = text[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === opener) depth += 1;
    else if (ch === closer) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Best-effort recovery for a reply the model ran out of tokens mid-way through.
 * Closes any open string, then any open brackets, so a truncated import yields
 * most of a recipe for the user to finish rather than nothing at all.
 */
function repairTruncated(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }

  if (stack.length === 0) return null;

  let repaired = text.slice(start);
  if (inString) repaired += '"';
  // Drop a dangling comma or half-written key before closing.
  repaired = repaired.replace(/,\s*("[^"]*"\s*:?\s*)?$/, '');
  while (stack.length > 0) repaired += stack.pop();

  return repaired;
}

/**
 * Extracts and parses JSON from a model reply.
 * Throws ExtractionError with the raw text attached, so a failed import can
 * show the user what actually came back instead of a generic error.
 */
export function extractJson<T = unknown>(reply: string): T {
  const cleaned = stripReasoning(reply);

  const span = findJsonSpan(cleaned);
  if (span !== null) {
    try {
      return JSON.parse(span) as T;
    } catch {
      // fall through to repair
    }
  }

  const repaired = repairTruncated(cleaned);
  if (repaired !== null) {
    try {
      return JSON.parse(repaired) as T;
    } catch {
      // fall through to the error below
    }
  }

  throw new ExtractionError('No parseable JSON in model reply', reply);
}
