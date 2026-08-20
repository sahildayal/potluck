import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { formatQuantity, scale, type UnitSystem } from '@potluck/core';
import { api, type SessionUser } from '../lib/api.ts';
import { Chip } from '../components/Chip.tsx';
import { Doodle, doodleFor } from '../components/Doodle.tsx';

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

        <div className="overflow-hidden rounded-[var(--radius-card)] bg-peach text-peach-ink">
          {hero !== undefined ? (
            <img src={hero.url} alt="" className="h-52 w-full object-cover" />
          ) : (
            <div className="grid h-40 place-items-center">
              <Doodle name={doodleFor(recipe.id)} className="h-24 w-24 opacity-90" />
            </div>
          )}
        </div>

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

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="wash-blush grid min-h-dvh place-items-center p-8 text-muted">{children}</div>
  );
}
