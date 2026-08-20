/**
 * Pill chips.
 *
 * Colour carries meaning here and is never decorative: lime is always a rating,
 * lilac is always a duration, peach is always effort, blush is always a
 * favourite. Consistency is what lets someone read a card at a glance instead
 * of stopping to parse it.
 */

export type ChipTone = 'lime' | 'lilac' | 'peach' | 'blush' | 'mint' | 'plain';

const TONES: Record<ChipTone, string> = {
  lime: 'bg-lime text-lime-ink',
  lilac: 'bg-lilac text-lilac-ink',
  peach: 'bg-peach text-peach-ink',
  blush: 'bg-blush text-blush-ink',
  mint: 'bg-mint text-mint-ink',
  plain: 'bg-raised text-muted',
};

export function Chip({
  tone = 'plain',
  children,
  className = '',
}: {
  tone?: ChipTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.8125rem] leading-tight font-semibold ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** The word-pill treatment from the reference, for hero copy. */
export function WordPills({ words }: { words: { text: string; tone: ChipTone }[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-2">
      {words.map((word) => (
        <span
          key={word.text}
          className={`rounded-full px-3 py-0.5 ${TONES[word.tone]}`}
        >
          {word.text}
        </span>
      ))}
    </span>
  );
}
