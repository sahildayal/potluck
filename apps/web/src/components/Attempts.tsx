import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AttemptEntry, type SessionUser } from '../lib/api.ts';
import { usePhotoUrl } from '../lib/usePhotoUrl.ts';
import { Chip } from './Chip.tsx';

/**
 * "I made this" — the friend-group feature.
 *
 * Cook someone's recipe, post how yours actually turned out, and it attaches to
 * the recipe. Over time each recipe grows a wall of everyone's versions,
 * including the disasters, which are usually the better photos.
 *
 * The permissions here are enforced by the database, not this component: a cook
 * owns their own photo and caption, and the recipe's owner can hide an attempt
 * from their page without being able to rewrite it.
 */
export function Attempts({ recipeId, user }: { recipeId: string; user: SessionUser }) {
  const queryClient = useQueryClient();
  const [caption, setCaption] = useState('');
  const [wentWell, setWentWell] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const attempts = useQuery({
    queryKey: ['attempts', recipeId],
    queryFn: () => api.social.attempts(recipeId),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['attempts', recipeId] });

  const remove = useMutation({
    mutationFn: (id: string) => api.social.deleteAttempt(id),
    onSuccess: refresh,
  });
  const hide = useMutation({
    mutationFn: (id: string) => api.social.hideAttempt(id),
    onSuccess: refresh,
  });

  async function post(file: File) {
    setBusy(true);
    try {
      // Downscaled in the browser: a phone photo is 4 MB and the whole app
      // shares a 512 MB database, so a full-resolution upload is not a
      // reasonable thing to ask for.
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.8),
      );
      if (blob === null) return;

      await api.social.postAttempt(recipeId, blob, caption.trim(), wentWell);
      setCaption('');
      setWentWell(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const list = (attempts.data?.attempts ?? []).filter((a) => !a.hidden || a.cookId === user.id);

  return (
    <section className="mt-8">
      <h2 className="mb-1 font-display text-2xl">I made this</h2>
      <p className="mb-3 text-sm text-muted">
        {list.length === 0
          ? 'Cook it and post how yours turned out.'
          : `${list.length} ${list.length === 1 ? 'attempt' : 'attempts'} so far`}
      </p>

      {list.length > 0 && (
        <ul className="mb-4 grid grid-cols-2 gap-2">
          {list.map((attempt) => (
            <AttemptTile
              key={attempt.id}
              attempt={attempt}
              mine={attempt.cookId === user.id}
              onDelete={() => remove.mutate(attempt.id)}
              onHide={() => hide.mutate(attempt.id)}
            />
          ))}
        </ul>
      )}

      <div className="rounded-[var(--radius-card)] bg-card p-4 shadow-[var(--shadow-card)]">
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="How did it go?"
          aria-label="Caption for your attempt"
          className="w-full rounded-2xl border-2 border-line bg-surface px-4 py-2.5 outline-none focus:border-ink"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setWentWell(wentWell === true ? null : true)}
            aria-pressed={wentWell === true}
            className={`rounded-full px-3 py-1.5 text-sm font-bold ${
              wentWell === true ? 'bg-mint text-mint-ink' : 'bg-raised text-muted'
            }`}
          >
            went well
          </button>
          <button
            type="button"
            onClick={() => setWentWell(wentWell === false ? null : false)}
            aria-pressed={wentWell === false}
            className={`rounded-full px-3 py-1.5 text-sm font-bold ${
              wentWell === false ? 'bg-peach text-peach-ink' : 'bg-raised text-muted'
            }`}
          >
            went sideways
          </button>

          <label className="ml-auto cursor-pointer rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-ink">
            {busy ? 'Posting…' : 'Add photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file !== undefined) void post(file);
              }}
            />
          </label>
        </div>
      </div>
    </section>
  );
}

/** One attempt photo. Split out so usePhotoUrl — a hook — has one component
 *  per list item to attach to, rather than being called inside a .map(). */
function AttemptTile({
  attempt,
  mine,
  onDelete,
  onHide,
}: {
  attempt: AttemptEntry;
  mine: boolean;
  onDelete: () => void;
  onHide: () => void;
}) {
  const url = usePhotoUrl(attempt.url);
  return (
    <li className="overflow-hidden rounded-[var(--radius-block)] bg-card shadow-[var(--shadow-card)]">
      {url !== undefined && (
        <img
          src={url}
          alt={attempt.caption.length > 0 ? attempt.caption : `${attempt.cookName}'s attempt`}
          className="aspect-square w-full object-cover"
        />
      )}
      <div className="p-3">
        <p className="truncate text-sm font-semibold">{attempt.cookName}</p>
        {attempt.caption.length > 0 && <p className="mt-0.5 text-sm text-muted">{attempt.caption}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {attempt.wentWell === true && <Chip tone="mint">went well</Chip>}
          {attempt.wentWell === false && <Chip tone="peach">went sideways</Chip>}
          {mine && (
            <button type="button" onClick={onDelete} className="text-xs font-semibold text-muted underline">
              delete
            </button>
          )}
          {!mine && !attempt.hidden && (
            <button type="button" onClick={onHide} className="text-xs font-semibold text-muted underline">
              hide
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
