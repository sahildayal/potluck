import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.ts';

/**
 * Sign in / join.
 *
 * The only screen carrying the enamel speckle, so the texture reads as the
 * material the app is made of rather than a decorative pattern reused
 * everywhere. Everything past this point is plain surfaces.
 */
export function SignIn() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const joining = mode === 'up';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (joining) {
        await api.signUp({ email, password, name, handle: handle.trim().toLowerCase() });
      } else {
        await api.signIn({ email, password });
      }
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Could not reach Potluck. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="speckled grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-sm">
        <header className="mb-8">
          <h1 className="font-display text-5xl leading-none">Potluck</h1>
          <p className="mt-2 text-lg text-muted">Everyone brings a dish.</p>
        </header>

        <form
          onSubmit={submit}
          className="rounded-lg border border-line bg-surface p-6 shadow-[var(--shadow-card)]"
        >
          <div className="mb-5 flex gap-1 rounded-md bg-raised p-1">
            <button
              type="button"
              onClick={() => setMode('in')}
              aria-pressed={!joining}
              className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${
                !joining ? 'bg-surface text-ink shadow-[var(--shadow-card)]' : 'text-muted'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode('up')}
              aria-pressed={joining}
              className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${
                joining ? 'bg-surface text-ink shadow-[var(--shadow-card)]' : 'text-muted'
              }`}
            >
              Join
            </button>
          </div>

          <div className="flex flex-col gap-4">
            {joining && (
              <>
                <Field label="Your name" value={name} onChange={setName} autoComplete="name" />
                <Field
                  label="Handle"
                  value={handle}
                  onChange={setHandle}
                  autoComplete="username"
                  hint="How friends find you. Letters and numbers."
                />
              </>
            )}
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete={joining ? 'new-password' : 'current-password'}
              hint={joining ? 'At least 10 characters.' : undefined}
            />
          </div>

          {error !== null && (
            <p
              role="alert"
              className="mt-4 rounded border-l-2 border-chilli bg-chilli-soft px-3 py-2 text-sm"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-6 w-full rounded-md bg-enamel px-4 py-3 font-medium text-enamel-ink transition-opacity disabled:opacity-60"
          >
            {busy ? 'One moment…' : joining ? 'Join Potluck' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          {joining
            ? 'Joining puts your recipes in your own kitchen. Nothing is shared until you share it.'
            : 'Your recipes are yours. Friends only see what you hand them.'}
        </p>
      </div>
    </main>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  autoComplete?: string | undefined;
  hint?: string | undefined;
}

function Field({ label, value, onChange, type = 'text', autoComplete, hint }: FieldProps) {
  const id = `field-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full rounded-md border border-line bg-ground px-3 py-2.5 text-ink outline-none focus:border-enamel"
      />
      {hint !== undefined && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
