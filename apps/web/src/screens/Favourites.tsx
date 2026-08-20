import { useQuery } from '@tanstack/react-query';
import { api, type SessionUser } from '../lib/api.ts';
import { RecipeCard } from '../components/RecipeCard.tsx';
import { BottomNav, NavSpacer } from '../components/BottomNav.tsx';
import { Doodle } from '../components/Doodle.tsx';

export function Favourites({ user }: { user: SessionUser }) {
  void user;
  const recipes = useQuery({ queryKey: ['recipes'], queryFn: api.recipes.list });
  const favourites = (recipes.data?.recipes ?? []).filter((r) => r.isFavorite);

  return (
    <div className="wash-blush safe-top min-h-dvh">
      <div className="mx-auto w-full max-w-2xl px-5">
        <header className="pt-4 pb-5">
          <h1 className="font-display text-[2rem] leading-none">Favourites</h1>
          <p className="mt-1 text-sm font-semibold text-muted">
            {favourites.length === 0
              ? 'The ones you keep coming back to'
              : `${favourites.length} you keep coming back to`}
          </p>
        </header>

        {recipes.isLoading && <p className="py-10 text-center text-muted">Fetching recipes…</p>}

        {recipes.isSuccess && favourites.length === 0 && (
          <div className="rounded-[var(--radius-card)] bg-card px-6 py-12 text-center shadow-[var(--shadow-card)]">
            <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-full bg-blush text-blush-ink">
              <Doodle name="bowl" className="h-11 w-11" />
            </div>
            <h2 className="font-display text-2xl">No favourites yet</h2>
            <p className="mx-auto mt-2 max-w-xs text-muted">
              Tap the heart on a recipe and it will wait for you here.
            </p>
          </div>
        )}

        <ul className="flex flex-col gap-3">
          {favourites.map((recipe) => (
            <li key={recipe.id}>
              <RecipeCard recipe={recipe} />
            </li>
          ))}
        </ul>

        <NavSpacer />
      </div>
      <BottomNav />
    </div>
  );
}
