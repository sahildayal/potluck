import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SessionUser } from '../lib/api.ts';
import { BottomNav, NavSpacer } from '../components/BottomNav.tsx';
import { Chip } from '../components/Chip.tsx';
import { readStoredTheme, storeTheme, type ThemeChoice } from '../lib/theme.ts';

export function You({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();

  // The preference lives on the server, not in localStorage, because it has to
  // follow the person to their phone rather than staying on the laptop where
  // they happened to set it.
  const units = useMutation({
    mutationFn: (choice: 'metric' | 'imperial') => api.updateMe({ unitPreference: choice }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  });
  const [theme, setTheme] = useState<ThemeChoice>(readStoredTheme());
  const recipes = useQuery({ queryKey: ['recipes'], queryFn: api.recipes.list });

  const all = recipes.data?.recipes ?? [];
  const cooked = all.length;
  const favourites = all.filter((r) => r.isFavorite).length;

  return (
    <div className="wash-lilac safe-top min-h-dvh">
      <div className="mx-auto w-full max-w-2xl px-5">
        <header className="flex items-center gap-4 pt-6 pb-6">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-primary font-display text-2xl text-primary-ink">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="truncate font-display text-[1.75rem] leading-tight">{user.name}</h1>
            <p className="truncate text-sm font-semibold text-muted">@{user.handle}</p>
          </div>
        </header>

        <div className="flex gap-2">
          <Stat label="recipes" value={cooked} tone="lime" />
          <Stat label="favourites" value={favourites} tone="blush" />
        </div>

        <Section title="Appearance">
          <div className="flex gap-1 rounded-full bg-raised p-1">
            {(['system', 'light', 'dark'] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => {
                  setTheme(choice);
                  storeTheme(choice);
                }}
                aria-pressed={theme === choice}
                className={`flex-1 rounded-full px-3 py-2.5 text-sm font-bold capitalize transition-colors ${
                  theme === choice ? 'bg-primary text-primary-ink' : 'text-muted'
                }`}
              >
                {choice}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            System follows your phone, including its schedule.
          </p>
        </Section>

        <Section title="Measurements">
          <div className="flex gap-1 rounded-full bg-raised p-1">
            {(['imperial', 'metric'] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => units.mutate(choice)}
                disabled={units.isPending}
                aria-pressed={user.unitPreference === choice}
                className={`flex-1 rounded-full px-3 py-2.5 text-sm font-bold transition-colors ${
                  user.unitPreference === choice ? 'bg-primary text-primary-ink' : 'text-muted'
                }`}
              >
                {choice === 'imperial' ? 'Cups & oz' : 'Grams & ml'}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Tap any quantity in a recipe to see that one amount another way, without changing this.
            Recipes keep the words their source used, so anything we couldn&rsquo;t convert stays
            exactly as written.
          </p>
        </Section>

        <Section title="Friends">
          <p className="text-muted">
            Friends find you as <strong className="text-ink">@{user.handle}</strong>.
          </p>
          <a
            href="/friends"
            className="mt-3 inline-block rounded-full bg-primary px-5 py-2.5 font-bold text-primary-ink"
          >
            Manage friends
          </a>
        </Section>

        <button
          type="button"
          onClick={async () => {
            await api.signOut();
            await queryClient.invalidateQueries({ queryKey: ['me'] });
          }}
          className="mt-8 w-full rounded-full border-2 border-line py-3.5 font-bold text-danger"
        >
          Sign out
        </button>

        <NavSpacer />
      </div>
      <BottomNav />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'lime' | 'blush' }) {
  const bg = tone === 'lime' ? 'bg-lime text-lime-ink' : 'bg-blush text-blush-ink';
  return (
    <div className={`flex-1 rounded-[var(--radius-block)] px-4 py-4 ${bg}`}>
      <p className="tnum font-display text-3xl leading-none">{value}</p>
      <p className="mt-1 text-sm font-semibold">{label}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-3 font-display text-xl">{title}</h2>
      <div className="rounded-[var(--radius-card)] bg-card p-4 shadow-[var(--shadow-card)]">
        {children}
      </div>
    </section>
  );
}

export { Chip };
