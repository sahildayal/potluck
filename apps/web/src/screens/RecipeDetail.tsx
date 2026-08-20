import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { formatQuantity, scale, type UnitSystem } from '@potluck/core';
import { api, type SessionUser } from '../lib/api.ts';
import { Star } from '../components/Star.tsx';

export function RecipeDetail({ id, user }: { id: string; user: SessionUser }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => api.recipes.get(id),
  });

  const recipe = data?.recipe;
  const [servings, setServings] = useState<number | null>(null);
  const [shopping, setShopping] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const favorite = useMutation({
    mutationFn: (next: boolean) => api.recipes.setFavorite(id, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recipe', id] });
      void queryClient.invalidateQueries({ queryKey: ['recipes'] });
    },
  });

  const rate = useMutation({
    mutationFn: (next: number | null) => api.recipes.setRating(id, next),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recipe', id] });
      void queryClient.invalidateQueries({ queryKey: ['recipes'] });
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
      const formatted = formatQuantity({ ...canonical, qty: scaled }, system);
      return { ingredient, formatted };
    });
  }, [recipe, baseServings, shownServings, system]);

  if (isLoading) return <Centered>Fetching the recipe…</Centered>;
  if (isError || recipe === undefined) return <Centered>Couldn&rsquo;t find that recipe.</Centered>;

  const mine = recipe.ownerId === user.id;

  return (
    <article className="mx-auto min-h-dvh w-full max-w-2xl px-5 pb-32">
      <nav className="flex items-center justify-between py-5">
        <Link href="/" className="text-sm text-muted underline underline-offset-2">
          All recipes
        </Link>
        <div className="flex items-center gap-3">
          {mine && (
            <Link
              href={`/recipe/${id}/edit`}
              className="text-sm text-muted underline underline-offset-2"
            >
              Edit
            </Link>
          )}
          <button
            type="button"
            onClick={() => favorite.mutate(!recipe.isFavorite)}
            aria-pressed={recipe.isFavorite}
            aria-label={recipe.isFavorite ? 'Remove from favourites' : 'Add to favourites'}
            className={recipe.isFavorite ? 'text-saffron' : 'text-muted'}
          >
            <Star filled={recipe.isFavorite} className="h-6 w-6" />
          </button>
        </div>
      </nav>

      <header>
        <h1 className="font-display text-4xl">{recipe.title}</h1>
        {recipe.attributedTo.length > 0 && (
          <p className="mt-2 text-lg text-muted">{recipe.attributedTo}&rsquo;s recipe</p>
        )}
      </header>

      {recipe.story.length > 0 && (
        <p className="mt-4 border-l-2 border-line pl-4 text-muted italic">{recipe.story}</p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        {baseServings !== null && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Serves</span>
            <div className="flex items-center gap-1 rounded-md border border-line bg-surface">
              <StepButton
                label="Fewer servings"
                onClick={() => setServings(Math.max(1, (shownServings ?? 1) - 1))}
              >
                &minus;
              </StepButton>
              <span className="tnum w-8 text-center font-medium">{shownServings}</span>
              <StepButton
                label="More servings"
                onClick={() => setServings(Math.min(100, (shownServings ?? 1) + 1))}
              >
                +
              </StepButton>
            </div>
          </div>
        )}

        <Rating value={recipe.rating} onChange={(next) => rate.mutate(next)} />
      </div>

      <section className="mt-9">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl">Ingredients</h2>
          <button
            type="button"
            onClick={() => setShopping((s) => !s)}
            aria-pressed={shopping}
            className="rounded border border-line px-3 py-1.5 text-sm text-muted"
          >
            {shopping ? 'Done shopping' : 'Shopping list'}
          </button>
        </div>

        <ul className="flex flex-col">
          {ingredients.map(({ ingredient, formatted }, index) => {
            const key = ingredient.id ?? String(index);
            const isChecked = checked.has(key);
            return (
              <li key={key} className="border-b border-line last:border-0">
                <label
                  className={`flex cursor-pointer items-baseline gap-3 py-2.5 ${
                    shopping && isChecked ? 'text-muted line-through' : ''
                  }`}
                >
                  {shopping && (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() =>
                        setChecked((previous) => {
                          const next = new Set(previous);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        })
                      }
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--c-enamel)]"
                    />
                  )}
                  <span>
                    {/*
                      When the quantity could not be understood we show the
                      source's exact words instead of a converted number. That is
                      the whole point of keeping raw text: "a pinch of saffron"
                      must never become "0.5 ml".
                    */}
                    {formatted !== null && ingredient.item.length > 0 ? (
                      <>
                        <span className="tnum font-medium">
                          {formatted.value}
                          {formatted.unit.length > 0 ? ` ${formatted.unit}` : ''}
                        </span>{' '}
                        <span>{ingredient.item}</span>
                      </>
                    ) : (
                      <span>{ingredient.rawText}</span>
                    )}
                    {ingredient.note.length > 0 && (
                      <span className="text-muted"> — {ingredient.note}</span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-9">
        <h2 className="mb-3 font-display text-2xl">Method</h2>
        <ol className="flex flex-col gap-4">
          {recipe.steps.map((step, index) => (
            <li key={step.id ?? index} className="flex gap-4">
              <span className="tnum mt-0.5 w-6 shrink-0 font-display text-lg text-enamel">
                {index + 1}
              </span>
              <p className="flex-1">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {recipe.notes.length > 0 && (
        <section className="mt-9">
          <h2 className="mb-2 font-display text-2xl">Notes</h2>
          <p className="whitespace-pre-wrap text-muted">{recipe.notes}</p>
        </section>
      )}

      {recipe.steps.length > 0 && (
        <Link
          href={`/recipe/${id}/cook`}
          className="fixed right-5 bottom-6 left-5 mx-auto flex max-w-2xl items-center justify-center rounded-md bg-enamel px-4 py-3.5 font-medium text-enamel-ink shadow-[var(--shadow-lift)]"
        >
          Start cooking
        </Link>
      )}
    </article>
  );
}

function StepButton({
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
      className="px-2.5 py-1.5 text-lg leading-none text-muted"
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
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted">Rating</span>
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            // Tapping the current rating clears it, because rating is optional
            // and there has to be a way back out of one.
            onClick={() => onChange(value === n ? null : n)}
            aria-label={value === n ? `Clear rating` : `Rate ${n} out of 5`}
            className={value !== null && n <= value ? 'text-saffron' : 'text-line-strong'}
          >
            <Star filled={value !== null && n <= value} className="h-5 w-5" />
          </button>
        ))}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-dvh place-items-center p-8 text-muted">{children}</div>;
}
