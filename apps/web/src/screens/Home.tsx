import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { api, type RecipeSummary, type SessionUser } from '../lib/api.ts';
import { RecipeCard } from '../components/RecipeCard.tsx';
import { BottomNav, NavSpacer } from '../components/BottomNav.tsx';
import { Doodle } from '../components/Doodle.tsx';
import { Chip } from '../components/Chip.tsx';

/**
 * The collection.
 *
 * Category chips sit under the search field as a horizontal rail, so switching
 * section is a thumb-reach away rather than a scroll. "All" is always first and
 * always selected on arrival, because the most common thing you want is
 * everything.
 */
export function Home({ user }: { user: SessionUser }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [favouritesOnly, setFavouritesOnly] = useState(false);

  const recipes = useQuery({ queryKey: ['recipes'], queryFn: api.recipes.list });
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  // Only for the banner's count. The catalog grows, and a hardcoded "a
  // thousand-plus" was already wrong once — it claimed a thousand while the
  // table held 55. Reading the real number means the copy cannot drift again.
  const facets = useQuery({ queryKey: ['catalog', 'facets'], queryFn: api.catalog.facets });

  const all = recipes.data?.recipes ?? [];

  /**
   * Search runs in the browser. A collection caps at a thousand rows of short
   * text, so filtering locally is instant, works with the backend asleep, and
   * costs the free tier nothing.
   */
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter((r) => {
      if (favouritesOnly && !r.isFavorite) return false;
      if (category !== null && !(r.categoryIds ?? []).includes(category)) return false;
      if (needle.length === 0) return true;
      return (
        r.title.toLowerCase().includes(needle) || r.attributedTo.toLowerCase().includes(needle)
      );
    });
  }, [all, query, favouritesOnly, category]);

  return (
    <div className="wash-lime safe-top min-h-dvh">
      <div className="mx-auto w-full max-w-2xl px-5">
        <header className="flex items-center justify-between pt-4 pb-5">
          <div>
            <p className="text-sm font-semibold text-muted">Hi {user.name.split(' ')[0]}</p>
            <h1 className="font-display text-[2rem] leading-none">What are we making?</h1>
          </div>
          <Link
            href="/you"
            aria-label="Your profile"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary font-display text-lg text-primary-ink"
          >
            {user.name.charAt(0).toUpperCase()}
          </Link>
        </header>

        <search className="block">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your recipes"
            aria-label="Search your recipes"
            className="w-full rounded-full border-2 border-line bg-surface px-5 py-3.5 outline-none focus:border-ink"
          />
        </search>

        {(categories.data?.categories.length ?? 0) > 0 && (
          <div className="rail -mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1">
            <CategoryChip
              label="All"
              active={category === null && !favouritesOnly}
              onClick={() => {
                setCategory(null);
                setFavouritesOnly(false);
              }}
            />
            <CategoryChip
              label="★ Favourites"
              active={favouritesOnly}
              onClick={() => setFavouritesOnly((v) => !v)}
            />
            {categories.data?.categories.map((c) => (
              <CategoryChip
                key={c.id}
                label={c.name}
                active={category === c.id}
                onClick={() => setCategory(category === c.id ? null : c.id)}
              />
            ))}
          </div>
        )}

        <Link
          href="/browse"
          className="mt-5 flex items-center gap-3 rounded-[var(--radius-card)] bg-mint p-4 text-mint-ink shadow-[var(--shadow-card)]"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface">
            <Doodle name="bowl" className="h-7 w-7 text-mint-ink" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg leading-tight">Not sure what to cook?</span>
            <span className="block text-sm opacity-80">
              {facets.data === undefined
                ? 'Browse the recipe catalog and steal one'
                : `Browse ${facets.data.total.toLocaleString()} recipes and steal one`}
            </span>
          </span>
          <span className="shrink-0 text-xl">&rarr;</span>
        </Link>

        <p className="mt-6 mb-3 font-display text-xl">
          {filtered.length} {filtered.length === 1 ? 'recipe' : 'recipes'}
        </p>

        {recipes.isLoading && <p className="py-10 text-center text-muted">Fetching recipes…</p>}

        {recipes.isError && (
          <p className="rounded-2xl bg-danger-soft px-4 py-3 font-medium text-danger">
            Couldn&rsquo;t load your recipes. Check your connection and try again.
          </p>
        )}

        {recipes.isSuccess && all.length === 0 && <EmptyKitchen />}

        {recipes.isSuccess && all.length > 0 && filtered.length === 0 && (
          <NoMatches query={query} />
        )}

        <ul className="flex flex-col gap-3">
          {filtered.map((recipe) => (
            <li key={recipe.id}>
              <RecipeCard recipe={recipe} />
            </li>
          ))}
        </ul>

        <NavSpacer />
      </div>

      <div className="safe-bottom fixed right-5 bottom-24 z-20 flex flex-col items-end gap-2">
        <Link
          href="/import"
          className="grid h-12 w-12 place-items-center rounded-full bg-surface shadow-[var(--shadow-lift)]"
          aria-label="Import a recipe from a link or photo"
        >
          <Doodle name="loaf" className="h-6 w-6 text-coral" />
        </Link>
        <Link
          href="/recipe/new"
          className="grid h-14 w-14 place-items-center rounded-full bg-coral text-2xl font-bold text-white shadow-[var(--shadow-lift)]"
          aria-label="Add a recipe by hand"
        >
          +
        </Link>
      </div>

      <BottomNav />
    </div>
  );
}

function CategoryChip({
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
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap transition-colors ${
        active ? 'bg-primary text-primary-ink' : 'bg-surface text-muted'
      }`}
    >
      {label}
    </button>
  );
}

function EmptyKitchen() {
  return (
    <div className="rounded-[var(--radius-card)] bg-card px-6 py-12 text-center shadow-[var(--shadow-card)]">
      <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-full bg-peach text-peach-ink">
        <Doodle name="pot" className="h-11 w-11" />
      </div>
      <h2 className="font-display text-2xl">Nothing on the stove yet</h2>
      <p className="mx-auto mt-2 max-w-xs text-muted">
        Type a recipe in, paste a link, or photograph a card. They all end up in the same place.
      </p>
      <Link
        href="/recipe/new"
        className="mt-5 inline-block rounded-full bg-primary px-6 py-3 font-bold text-primary-ink"
      >
        Add your first recipe
      </Link>
    </div>
  );
}

function NoMatches({ query }: { query: string }) {
  return (
    <div className="rounded-[var(--radius-card)] bg-card px-6 py-10 text-center shadow-[var(--shadow-card)]">
      <Chip tone="lilac">no matches</Chip>
      <p className="mt-3 text-muted">
        Nothing here for &ldquo;{query}&rdquo;. Try a shorter word, or the name of whoever gave it
        to you.
      </p>
    </div>
  );
}

export type { RecipeSummary };
