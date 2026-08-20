/**
 * Pulls cooking durations out of step text so Cooking Mode can offer a
 * one-tap timer without anyone configuring anything.
 *
 * Deliberately conservative. A missed timer costs nothing — the user reads the
 * step and sets their own. A wrong timer ruins dinner. So we only match phrases
 * where a number sits directly against a time unit, and we ignore durations
 * that are clearly not timers (oven temperatures, "350F for 25 minutes" still
 * yields 25 minutes, but "serves 4" yields nothing).
 */

export interface DetectedDuration {
  seconds: number;
  /** The exact substring matched, so the UI can highlight it in the step. */
  text: string;
  /** Character offset of the match within the step body. */
  index: number;
}

const UNIT_SECONDS: Record<string, number> = {
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  s: 1,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  m: 60,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  h: 3600,
};

// "10 minutes", "1 hour", "90 sec", "1-2 hours", "5 to 10 minutes".
// The range form takes the LOWER bound: a timer that fires early prompts you to
// check, which is the safe direction to be wrong in.
const PATTERN = new RegExp(
  String.raw`(\d+(?:\.\d+)?)\s*(?:(?:-|–|to)\s*\d+(?:\.\d+)?\s*)?(${Object.keys(UNIT_SECONDS)
    .sort((a, b) => b.length - a.length)
    .join('|')})\b`,
  'gi',
);

/**
 * Finds every duration in a step, in order of appearance.
 * "Bake 1 hour, then rest 10 minutes" yields two.
 */
export function detectDurations(step: string): DetectedDuration[] {
  const found: DetectedDuration[] = [];
  PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = PATTERN.exec(step)) !== null) {
    const amount = match[1];
    const unit = match[2];
    if (amount === undefined || unit === undefined) continue;

    const perUnit = UNIT_SECONDS[unit.toLowerCase()];
    if (perUnit === undefined) continue;

    const seconds = Math.round(Number(amount) * perUnit);
    // A single-letter "m" or "s" is ambiguous enough that we require it to be
    // preceded by a digit with no space, e.g. "30s" — the regex allows a space,
    // so filter the noisy case out here.
    if (unit.length === 1 && /\s/.test(match[0])) continue;
    if (seconds <= 0 || seconds > 24 * 3600) continue;

    found.push({ seconds, text: match[0], index: match.index });
  }

  return mergeAdjacent(found, step);
}

/**
 * "1 hour 30 minutes" arrives as two matches that are really one duration.
 * If a smaller unit follows a larger one within a couple of characters, fold
 * them together.
 */
function mergeAdjacent(list: DetectedDuration[], step: string): DetectedDuration[] {
  const out: DetectedDuration[] = [];

  for (const current of list) {
    const previous = out[out.length - 1];
    if (previous === undefined) {
      out.push(current);
      continue;
    }

    const gapStart = previous.index + previous.text.length;
    const gap = step.slice(gapStart, current.index);
    const adjacent = /^[\s,and]*$/i.test(gap) && gap.length <= 6;

    if (adjacent && current.seconds < previous.seconds) {
      out[out.length - 1] = {
        seconds: previous.seconds + current.seconds,
        text: step.slice(previous.index, current.index + current.text.length),
        index: previous.index,
      };
    } else {
      out.push(current);
    }
  }

  return out;
}

/** The duration a Cooking Mode timer button should offer for a step, if any. */
export function primaryDuration(step: string): number | null {
  const all = detectDurations(step);
  if (all.length === 0) return null;
  // Longest wins — "bake 40 minutes, checking every 5" should offer 40.
  return all.reduce((max, d) => (d.seconds > max ? d.seconds : max), 0);
}

/** "1:30:00" style label for a running timer. */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
