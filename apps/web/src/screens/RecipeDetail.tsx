import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { formatQuantity, scale, type UnitSystem } from '@potluck/core';
import { api, ApiError, type PhotoSummary, type SessionUser } from '../lib/api.ts';
import { encodeForUpload, formatBytes } from '../lib/downscale.ts';
import { usePhotoUrl } from '../lib/usePhotoUrl.ts';
import { Chip } from '../components/Chip.tsx';
import { Doodle, doodleFor } from '../components/Doodle.tsx';
import { Attempts } from '../components/Attempts.tsx';

export function RecipeDetail({ id, user }: { id: string; user: SessionUser }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => api.recipes.get(id),
  });

  const recipe = data?.recipe;
  const [servings, setServings] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [shareTo, setShareTo] = useState('');
  const [shareNote, setShareNote] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['recipe', id] });
    void queryClient.invalidateQueries({ queryKey: ['recipes'] });
  };

  const favorite = useMutation({
    mutationFn: (next: boolean) => api.recipes.setFavorite(id, next),
    onSuccess: refresh,
  });
  const rate = useMutation({
    mutationFn: (next: number | null) => api.recipes.setRating(id, next),
    onSuccess: refresh,
  });
  const share = useMutation({
    mutationFn: (handle: string) => api.social.share(id, handle),
    onSuccess: () => {
      setShareTo('');
      setShareNote('Shared. They will see it under Friends.');
    },
    onError: () => setShareNote('No one with that handle, or you do not own this recipe.'),
  });

  const toShopping = useMutation({
    mutationFn: () => api.shopping.fromRecipe(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shopping'] });
      navigate('/shopping');
    },
  });

  const system: UnitSystem = user.unitPreference === 'imperial' ? 'imperial' : 'metric';
  const baseServings = recipe?.servings ?? null;
  const shownServings = servings ?? baseServings;

  const ingredients = useMemo(() => {
    if (recipe === undefined) return [];
    return recipe.ingredients.map((ingredient) => {
      const canonical = {
        qty: ingredient.qtyCanonical,
        unit: ingredient.unitCanonical,
        dimension: ingredient.dimension,
      };
      const scaled =
        baseServings !== null && shownServings !== null
          ? scale(canonical.qty, baseServings, shownServings)
          : canonical.qty;
      return { ingredient, formatted: formatQuantity({ ...canonical, qty: scaled }, system) };
    });
  }, [recipe, baseServings, shownServings, system]);

  if (isLoading) return <Centered>Fetching the recipe…</Centered>;
  if (isError || recipe === undefined) return <Centered>Couldn&rsquo;t find that recipe.</Centered>;

  const mine = recipe.ownerId === user.id;
  const hero = recipe.photos.find((p) => p.isHero) ?? recipe.photos[0];

  return (
    <article className="wash-blush safe-top min-h-dvh pb-32">
      <div className="mx-auto w-full max-w-2xl px-5">
        <nav className="flex items-center justify-between py-4">
          <Link
            href="/"
            aria-label="Back to recipes"
            className="grid h-10 w-10 place-items-center rounded-full bg-surface text-xl leading-none shadow-[var(--shadow-card)]"
          >
            &larr;
          </Link>
          <div className="flex items-center gap-2">
            {mine && (
              <Link
                href={`/recipe/${id}/edit`}
                className="rounded-full bg-surface px-4 py-2 text-sm font-bold shadow-[var(--shadow-card)]"
              >
                Edit
              </Link>
            )}
            <button
              type="button"
              onClick={() => favorite.mutate(!recipe.isFavorite)}
              aria-pressed={recipe.isFavorite}
              aria-label={recipe.isFavorite ? 'Remove from favourites' : 'Add to favourites'}
              className={`grid h-10 w-10 place-items-center rounded-full shadow-[var(--shadow-card)] ${
                recipe.isFavorite ? 'bg-blush text-blush-ink' : 'bg-surface text-muted'
              }`}
            >
              <Heart filled={recipe.isFavorite} />
            </button>
          </div>
        </nav>

        <HeroImage recipeId={recipe.id} photo={hero} />

        <header className="mt-5">
          <h1 className="font-display text-[2.25rem] leading-[1.05]">{recipe.title}</h1>
          {recipe.attributedTo.length > 0 && (
            <p className="mt-1.5 font-semibold text-muted">{recipe.attributedTo}&rsquo;s recipe</p>
          )}
        </header>

        {recipe.story.length > 0 && (
          <p className="mt-4 rounded-[var(--radius-block)] bg-card p-4 text-muted italic shadow-[var(--shadow-card)]">
            {recipe.story}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {baseServings !== null && (
            <div className="flex items-center gap-1 rounded-full bg-lilac px-2 py-1 text-lilac-ink">
              <Step
                label="Fewer servings"
                onClick={() => setServings(Math.max(1, (shownServings ?? 1) - 1))}
              >
                &minus;
              </Step>
              <span className="tnum px-1 text-sm font-bold">serves {shownServings}</span>
              <Step
                label="More servings"
                onClick={() => setServings(Math.min(100, (shownServings ?? 1) + 1))}
              >
                +
              </Step>
            </div>
          )}
          <Rating value={recipe.rating} onChange={(next) => rate.mutate(next)} />
        </div>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl">Ingredients</h2>
            <button
              type="button"
              onClick={() => toShopping.mutate()}
              disabled={toShopping.isPending}
              className="shrink-0 rounded-full bg-mint px-4 py-2 text-sm font-bold text-mint-ink disabled:opacity-60"
            >
              {toShopping.isPending ? 'Adding…' : 'Add to shopping'}
            </button>
          </div>

          <ul className="rounded-[var(--radius-card)] bg-card p-2 shadow-[var(--shadow-card)]">
            {ingredients.map(({ ingredient, formatted }, index) => {
              const key = ingredient.id ?? String(index);
              const isChecked = checked.has(key);
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() =>
                      setChecked((previous) => {
                        const next = new Set(previous);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    aria-pressed={isChecked}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                      isChecked ? 'text-muted line-through' : ''
                    }`}
                  >
                    <span
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                        isChecked ? 'border-mint-ink bg-mint text-mint-ink' : 'border-line-strong'
                      }`}
                    >
                      {isChecked && <Tick />}
                    </span>
                    <span>
                      {/* An unparsed measurement shows the source's own words.
                          "a pinch of saffron" must never become "0.5 ml". */}
                      {formatted !== null && ingredient.item.length > 0 ? (
                        <>
                          <span className="tnum font-bold">
                            {formatted.value}
                            {formatted.unit.length > 0 ? ` ${formatted.unit}` : ''}
                          </span>{' '}
                          {ingredient.item}
                        </>
                      ) : (
                        ingredient.rawText
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 font-display text-2xl">Method</h2>
          <ol className="flex flex-col gap-2.5">
            {recipe.steps.map((step, index) => (
              <li
                key={step.id ?? index}
                className="flex gap-3 rounded-[var(--radius-block)] bg-card p-4 shadow-[var(--shadow-card)]"
              >
                <span className="tnum grid h-7 w-7 shrink-0 place-items-center rounded-full bg-lime font-display text-sm text-lime-ink">
                  {index + 1}
                </span>
                <div className="flex-1">
                  <p>{step.body}</p>
                  {step.durationSeconds !== null && step.durationSeconds !== undefined && (
                    <Chip tone="lilac" className="mt-2">
                      timer ready
                    </Chip>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {mine && <PhotoManager recipeId={id} photos={recipe.photos} />}

        {mine && (
          <section className="mt-8">
            <h2 className="mb-3 font-display text-2xl">Share it</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setShareNote(null);
                share.mutate(shareTo.trim().toLowerCase());
              }}
              className="flex gap-2"
            >
              <input
                value={shareTo}
                onChange={(e) => setShareTo(e.target.value)}
                placeholder="A friend's handle"
                aria-label="Share with a handle"
                autoCapitalize="none"
                className="min-w-0 flex-1 rounded-full border-2 border-line bg-surface px-5 py-3 outline-none focus:border-ink"
              />
              <button
                type="submit"
                disabled={shareTo.trim().length === 0 || share.isPending}
                className="shrink-0 rounded-full bg-primary px-5 py-3 font-bold text-primary-ink disabled:opacity-40"
              >
                Share
              </button>
            </form>
            {shareNote !== null && (
              <p className="mt-2 rounded-2xl bg-lilac px-4 py-2.5 text-sm font-semibold text-lilac-ink">
                {shareNote}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">
              Sharing lets them read and cook it. It never lets them edit yours.
            </p>
          </section>
        )}

        <Attempts recipeId={id} user={user} />

        {recipe.notes.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 font-display text-2xl">Notes</h2>
            <p className="rounded-[var(--radius-block)] bg-card p-4 whitespace-pre-wrap text-muted shadow-[var(--shadow-card)]">
              {recipe.notes}
            </p>
          </section>
        )}
      </div>

      {recipe.steps.length > 0 && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 flex justify-center px-5 pb-4">
          <Link
            href={`/recipe/${id}/cook`}
            className="flex w-full max-w-md items-center justify-center rounded-full bg-primary px-6 py-4 font-bold text-primary-ink shadow-[var(--shadow-lift)]"
          >
            Start cooking
          </Link>
        </div>
      )}
    </article>
  );
}

function Step({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-6 w-6 place-items-center rounded-full bg-surface text-base leading-none"
    >
      {children}
    </button>
  );
}

function Rating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-full bg-lime px-3 py-1.5 text-lime-ink">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          // Tapping the current rating clears it — rating is optional and there
          // has to be a way back out of one.
          onClick={() => onChange(value === n ? null : n)}
          aria-label={value === n ? 'Clear rating' : `Rate ${n} out of 5`}
          className={value !== null && n <= value ? 'opacity-100' : 'opacity-30'}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.44l-5.8 3.06 1.1-6.47-4.7-4.58 6.5-.95z" />
          </svg>
        </button>
      ))}
    </div>
  );
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20s-7-4.6-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 15.4 12 20 12 20Z" />
    </svg>
  );
}

function Tick() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

/** The cover slot at the top of the page. Same shape as RecipeCard's block:
 *  a doodle by default, a real photo dropped in when the recipe has a hero. */
function HeroImage({ recipeId, photo }: { recipeId: string; photo: PhotoSummary | undefined }) {
  const url = usePhotoUrl(photo !== undefined ? photo.url : null);
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] bg-peach text-peach-ink">
      {photo !== undefined ? (
        // A fixed height while the fetch is in flight keeps the page from
        // jumping the moment the object URL resolves.
        <div className="h-52 w-full">
          {url !== undefined && <img src={url} alt="" className="h-full w-full object-cover" />}
        </div>
      ) : (
        <div className="grid h-40 place-items-center">
          <Doodle name={doodleFor(recipeId)} className="h-24 w-24 opacity-90" />
        </div>
      )}
    </div>
  );
}

/**
 * Add, promote and delete photos. Owner-only — RLS would refuse the writes
 * from anyone else anyway, but there is no reason to show controls that only
 * fail.
 */
function PhotoManager({ recipeId, photos }: { recipeId: string; photos: PhotoSummary[] }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [lastUpload, setLastUpload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] });
    void queryClient.invalidateQueries({ queryKey: ['recipes'] });
  };

  const setHero = useMutation({
    mutationFn: (id: string) => api.photos.setHero(id),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.photos.remove(id),
    onSuccess: refresh,
  });

  async function upload(file: File) {
    setPending(true);
    setError(null);
    try {
      // Resized and re-encoded in the browser before a single byte goes over
      // the wire — see lib/downscale.ts for why that matters on a free tier.
      const encoded = await encodeForUpload(file);
      await api.photos.upload(recipeId, encoded.blob, encoded.width, encoded.height);
      setLastUpload(formatBytes(encoded.blob.size));
      refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not upload that photo.');
    } finally {
      setPending(false);
    }
  }

  const busy = pending || setHero.isPending || remove.isPending;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl">Photos</h2>
        <label
          className={`shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-ink ${
            pending ? 'opacity-60' : 'cursor-pointer'
          }`}
        >
          {pending ? 'Uploading…' : 'Add photo'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset immediately so picking the same file twice in a row
              // still fires a change event.
              e.target.value = '';
              if (file !== undefined) void upload(file);
            }}
          />
        </label>
      </div>

      {lastUpload !== null && (
        <p className="mb-2 text-xs text-muted">Uploaded at {lastUpload}.</p>
      )}
      {error !== null && (
        <p role="alert" className="mb-2 rounded-2xl bg-danger-soft px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      {photos.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet. The first photo you add becomes the cover.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              busy={busy}
              onMakeHero={() => setHero.mutate(photo.id)}
              onDelete={() => remove.mutate(photo.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PhotoTile({
  photo,
  busy,
  onMakeHero,
  onDelete,
}: {
  photo: PhotoSummary;
  busy: boolean;
  onMakeHero: () => void;
  onDelete: () => void;
}) {
  const url = usePhotoUrl(photo.url);
  return (
    <li className="overflow-hidden rounded-[var(--radius-block)] bg-card shadow-[var(--shadow-card)]">
      <div className="relative aspect-square w-full bg-raised">
        {url !== undefined && <img src={url} alt="" className="h-full w-full object-cover" />}
        {photo.isHero && (
          <span className="absolute top-1.5 left-1.5 rounded-full bg-lime px-2 py-0.5 text-[0.6875rem] font-bold text-lime-ink">
            Cover
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 p-1.5">
        {!photo.isHero && (
          <button
            type="button"
            onClick={onMakeHero}
            disabled={busy}
            className="rounded-full px-1.5 py-1 text-[0.6875rem] font-semibold text-muted underline disabled:opacity-50"
          >
            Make cover
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label="Delete photo"
          className="ml-auto rounded-full px-1.5 py-1 text-[0.6875rem] font-semibold text-muted underline disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="wash-blush grid min-h-dvh place-items-center p-8 text-muted">{children}</div>
  );
}
