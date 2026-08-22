import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.ts';
import { CookingScene } from '../components/Doodle.tsx';
import { WordPills } from '../components/Chip.tsx';

/**
 * Sign in / join.
 *
 * The hero is the thing the app is actually about: a pot on the hob with
 * something in it. Drawn rather than photographed, because a photograph of
 * someone else's food is a stock-image promise the app cannot keep, and a
 * drawing is honest about being an invitation.
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
        await api.signIn({ identifier: email.trim(), password });
      }
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    } catch (caught) {
      // better-auth rate-limits repeated attempts, and its own wording ("Too
      // many requests") reads like a fault in the app rather than something
      // that clears on its own. Someone fumbling a password is exactly who
      // meets this, and exactly who needs telling to simply wait.
      if (caught instanceof ApiError && caught.status === 429) {
        setError('Too many tries in a row. Wait a minute, then try again.');
      } else if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        setError('Could not reach Potluck. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wash-lime safe-top min-h-dvh px-5 pb-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="pt-6 text-coral">
          <CookingScene className="mx-auto h-40 w-full max-w-xs" />
        </div>

        <header className="mt-2 text-center">
          <h1 className="font-display text-[2.75rem] leading-none">Potluck</h1>
          <p className="mt-3 text-lg font-semibold">
            <WordPills
              words={[
                { text: 'everyone', tone: 'lilac' },
                { text: 'brings', tone: 'peach' },
                { text: 'a dish', tone: 'mint' },
              ]}
            />
          </p>
        </header>

        <form
          onSubmit={submit}
          className="mt-7 rounded-[var(--radius-card)] bg-card p-5 shadow-[var(--shadow-card)]"
        >
          <div className="mb-5 flex gap-1 rounded-full bg-raised p-1">
            <button
              type="button"
              onClick={() => setMode('in')}
              aria-pressed={!joining}
              className={`flex-1 rounded-full px-3 py-2 text-sm font-bold transition-colors ${
                !joining ? 'bg-primary text-primary-ink' : 'text-muted'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode('up')}
              aria-pressed={joining}
              className={`flex-1 rounded-full px-3 py-2 text-sm font-bold transition-colors ${
                joining ? 'bg-primary text-primary-ink' : 'text-muted'
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
                  hint="How friends find you."
                />
              </>
            )}
            {/* Text, not email, when signing in: type="email" makes the browser
                reject a bare handle before the form is ever submitted. */}
            <Field
              label={joining ? 'Email' : 'Email or handle'}
              type={joining ? 'email' : 'text'}
              value={email}
              onChange={setEmail}
              autoComplete={joining ? 'email' : 'username'}
              hint={joining ? 'Nothing is ever sent here. Any address works.' : undefined}
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete={joining ? 'new-password' : 'current-password'}
              hint={joining ? 'At least 8 characters.' : undefined}
            />
          </div>

          {error !== null && (
            <p
              role="alert"
              className="mt-4 rounded-2xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-6 w-full rounded-full bg-primary px-4 py-3.5 font-bold text-primary-ink transition-opacity disabled:opacity-60"
          >
            {busy ? 'One moment…' : joining ? 'Join Potluck' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Your recipes are yours. Friends only see what you hand them.
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
      <label htmlFor={id} className="mb-1.5 block text-sm font-bold">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full rounded-2xl border-2 border-line bg-surface px-4 py-3 text-ink outline-none focus:border-ink"
      />
      {hint !== undefined && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
