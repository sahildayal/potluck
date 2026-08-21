import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { api, ApiError, type SessionUser } from '../lib/api.ts';
import { BottomNav, NavSpacer } from '../components/BottomNav.tsx';
import { Chip } from '../components/Chip.tsx';
import { Doodle } from '../components/Doodle.tsx';

/**
 * Friends and what they have shared with you.
 *
 * You find someone by typing their exact handle. There is no directory to
 * browse on purpose — a searchable list of everyone would let any account
 * enumerate the whole user table, and at friend-group scale you already know
 * what your friends are called.
 */
export function Friends({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const friends = useQuery({ queryKey: ['friends'], queryFn: api.social.friends });
  const shared = useQuery({ queryKey: ['shared'], queryFn: api.social.sharedWithMe });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['friends'] });
    void queryClient.invalidateQueries({ queryKey: ['shared'] });
  };

  const add = useMutation({
    mutationFn: (h: string) => api.social.addFriend(h),
    onSuccess: (result) => {
      setHandle('');
      setMessage(
        result.status === 'accepted'
          ? 'You are friends now — they had already asked.'
          : result.status === 'pending'
            ? 'Request sent.'
            : 'You are already connected.',
      );
      refresh();
    },
    onError: (caught) => {
      setMessage(caught instanceof ApiError ? caught.message : 'Could not send that request.');
    },
  });

  const accept = useMutation({
    mutationFn: (h: string) => api.social.acceptFriend(h),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (h: string) => api.social.removeFriend(h),
    onSuccess: refresh,
  });

  const list = friends.data?.friends ?? [];
  const incoming = list.filter((f) => f.status === 'pending' && f.direction === 'incoming');
  const outgoing = list.filter((f) => f.status === 'pending' && f.direction === 'outgoing');
  const accepted = list.filter((f) => f.status === 'accepted');
  const sharedRecipes = shared.data?.recipes ?? [];

  return (
    <div className="wash-blush safe-top min-h-dvh">
      <div className="mx-auto w-full max-w-2xl px-5">
        <header className="pt-4 pb-5">
          <h1 className="font-display text-[2rem] leading-none">Friends</h1>
          <p className="mt-1 text-sm font-semibold text-muted">
            They find you as <strong className="text-ink">@{user.handle}</strong>
          </p>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(null);
            add.mutate(handle.trim().toLowerCase());
          }}
          className="flex gap-2"
        >
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="Their handle"
            aria-label="Add a friend by handle"
            autoCapitalize="none"
            className="min-w-0 flex-1 rounded-full border-2 border-line bg-surface px-5 py-3.5 outline-none focus:border-ink"
          />
          <button
            type="submit"
            disabled={handle.trim().length === 0 || add.isPending}
            className="shrink-0 rounded-full bg-primary px-5 py-3.5 font-bold text-primary-ink disabled:opacity-40"
          >
            Add
          </button>
        </form>

        {message !== null && (
          <p className="mt-3 rounded-2xl bg-lilac px-4 py-2.5 text-sm font-semibold text-lilac-ink">
            {message}
          </p>
        )}

        {incoming.length > 0 && (
          <Section title="Wants to be friends">
            {incoming.map((friend) => (
              <Row key={friend.id} name={friend.displayName} handle={friend.handle}>
                <button
                  type="button"
                  onClick={() => accept.mutate(friend.handle)}
                  className="rounded-full bg-mint px-4 py-2 text-sm font-bold text-mint-ink"
                >
                  Accept
                </button>
              </Row>
            ))}
          </Section>
        )}

        {sharedRecipes.length > 0 && (
          <Section title="Shared with you">
            {sharedRecipes.map((recipe) => (
              <Link
                key={recipe.id}
                href={`/recipe/${recipe.id}`}
                className="flex items-center gap-3 rounded-[var(--radius-block)] bg-card px-4 py-3 shadow-[var(--shadow-card)]"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-peach text-peach-ink">
                  <Doodle name="bowl" className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-lg leading-tight">
                    {recipe.title}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    from @{recipe.ownerHandle}
                  </span>
                </span>
              </Link>
            ))}
          </Section>
        )}

        {accepted.length > 0 && (
          <Section title="Your people">
            {accepted.map((friend) => (
              <Row key={friend.id} name={friend.displayName} handle={friend.handle}>
                <button
                  type="button"
                  onClick={() => remove.mutate(friend.handle)}
                  aria-label={`Remove ${friend.handle}`}
                  className="px-2 text-xl leading-none text-muted"
                >
                  &times;
                </button>
              </Row>
            ))}
          </Section>
        )}

        {outgoing.length > 0 && (
          <Section title="Waiting on them">
            {outgoing.map((friend) => (
              <Row key={friend.id} name={friend.displayName} handle={friend.handle}>
                <Chip>pending</Chip>
              </Row>
            ))}
          </Section>
        )}

        {friends.isSuccess && list.length === 0 && sharedRecipes.length === 0 && (
          <div className="mt-6 rounded-[var(--radius-card)] bg-card px-6 py-12 text-center shadow-[var(--shadow-card)]">
            <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-full bg-blush text-blush-ink">
              <Doodle name="cup" className="h-11 w-11" />
            </div>
            <h2 className="font-display text-2xl">Nobody here yet</h2>
            <p className="mx-auto mt-2 max-w-xs text-muted">
              Add someone by their handle and you can start passing recipes back and forth.
            </p>
          </div>
        )}

        <NavSpacer />
      </div>
      <BottomNav />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-3 font-display text-xl">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Row({
  name,
  handle,
  children,
}: {
  name: string;
  handle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-block)] bg-card px-4 py-3 shadow-[var(--shadow-card)]">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary font-display text-primary-ink">
        {name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{name}</span>
        <span className="block truncate text-sm text-muted">@{handle}</span>
      </span>
      {children}
    </div>
  );
}
