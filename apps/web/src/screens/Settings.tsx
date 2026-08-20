import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { api, type SessionUser } from '../lib/api.ts';
import { readStoredTheme, storeTheme, type ThemeChoice } from '../lib/theme.ts';

export function Settings({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState<ThemeChoice>(readStoredTheme());

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg px-5 pb-16">
      <nav className="py-5">
        <Link href="/" className="text-sm text-muted underline underline-offset-2">
          All recipes
        </Link>
      </nav>

      <h1 className="font-display text-3xl">Settings</h1>
      <p className="mt-1 text-muted">
        Signed in as {user.name} · {user.handle}
      </p>

      <section className="mt-8">
        <h2 className="mb-3 font-display text-xl">Appearance</h2>
        <div className="flex gap-1 rounded-md bg-raised p-1">
          {(['system', 'light', 'dark'] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => {
                setTheme(choice);
                storeTheme(choice);
              }}
              aria-pressed={theme === choice}
              className={`flex-1 rounded px-3 py-2 text-sm font-medium capitalize transition-colors ${
                theme === choice ? 'bg-surface text-ink shadow-[var(--shadow-card)]' : 'text-muted'
              }`}
            >
              {choice}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          System follows whatever your phone is set to, including its schedule.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 font-display text-xl">Measurements</h2>
        <p className="text-muted">
          Showing quantities in{' '}
          <strong className="text-ink">
            {user.unitPreference === 'imperial' ? 'cups and ounces' : 'grams and millilitres'}
          </strong>
          . Recipes keep the words their source used, so anything we couldn&rsquo;t convert stays
          exactly as written.
        </p>
      </section>

      <section className="mt-10 border-t border-line pt-6">
        <button
          type="button"
          onClick={async () => {
            await api.signOut();
            await queryClient.invalidateQueries({ queryKey: ['me'] });
          }}
          className="rounded-md border border-line px-4 py-2.5 text-chilli"
        >
          Sign out
        </button>
      </section>
    </div>
  );
}
