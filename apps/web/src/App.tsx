import { useQuery } from '@tanstack/react-query';
import { Route, Switch } from 'wouter';
import { api } from './lib/api.ts';
import { SignIn } from './screens/SignIn.tsx';
import { Home } from './screens/Home.tsx';
import { RecipeDetail } from './screens/RecipeDetail.tsx';
import { CookMode } from './screens/CookMode.tsx';
import { You } from './screens/You.tsx';
import { Favourites } from './screens/Favourites.tsx';
import { Shopping } from './screens/Shopping.tsx';
import { Browse, CatalogDetailScreen } from './screens/Browse.tsx';
import { Import } from './screens/Import.tsx';
import { Friends } from './screens/Friends.tsx';
import { RecipeEditor } from './screens/RecipeEditor.tsx';

export function App() {
  const session = useQuery({ queryKey: ['me'], queryFn: api.me });

  if (session.isLoading) {
    return (
      <div className="wash-lime grid min-h-dvh place-items-center">
        <p className="font-display text-xl">Setting the table…</p>
      </div>
    );
  }

  if (session.data?.user == null) return <SignIn />;

  const user = session.data.user;

  return (
    <Switch>
      <Route path="/">{() => <Home user={user} />}</Route>
      <Route path="/recipe/new">{() => <RecipeEditor user={user} />}</Route>
      <Route path="/recipe/:id/edit">{(p) => <RecipeEditor user={user} id={p.id} />}</Route>
      <Route path="/recipe/:id/cook">{(p) => <CookMode id={p.id} user={user} />}</Route>
      <Route path="/recipe/:id">{(p) => <RecipeDetail id={p.id} user={user} />}</Route>
      <Route path="/import">{() => <Import user={user} />}</Route>
      <Route path="/friends">{() => <Friends user={user} />}</Route>
      <Route path="/browse">{() => <Browse user={user} />}</Route>
      <Route path="/browse/:slug">{(p) => <CatalogDetailScreen slug={p.slug} />}</Route>
      <Route path="/favourites">{() => <Favourites user={user} />}</Route>
      <Route path="/shopping">{() => <Shopping user={user} />}</Route>
      <Route path="/you">{() => <You user={user} />}</Route>
      <Route path="/settings">{() => <You user={user} />}</Route>
      <Route>
        {() => (
          <div className="wash-lime grid min-h-dvh place-items-center p-8 text-center">
            <div>
              <h1 className="font-display text-3xl">Nothing here</h1>
              <p className="mt-2 text-muted">That page doesn&rsquo;t exist.</p>
              <a
                className="mt-5 inline-block rounded-full bg-primary px-6 py-3 font-bold text-primary-ink"
                href="/"
              >
                Back to your recipes
              </a>
            </div>
          </div>
        )}
      </Route>
    </Switch>
  );
}
