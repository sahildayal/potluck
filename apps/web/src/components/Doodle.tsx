/**
 * Monoline food doodles.
 *
 * Hand-authored SVG in a single stroke weight, coloured by currentColor so one
 * set works on every pastel block and in both themes. They exist to make a
 * recipe without a photo look intentional rather than broken — the doodle sits
 * in exactly the slot a photo would take, so adding a picture later swaps the
 * art without shifting the layout by a pixel.
 */

export type DoodleName = 'pot' | 'whisk' | 'greens' | 'bowl' | 'loaf' | 'cup' | 'chilli' | 'egg';

const NAMES: DoodleName[] = ['pot', 'whisk', 'greens', 'bowl', 'loaf', 'cup', 'chilli', 'egg'];

/**
 * Picks a doodle from a recipe id so the same recipe always draws the same
 * thing. Random would be prettier once and maddening thereafter — the card
 * would change every render.
 */
export function doodleFor(seed: string): DoodleName {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return NAMES[hash % NAMES.length] as DoodleName;
}

const PATHS: Record<DoodleName, React.ReactNode> = {
  pot: (
    <>
      <path d="M14 26h36v18a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8V26Z" />
      <path d="M8 30h6M50 30h6" />
      <path d="M24 20c0-4 3-6 3-9M32 18c0-4 3-6 3-9M40 20c0-4 3-6 3-9" />
    </>
  ),
  whisk: (
    <>
      <path d="M32 12c-7 6-11 16-11 26M32 12c7 6 11 16 11 26M32 12v34" />
      <path d="M21 38c4 5 18 5 22 0" />
      <path d="M30 46h4v10a2 2 0 0 1-4 0V46Z" />
    </>
  ),
  greens: (
    <>
      <path d="M32 54V26" />
      <path d="M32 34c-8 0-14-5-14-12 8-2 14 3 14 12Z" />
      <path d="M32 30c8-2 14-8 12-16-8 0-13 6-12 16Z" />
      <path d="M22 54h20" />
    </>
  ),
  bowl: (
    <>
      <path d="M10 28h44c0 12-10 20-22 20S10 40 10 28Z" />
      <path d="M18 20c0-3 3-4 3-7M32 18c0-3 3-4 3-7M46 20c0-3 3-4 3-7" />
    </>
  ),
  loaf: (
    <>
      <path d="M12 34c0-8 9-14 20-14s20 6 20 14v10a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V34Z" />
      <path d="M22 28c2 4 2 8 0 12M32 26c2 5 2 10 0 15M42 28c2 4 2 8 0 12" />
    </>
  ),
  cup: (
    <>
      <path d="M14 24h30v18a10 10 0 0 1-10 10h-10a10 10 0 0 1-10-10V24Z" />
      <path d="M44 28h5a6 6 0 0 1 0 12h-5" />
      <path d="M22 16c0-3 2-4 2-6M32 16c0-3 2-4 2-6" />
    </>
  ),
  chilli: (
    <>
      <path d="M40 18c8 4 10 14 5 22-6 10-18 14-27 10 6-2 10-6 12-11 3-8 4-17 10-21Z" />
      <path d="M40 18c-1-4 1-7 5-8M45 10c3 0 5 2 6 5" />
    </>
  ),
  egg: (
    <>
      <path d="M32 12c9 0 16 12 16 22a16 16 0 0 1-32 0c0-10 7-22 16-22Z" />
      <path d="M26 34a6 6 0 0 0 8 6" />
    </>
  ),
};

export function Doodle({
  name,
  className = '',
}: {
  name: DoodleName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}

/**
 * The sign-in illustration: a pot on a hob with steam, drawn a little larger
 * and looser than the card doodles so it reads as an illustration rather than
 * an icon.
 */
export function CookingScene({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 140"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* steam */}
      <path d="M78 34c0-8 6-10 6-18M100 28c0-8 6-10 6-18M122 34c0-8 6-10 6-18" opacity="0.8" />
      {/* pot */}
      <path d="M62 52h76v34a14 14 0 0 1-14 14H76a14 14 0 0 1-14-14V52Z" />
      <path d="M52 60h10M138 60h10" />
      {/* spoon resting in the pot */}
      <path d="M116 46l14-16" />
      <path d="M130 30a5 5 0 1 0 7 7" />
      {/* counter */}
      <path d="M28 112h144" />
      {/* a jar and a bowl on the counter */}
      <path d="M36 96h18v16H36zM40 96v-5h10v5" />
      <path d="M150 104h22c0 5-5 8-11 8s-11-3-11-8Z" />
      {/* sparkles */}
      <path d="M44 40v8M40 44h8M164 62v6M161 65h6" opacity="0.7" />
    </svg>
  );
}
