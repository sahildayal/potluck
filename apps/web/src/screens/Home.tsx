import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { api, type RecipeSummary, type SessionUser } from '../lib/api.ts';
import { Star } from '../components/Star.tsx';

/**
 * Home.
 *
 * Search sits above everything because with a thousand recipes it becomes the
 * primary way in. Favourites come next as their own shelf — the requirement
 * asks for them to be "easily visible and easily accessible", and a shelf you
 * never scroll past is the honest reading of that.
 */
export function Home({ user }: { user: SessionUser }) {
  const [query, setQuery] = useState('');

  const recipes = useQuery({ queryKey: ['recipes'], queryFn: api.recipes.list });
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });

  const all = recipes.data?.recipes ?? [];

  /**
   * Search runs in the browser, not the database.
   *
   * A user's whole collection caps at a thousand rows of mostly short text, so
   * filtering locally is instant, works with the backend asleep, and costs the
   * free tier nothing. A server-side search index would be more machinery for
   * a worse experience at this size.
   */
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return all;
    return all.filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        r.attributedTo.toLowerCase().includes(needle),
    );
  }, [all, query]);

  const favourites = filtered.filter((r) => r.isFavorite);
  const searching = query.trim().length > 0;

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-5 pb-28">
      <header className="flex items-baseline justify-between pt-8 pb-6">
        <h1 className="font-display text-3xl">Potluck</h1>
        <Link href="/settings" className="text-sm text-muted underline underline-offset-2">
          {user.handle}
        </Link>
      </header>

      <search className="sticky top-0 z-10 -mx-5 bg-ground/95 px-5 pb-4 backdrop-blur">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your recipes"
          aria-label="Search your recipes"
          className="w-full rounded-md border border-line bg-surface px-4 py-3 outline-none focus:border-enamel"
        />
      </search>

      {recipes.isLoading && <p className="py-10 text-center text-muted">Fetching recipes…</p>}

      {recipes.isError && (
        <p className="rounded border-l-2 border-chilli bg-chilli-soft px-4 py-3">
          Couldn&rsquo;t load your recipes. Check your connection and pull to refresh.
        </p>
      )}

      {recipes.isSuccess && all.length === 0 && <EmptyKitchen />}

      {recipes.isSuccess && all.length > 0 && searching && (
        <Shelf
          title={`${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'}`}
          recipes={filtered}
        />
      )}

      {recipes.isSuccess && all.length > 0 && !searching && (
        <>
          {favourites.length > 0 && <Shelf title="Favourites" recipes={favourites} starred />}
          {(categories.data?.categories ?? []).map((category) => (
            <CategoryShelf key={category.id} name={category.name} recipes={filtered} />
          ))}
          <Shelf title="Everything" recipes={filtered} />
        </>
      )}

      <Link
        href="/recipe/new"
        className="fixed right-5 bottom-6 left-5 mx-auto flex max-w-3xl items-center justify-center rounded-md bg-enamel px-4 py-3.5 font-medium text-enamel-ink shadow-[var(--shadow-lift)]"
      >
        Add a recipe
      </Link>
    </div>
  );
}

function EmptyKitchen() {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-6 py-14 text-center">
      <h2 className="font-display text-2xl">Nothing in the kitchen yet</h2>
      <p className="mx-auto mt-2 max-w-xs text-muted">
        Paste a link, photograph a recipe card, or type one in. It all ends up in the same place.
      </p>
    </div>
  );
}

/**
 * Category shelves are currently unfiltered by category membership because the
 * list endpoint does not return category ids yet; showing every recipe under
 * every heading would be a lie, so a shelf with nothing to put in it renders
 * nothing at all rather than an empty heading.
 */
function CategoryShelf({ name, recipes }: { name: string; recipes: RecipeSummary[] }) {
  void recipes;
  void name;
  return null;
}

function Shelf({
  title,
  recipes,
  starred = false,
}: {
  title: string;
  recipes: RecipeSummary[];
  starred?: boolean;
}) {
  if (recipes.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 font-display text-xl">
        {starred && <Star filled className="h-4 w-4 text-saffron" />}
        {title}
      </h2>
      <ul className="flex flex-col gap-2">
        {recipes.map((recipe) => (
          <li key={recipe.id}>
            <RecipeRow recipe={recipe} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecipeRow({ recipe }: { recipe: RecipeSummary }) {
  return (
    <Link
      href={`/recipe/${recipe.id}`}
      className="flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 transition-shadow hover:shadow-[var(--shadow-card)]"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg leading-tight">{recipe.title}</p>
        <p className="mt-0.5 truncate text-sm text-muted">
          {recipe.attributedTo.length > 0 && <span>{recipe.attributedTo}&rsquo;s · </span>}
          {recipe.servings !== null && <span className="tnum">serves {recipe.servings}</span>}
        </p>
      </div>
      {recipe.isFavorite && <Star filled className="h-4 w-4 shrink-0 text-saffron" />}
      {recipe.rating !== null && (
        <span className="tnum shrink-0 text-sm text-muted">{recipe.rating}/5</span>
      )}
    </Link>
  );
}
