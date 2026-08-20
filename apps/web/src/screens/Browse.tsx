import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { api, type CatalogSummary, type SessionUser } from '../lib/api.ts';
import { BottomNav, NavSpacer } from '../components/BottomNav.tsx';
import { Chip, type ChipTone } from '../components/Chip.tsx';
import { Doodle, doodleFor } from '../components/Doodle.tsx';

type Sort = 'relevance' | 'protein' | 'quick' | 'newest';

const PAGE = 24;

/**
 * The catalog.
 *
 * Search is debounced and served by Postgres. Filters are facets the server
 * hands back rather than a hardcoded list, so the UI never offers a cuisine
 * that has no recipes behind it.
 */
export function Browse({ user }: { user: SessionUser }) {
  void user;
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [meal, setMeal] = useState<string | null>(null);
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [highProtein, setHighProtein] = useState(false);
  const [sort, setSort] = useState<Sort>('relevance');
  const [page, setPage] = useState(0);

  // Typing in a search box should not fire a query per keystroke at a database.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(query.trim());
      setPage(0);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query]);

  const facets = useQuery({ queryKey: ['catalog-facets'], queryFn: api.catalog.facets });

  const results = useQuery({
    queryKey: ['catalog', debounced, meal, cuisine, highProtein, sort, page],
    queryFn: () =>
      api.catalog.browse({
        ...(debounced.length > 0 ? { q: debounced } : {}),
        ...(meal !== null ? { meal } : {}),
        ...(cuisine !== null ? { cuisine } : {}),
        ...(highProtein ? { minProtein: 25 } : {}),
        sort,
        limit: PAGE,
        offset: page * PAGE,
      }),
    placeholderData: (previous) => previous,
  });

  const total = results.data?.total ?? 0;
  const recipes = results.data?.recipes ?? [];
  const pages = Math.ceil(total / PAGE);

  return (
    <div className="wash-mint safe-top min-h-dvh">
      <div className="mx-auto w-full max-w-2xl px-5">
        <header className="pt-4 pb-4">
          <h1 className="font-display text-[2rem] leading-none">Browse</h1>
          <p className="mt-1 text-sm font-semibold text-muted">
            {facets.data === undefined
              ? 'Loading the shelf…'
              : `${facets.data.total.toLocaleString()} recipes to steal from`}
          </p>
        </header>

        <search className="block">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Chicken, high protein, 20 minutes…"
            aria-label="Search the catalog"
            className="w-full rounded-full border-2 border-line bg-surface px-5 py-3.5 outline-none focus:border-ink"
          />
        </search>

        <div className="rail -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
          <Toggle
            label="High protein"
            active={highProtein}
            onClick={() => {
              setHighProtein((v) => !v);
              setPage(0);
            }}
          />
          {(facets.data?.meals ?? []).map((m) => (
            <Toggle
              key={m.value}
              label={m.value}
              active={meal === m.value}
              onClick={() => {
                setMeal(meal === m.value ? null : m.value);
                setPage(0);
              }}
            />
          ))}
        </div>

        <div className="rail -mx-5 mt-2 flex gap-2 overflow-x-auto px-5 pb-1">
          {(facets.data?.cuisines ?? []).slice(0, 18).map((c) => (
            <Toggle
              key={c.value}
              label={c.value}
              active={cuisine === c.value}
              onClick={() => {
                setCuisine(cuisine === c.value ? null : c.value);
                setPage(0);
              }}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="font-display text-lg">
            {results.isLoading ? 'Searching…' : `${total.toLocaleString()} found`}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Sort</span>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as Sort);
                setPage(0);
              }}
              className="rounded-full border-2 border-line bg-surface px-3 py-1.5 font-semibold outline-none focus:border-ink"
            >
              <option value="relevance">Best match</option>
              <option value="protein">Most protein</option>
              <option value="quick">Quickest</option>
              <option value="newest">Newest</option>
            </select>
          </label>
        </div>

        {results.isSuccess && recipes.length === 0 && (
          <div className="mt-4 rounded-[var(--radius-card)] bg-card px-6 py-12 text-center shadow-[var(--shadow-card)]">
            <h2 className="font-display text-2xl">Nothing matches</h2>
            <p className="mx-auto mt-2 max-w-xs text-muted">
              Try fewer filters, or a simpler word. Spelling is forgiven &mdash; &ldquo;chiken&rdquo;
              still finds chicken.
            </p>
          </div>
        )}

        <ul className="mt-4 flex flex-col gap-3">
          {recipes.map((recipe) => (
            <li key={recipe.id}>
              <CatalogCard recipe={recipe} />
            </li>
          ))}
        </ul>

        {pages > 1 && (
          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-full border-2 border-line px-5 py-2.5 font-bold disabled:opacity-40"
            >
              Back
            </button>
            <span className="tnum text-sm font-semibold text-muted">
              {page + 1} / {pages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              className="rounded-full border-2 border-line px-5 py-2.5 font-bold disabled:opacity-40"
            >
              More
            </button>
          </div>
        )}

        <NavSpacer />
      </div>
      <BottomNav />
    </div>
  );
}

function Toggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap capitalize transition-colors ${
        active ? 'bg-primary text-primary-ink' : 'bg-surface text-muted'
      }`}
    >
      {label}
    </button>
  );
}

const BLOCK: Record<string, string> = {
  lilac: 'bg-lilac text-lilac-ink',
  peach: 'bg-peach text-peach-ink',
  mint: 'bg-mint text-mint-ink',
  blush: 'bg-blush text-blush-ink',
  lime: 'bg-lime text-lime-ink',
};
const TONES: ChipTone[] = ['lilac', 'peach', 'mint', 'blush', 'lime'];

function toneFor(seed: string): ChipTone {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 17 + seed.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length] as ChipTone;
}

function CatalogCard({ recipe }: { recipe: CatalogSummary }) {
  return (
    <Link
      href={`/browse/${recipe.slug}`}
      className="block rounded-[var(--radius-card)] bg-card p-3 shadow-[var(--shadow-card)] transition-transform active:scale-[0.99]"
    >
      <div className="flex gap-3">
        <div
          className={`grid h-24 w-24 shrink-0 place-items-center rounded-[var(--radius-block)] ${BLOCK[toneFor(recipe.slug)]}`}
        >
          <Doodle name={doodleFor(recipe.slug)} className="h-14 w-14 opacity-90" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <h3 className="line-clamp-2 font-display text-[1.15rem] leading-tight">{recipe.title}</h3>
          <p className="mt-0.5 truncate text-sm text-muted capitalize">
            {recipe.cuisine} · {recipe.mealType}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {recipe.proteinGrams !== null && (
              <Chip tone="lime">
                <span className="tnum">{Math.round(recipe.proteinGrams)}g protein</span>
              </Chip>
            )}
            {recipe.totalMinutes !== null && (
              <Chip tone="lilac">
                <span className="tnum">{recipe.totalMinutes} min</span>
              </Chip>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

/** A single catalog recipe, with the one action that matters: make it yours. */
export function CatalogDetailScreen({ slug }: { slug: string }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const savedRef = useRef(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['catalog-recipe', slug],
    queryFn: () => api.catalog.get(slug),
  });

  const save = useMutation({
    mutationFn: () => api.catalog.save(slug),
    onSuccess: (result) => {
      savedRef.current = true;
      void queryClient.invalidateQueries({ queryKey: ['recipes'] });
      navigate(`/recipe/${result.recipe.id}`);
    },
  });

  if (isLoading) return <Centered>Fetching the recipe…</Centered>;
  if (isError || data === undefined) return <Centered>Couldn&rsquo;t find that recipe.</Centered>;

  const recipe = data.recipe;

  return (
    <article className="wash-mint safe-top min-h-dvh pb-32">
      <div className="mx-auto w-full max-w-2xl px-5">
        <nav className="py-4">
          <Link
            href="/browse"
            aria-label="Back to browse"
            className="grid h-10 w-10 place-items-center rounded-full bg-surface text-xl leading-none shadow-[var(--shadow-card)]"
          >
            &larr;
          </Link>
        </nav>

        <div
          className={`grid h-40 place-items-center overflow-hidden rounded-[var(--radius-card)] ${BLOCK[toneFor(recipe.slug)]}`}
        >
          <Doodle name={doodleFor(recipe.slug)} className="h-24 w-24 opacity-90" />
        </div>

        <header className="mt-5">
          <h1 className="font-display text-[2.1rem] leading-[1.08]">{recipe.title}</h1>
          {recipe.summary.length > 0 && <p className="mt-2 text-muted">{recipe.summary}</p>}
        </header>

        <div className="mt-4 flex flex-wrap gap-1.5">
          <Chip tone="mint">
            <span className="capitalize">{recipe.cuisine}</span>
          </Chip>
          <Chip tone="lilac">
            <span className="capitalize">{recipe.mealType}</span>
          </Chip>
          {recipe.proteinGrams !== null && (
            <Chip tone="lime">
              <span className="tnum">about {Math.round(recipe.proteinGrams)}g protein</span>
            </Chip>
          )}
          {recipe.calories !== null && (
            <Chip tone="peach">
              <span className="tnum">~{recipe.calories} kcal</span>
            </Chip>
          )}
          {recipe.totalMinutes !== null && (
            <Chip>
              <span className="tnum">{recipe.totalMinutes} min</span>
            </Chip>
          )}
          <Chip>serves {recipe.servings}</Chip>
        </div>

        <p className="mt-3 text-xs text-muted">
          Nutrition figures are estimates, not measurements. Good enough to compare recipes by, not
          to build a diet on.
        </p>

        <section className="mt-7">
          <h2 className="mb-3 font-display text-2xl">Ingredients</h2>
          <ul className="rounded-[var(--radius-card)] bg-card p-4 shadow-[var(--shadow-card)]">
            {recipe.ingredients.map((line, index) => (
              <li key={index} className="border-b border-line py-2 last:border-0 last:pb-0 first:pt-0">
                {line.rawText}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-7">
          <h2 className="mb-3 font-display text-2xl">Method</h2>
          <ol className="flex flex-col gap-2.5">
            {recipe.steps.map((step, index) => (
              <li
                key={index}
                className="flex gap-3 rounded-[var(--radius-block)] bg-card p-4 shadow-[var(--shadow-card)]"
              >
                <span className="tnum grid h-7 w-7 shrink-0 place-items-center rounded-full bg-lime font-display text-sm text-lime-ink">
                  {index + 1}
                </span>
                <p className="flex-1">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 flex justify-center px-5 pb-4">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="flex w-full max-w-md items-center justify-center rounded-full bg-primary px-6 py-4 font-bold text-primary-ink shadow-[var(--shadow-lift)] disabled:opacity-60"
        >
          {save.isPending ? 'Saving…' : 'Make it — save to my recipes'}
        </button>
      </div>
    </article>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="wash-mint grid min-h-dvh place-items-center p-8 text-muted">{children}</div>;
}
