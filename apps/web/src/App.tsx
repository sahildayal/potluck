import { useQuery } from '@tanstack/react-query';
import { Route, Switch } from 'wouter';
import { api } from './lib/api.ts';
import { SignIn } from './screens/SignIn.tsx';
import { Home } from './screens/Home.tsx';
import { RecipeDetail } from './screens/RecipeDetail.tsx';
import { CookMode } from './screens/CookMode.tsx';
import { Settings } from './screens/Settings.tsx';
import { RecipeEditor } from './screens/RecipeEditor.tsx';

export function App() {
  const session = useQuery({ queryKey: ['me'], queryFn: api.me });

  if (session.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p className="text-muted">Setting the table…</p>
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
      <Route path="/settings">{() => <Settings user={user} />}</Route>
      <Route>
        {() => (
          <div className="grid min-h-dvh place-items-center p-8 text-center">
            <div>
              <h1 className="text-2xl">Nothing here</h1>
              <p className="mt-2 text-muted">That page doesn&rsquo;t exist.</p>
              <a className="mt-4 inline-block text-enamel underline" href="/">
                Back to your recipes
              </a>
            </div>
          </div>
        )}
      </Route>
    </Switch>
  );
}
