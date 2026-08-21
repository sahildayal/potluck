import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { api, ApiError, type RecipeDraft, type SessionUser } from '../lib/api.ts';
import { Chip } from '../components/Chip.tsx';
import { Doodle } from '../components/Doodle.tsx';

/**
 * Import a recipe.
 *
 * Three doors — a link, a photo, or pasted text — all landing on the same
 * review screen. One thing to learn instead of three, and the review step is
 * what makes an unreliable extractor acceptable: nothing is saved until you
 * have looked at it.
 */
export function Import({ user }: { user: SessionUser }) {
  void user;
  const [tab, setTab] = useState<'url' | 'image' | 'text'>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: ({ kind, payload }: { kind: 'url' | 'image' | 'text'; payload: string }) =>
      api.imports.create(kind, payload),
    onSuccess: (result) => {
      setJobId(result.job.id);
      setError(null);
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'Could not start that import.');
    },
  });

  if (jobId !== null) return <ImportProgress jobId={jobId} onDiscard={() => setJobId(null)} />;

  return (
    <div className="wash-lilac safe-top min-h-dvh px-5 pb-16">
      <div className="mx-auto w-full max-w-2xl">
        <nav className="py-4">
          <Link
            href="/"
            className="inline-block rounded-full bg-surface px-4 py-2 text-sm font-bold shadow-[var(--shadow-card)]"
          >
            Cancel
          </Link>
        </nav>

        <h1 className="font-display text-[2rem] leading-none">Import a recipe</h1>
        <p className="mt-2 text-muted">
          You&rsquo;ll get to check everything before it saves.
        </p>

        <div className="mt-6 flex gap-1 rounded-full bg-raised p-1">
          {(['url', 'image', 'text'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTab(option)}
              aria-pressed={tab === option}
              className={`flex-1 rounded-full px-3 py-2.5 text-sm font-bold transition-colors ${
                tab === option ? 'bg-primary text-primary-ink' : 'text-muted'
              }`}
            >
              {option === 'url' ? 'Link' : option === 'image' ? 'Photo' : 'Paste'}
            </button>
          ))}
        </div>

        <div className="mt-5">
          {tab === 'url' && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                start.mutate({ kind: 'url', payload: url.trim() });
              }}
            >
              <label htmlFor="import-url" className="mb-1.5 block text-sm font-bold">
                Recipe link
              </label>
              <input
                id="import-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                required
                className="w-full rounded-2xl border-2 border-line bg-surface px-4 py-3 outline-none focus:border-ink"
              />
              <p className="mt-2 text-xs text-muted">
                Most recipe sites publish their recipe in a form we can read exactly, with no
                guessing. Instagram, TikTok and Facebook don&rsquo;t let apps read posts &mdash;
                screenshot those and use the Photo tab.
              </p>
              <Submit busy={start.isPending} disabled={url.trim().length === 0}>
                Read this link
              </Submit>
            </form>
          )}

          {tab === 'image' && <PhotoPicker onPicked={(payload) => start.mutate({ kind: 'image', payload })} busy={start.isPending} />}

          {tab === 'text' && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                start.mutate({ kind: 'text', payload: text.trim() });
              }}
            >
              <label htmlFor="import-text" className="mb-1.5 block text-sm font-bold">
                Paste the recipe
              </label>
              <textarea
                id="import-text"
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste anything — a message from a friend, a block of text off a page…"
                className="w-full resize-y rounded-2xl border-2 border-line bg-surface px-4 py-3 outline-none focus:border-ink"
              />
              <Submit busy={start.isPending} disabled={text.trim().length < 20}>
                Read this text
              </Submit>
            </form>
          )}
        </div>

        {error !== null && (
          <p role="alert" className="mt-5 rounded-2xl bg-danger-soft px-4 py-3 font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Submit({
  children,
  busy,
  disabled,
}: {
  children: React.ReactNode;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="mt-5 w-full rounded-full bg-primary px-4 py-4 font-bold text-primary-ink disabled:opacity-50"
    >
      {busy ? 'Starting…' : children}
    </button>
  );
}

/**
 * Downscales before upload.
 *
 * A modern phone photo is 4 MB and 4000px wide. The vision model does not need
 * that, the request would be slow over a kitchen connection, and the API caps
 * uploads at 2 MB — so it is resized in the browser where it costs nothing.
 */
function PhotoPicker({
  onPicked,
  busy,
}: {
  onPicked: (dataUrl: string) => void;
  busy: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function handle(file: File) {
    setWorking(true);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('no canvas');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      // JPEG rather than WebP: the vision model accepts both and JPEG is
      // smaller for photographs of text, which is what a recipe card is.
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      setPreview(dataUrl);
      onPicked(dataUrl);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div>
      <label
        htmlFor="import-photo"
        className="flex cursor-pointer flex-col items-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed border-line-strong bg-card px-6 py-10 text-center"
      >
        <span className="grid h-16 w-16 place-items-center rounded-full bg-peach text-peach-ink">
          <Doodle name="loaf" className="h-9 w-9" />
        </span>
        <span className="font-display text-lg">Photograph a recipe</span>
        <span className="max-w-xs text-sm text-muted">
          A recipe card, a page from a book, or a screenshot. Handwriting usually works.
        </span>
        <input
          id="import-photo"
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) void handle(file);
          }}
        />
      </label>

      {preview !== null && (
        <img
          src={preview}
          alt="The photo being imported"
          className="mt-4 max-h-64 w-full rounded-[var(--radius-block)] object-contain"
        />
      )}

      {(working || busy) && <p className="mt-4 text-center text-muted">Preparing the photo…</p>}
    </div>
  );
}

/** Polls the job and hands off to the review screen when it lands. */
function ImportProgress({ jobId, onDiscard }: { jobId: string; onDiscard: () => void }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const job = useQuery({
    queryKey: ['import', jobId],
    queryFn: () => api.imports.get(jobId),
    // Poll while it is working. The free tier's token budget means an import
    // can genuinely wait a minute before the model starts.
    refetchInterval: (query) => {
      const status = query.state.data?.job.status;
      return status === 'ready' || status === 'failed' ? false : 1500;
    },
  });

  const confirm = useMutation({
    mutationFn: (recipe: unknown) => api.imports.confirm(jobId, recipe),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['recipes'] });
      navigate(`/recipe/${result.recipe.id}`);
    },
  });

  const status = job.data?.job.status;

  if (status === 'failed') {
    return (
      <div className="wash-lilac safe-top grid min-h-dvh place-items-center px-5">
        <div className="w-full max-w-md rounded-[var(--radius-card)] bg-card p-6 text-center shadow-[var(--shadow-card)]">
          <h2 className="font-display text-2xl">That didn&rsquo;t work</h2>
          <p className="mt-2 text-muted">{job.data?.job.error ?? 'The import failed.'}</p>
          <button
            type="button"
            onClick={() => {
              void api.imports.discard(jobId);
              onDiscard();
            }}
            className="mt-5 w-full rounded-full bg-primary px-4 py-3.5 font-bold text-primary-ink"
          >
            Try something else
          </button>
        </div>
      </div>
    );
  }

  if (status !== 'ready' || job.data?.job.draft == null) {
    return (
      <div className="wash-lilac safe-top grid min-h-dvh place-items-center px-5 text-center">
        <div>
          <div className="mx-auto mb-4 grid h-20 w-20 animate-pulse place-items-center rounded-full bg-lilac text-lilac-ink">
            <Doodle name="pot" className="h-11 w-11" />
          </div>
          <h2 className="font-display text-2xl">Reading the recipe…</h2>
          <p className="mt-2 text-muted">
            {status === 'queued' ? 'Waiting for a turn' : 'Working through it'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ImportReview
      draft={job.data.job.draft}
      busy={confirm.isPending}
      onDiscard={() => {
        void api.imports.discard(jobId);
        onDiscard();
      }}
      onSave={(recipe) => confirm.mutate(recipe)}
    />
  );
}

/**
 * The review screen — the trust-critical one.
 *
 * Everything is editable and nothing is saved until the button is pressed. A
 * bad parse becomes a two-second correction rather than a corrupted recipe,
 * which is the entire reason the extractor is allowed to be imperfect.
 */
function ImportReview({
  draft,
  busy,
  onDiscard,
  onSave,
}: {
  draft: RecipeDraft;
  busy: boolean;
  onDiscard: () => void;
  onSave: (recipe: unknown) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [servings, setServings] = useState(draft.servings === null ? '' : String(draft.servings));
  const [ingredients, setIngredients] = useState(draft.ingredients.map((i) => i.rawText).join('\n'));
  const [steps, setSteps] = useState(draft.steps.map((s) => s.body).join('\n\n'));

  useEffect(() => {
    setTitle(draft.title);
    setServings(draft.servings === null ? '' : String(draft.servings));
    setIngredients(draft.ingredients.map((i) => i.rawText).join('\n'));
    setSteps(draft.steps.map((s) => s.body).join('\n\n'));
  }, [draft]);

  const via =
    draft.via === 'metadata'
      ? { label: 'read exactly from the page', tone: 'mint' as const }
      : draft.via === 'vision'
        ? { label: 'read from your photo', tone: 'peach' as const }
        : { label: 'interpreted by a model', tone: 'lilac' as const };

  return (
    <form
      className="wash-lilac safe-top min-h-dvh px-5 pb-16"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          title: title.trim(),
          servings: servings.trim().length > 0 ? Number(servings) : null,
          sourceType: draft.via === 'vision' ? 'photo' : draft.via === 'metadata' ? 'website' : 'manual',
          notes: draft.notes ?? '',
          ingredients: ingredients
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((rawText) => ({ rawText })),
          steps: steps
            .split(/\n\s*\n/)
            .map((block) => block.trim().replace(/\s*\n\s*/g, ' '))
            .filter((block) => block.length > 0)
            .map((body) => ({ body })),
        });
      }}
    >
      <div className="mx-auto w-full max-w-2xl">
        <nav className="flex items-center justify-between py-4">
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-full bg-surface px-4 py-2 text-sm font-bold shadow-[var(--shadow-card)]"
          >
            Discard
          </button>
          <Chip tone={via.tone}>{via.label}</Chip>
        </nav>

        <h1 className="font-display text-[2rem] leading-none">Check this over</h1>
        <p className="mt-2 text-muted">
          Fix anything that came out wrong. Nothing is saved until you tap the button.
        </p>

        <div className="mt-6 flex flex-col gap-5">
          <Field label="Title" value={title} onChange={setTitle} />
          <div className="w-32">
            <Field label="Serves" value={servings} onChange={setServings} numeric />
          </div>
          <Area label="Ingredients" value={ingredients} onChange={setIngredients} rows={9} />
          <Area label="Method" value={steps} onChange={setSteps} rows={11} />
        </div>

        <button
          type="submit"
          disabled={busy || title.trim().length === 0}
          className="mt-7 w-full rounded-full bg-primary px-4 py-4 font-bold text-primary-ink disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save to my recipes'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  numeric,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  numeric?: boolean;
}) {
  const id = `r-${label.toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-bold">
        {label}
      </label>
      <input
        id={id}
        value={value}
        inputMode={numeric === true ? 'numeric' : 'text'}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border-2 border-line bg-surface px-4 py-3 outline-none focus:border-ink"
      />
    </div>
  );
}

function Area({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  rows: number;
}) {
  const id = `r-${label.toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-bold">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-2xl border-2 border-line bg-surface px-4 py-3 outline-none focus:border-ink"
      />
    </div>
  );
}
