import { Link } from 'wouter';
import type { RecipeSummary } from '../lib/api.ts';
import { usePhotoUrl } from '../lib/usePhotoUrl.ts';
import { Chip, type ChipTone } from './Chip.tsx';
import { Doodle, doodleFor } from './Doodle.tsx';

/**
 * The recipe card.
 *
 * The art slot is a fixed-shape pastel block holding a doodle, and a photo
 * drops into exactly that slot when one exists — same size, same corner radius,
 * so a recipe gaining a picture never reflows the list. That is what lets the
 * app look deliberate on day one with no photos at all and get richer as it
 * fills up, instead of starting out looking broken.
 */

/** Stable per-recipe tint, so a card keeps its colour between visits. */
const TONES: ChipTone[] = ['lilac', 'peach', 'mint', 'blush', 'lime'];

function toneFor(seed: string): ChipTone {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 17 + seed.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length] as ChipTone;
}

const BLOCK: Record<string, string> = {
  lilac: 'bg-lilac text-lilac-ink',
  peach: 'bg-peach text-peach-ink',
  mint: 'bg-mint text-mint-ink',
  blush: 'bg-blush text-blush-ink',
  lime: 'bg-lime text-lime-ink',
};

export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const tone = toneFor(recipe.id);
  const photoUrl = usePhotoUrl(recipe.heroPhotoId !== null ? `/api/photos/${recipe.heroPhotoId}` : null);

  return (
    <Link
      href={`/recipe/${recipe.id}`}
      className="block rounded-[var(--radius-card)] bg-card p-3 shadow-[var(--shadow-card)] transition-transform active:scale-[0.99]"
    >
      <div className="flex gap-3">
        <div
          className={`grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-block)] ${BLOCK[tone]}`}
        >
          {photoUrl !== undefined ? (
            <img src={photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <Doodle name={doodleFor(recipe.id)} className="h-14 w-14 opacity-90" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <h3 className="truncate font-display text-[1.25rem] leading-tight">{recipe.title}</h3>
          {recipe.attributedTo.length > 0 && (
            <p className="mt-0.5 truncate text-sm text-muted">{recipe.attributedTo}&rsquo;s recipe</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {recipe.rating !== null && (
              <Chip tone="lime">
                <StarGlyph /> {recipe.rating}.0
              </Chip>
            )}
            {recipe.servings !== null && (
              <Chip tone="lilac">
                <span className="tnum">serves {recipe.servings}</span>
              </Chip>
            )}
            {recipe.isFavorite && (
              <Chip tone="blush">
                <HeartGlyph /> Favourite
              </Chip>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function StarGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.44l-5.8 3.06 1.1-6.47-4.7-4.58 6.5-.95z" />
    </svg>
  );
}

function HeartGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
      <path d="M12 20s-7-4.6-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 15.4 12 20 12 20Z" />
    </svg>
  );
}
