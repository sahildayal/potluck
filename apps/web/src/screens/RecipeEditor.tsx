import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { api, ApiError, type SessionUser } from '../lib/api.ts';

/**
 * Manual entry and editing.
 *
 * Ingredients and steps are plain textareas, one per line, rather than a list of
 * individually-managed input rows. People type recipes the way they read them,
 * and a row-per-ingredient form with add and remove buttons is slower for
 * exactly the bulk-entry case this screen exists for. Parsing happens server
 * side, so a line typed here gets the same treatment as one from an import.
 */
export function RecipeEditor({ id, user }: { id?: string; user: SessionUser }) {
  void user;
  const editing = id !== undefined;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const existing = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => api.recipes.get(id as string),
    enabled: editing,
  });

  const [title, setTitle] = useState('');
  const [servings, setServings] = useState('');
  const [attributedTo, setAttributedTo] = useState('');
  const [story, setStory] = useState('');
  const [ingredientText, setIngredientText] = useState('');
  const [stepText, setStepText] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);

  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });

  useEffect(() => {
    const recipe = existing.data?.recipe;
    if (recipe === undefined) return;
    setTitle(recipe.title);
    setServings(recipe.servings === null ? '' : String(recipe.servings));
    setAttributedTo(recipe.attributedTo);
    setStory(recipe.story);
    setNotes(recipe.notes);
    setIngredientText(recipe.ingredients.map((i) => i.rawText).join('\n'));
    setStepText(recipe.steps.map((s) => s.body).join('\n\n'));
    setCategoryIds(recipe.categoryIds ?? []);
  }, [existing.data]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        servings: servings.trim().length > 0 ? Number(servings) : null,
        attributedTo: attributedTo.trim(),
        story: story.trim(),
        notes: notes.trim(),
        categoryIds,
        ingredients: toLines(ingredientText).map((rawText) => ({ rawText })),
        steps: toParagraphs(stepText).map((body) => ({ body })),
      };
      return editing
        ? api.recipes.update(id as string, payload)
        : api.recipes.create(payload);
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['recipes'] });
      void queryClient.invalidateQueries({ queryKey: ['recipe', result.recipe.id] });
      navigate(`/recipe/${result.recipe.id}`);
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : 'Could not save. Try again.');
    },
  });

  return (
    <form
      className="wash-lilac safe-top min-h-dvh px-5 pb-16"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <div className="mx-auto w-full max-w-2xl">
      <nav className="py-4">
        <Link
          href={editing ? `/recipe/${id}` : '/'}
          className="inline-block rounded-full bg-surface px-4 py-2 text-sm font-bold shadow-[var(--shadow-card)]"
        >
          Cancel
        </Link>
      </nav>

      <h1 className="font-display text-[2rem] leading-none">{editing ? 'Edit recipe' : 'Add a recipe'}</h1>

      <div className="mt-6 flex flex-col gap-5">
        <Text label="Title" value={title} onChange={setTitle} required />

        <div className="flex gap-4">
          <div className="w-28">
            <Text label="Serves" value={servings} onChange={setServings} inputMode="numeric" />
          </div>
          <div className="flex-1">
            <Text
              label="Whose recipe?"
              value={attributedTo}
              onChange={setAttributedTo}
              hint="Dadi, Mum, that place in Mutrah…"
            />
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-bold">Sections</span>
          <div className="flex flex-wrap gap-2">
            {(categories.data?.categories ?? []).map((category) => {
              const on = categoryIds.includes(category.id);
              return (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setCategoryIds((previous) =>
                      previous.includes(category.id)
                        ? previous.filter((id) => id !== category.id)
                        : [...previous, category.id],
                    )
                  }
                  className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                    on ? 'bg-primary text-primary-ink' : 'bg-surface text-muted'
                  }`}
                >
                  {category.name}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted">
            Where it shows up on your home screen. A recipe can sit in more than one.
          </p>
        </div>

        <Area
          label="Ingredients"
          value={ingredientText}
          onChange={setIngredientText}
          rows={8}
          hint="One per line, exactly as you'd write them. Quantities are worked out for you."
          placeholder={'2 medium potatoes, cubed\n1 tsp cumin seeds\na pinch of saffron'}
        />

        <Area
          label="Method"
          value={stepText}
          onChange={setStepText}
          rows={10}
          hint="One step per paragraph. Times like “simmer 10 minutes” become timers in Cook Mode."
          placeholder={'Heat the oil and crackle the cumin for 30 seconds.\n\nAdd the potatoes and fry 8 minutes.'}
        />

        {/* Story and notes are different things and must not share a field: the
            story is why this recipe matters to you, the notes are what to watch
            out for while cooking it. */}
        <Area
          label="Story"
          value={story}
          onChange={setStory}
          rows={3}
          hint="Where it came from, who taught you. Optional."
        />

        <Area
          label="Notes"
          value={notes}
          onChange={setNotes}
          rows={3}
          hint="Anything you'd tell someone cooking it for the first time."
        />
      </div>

      {error !== null && (
        <p role="alert" className="mt-5 rounded-2xl bg-danger-soft px-4 py-3 font-medium text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={save.isPending || title.trim().length === 0}
        className="mt-7 w-full rounded-full bg-primary px-4 py-4 font-bold text-primary-ink disabled:opacity-50"
      >
        {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add to my recipes'}
      </button>
      </div>
    </form>
  );
}

/** Blank lines are separators people type by habit, not empty ingredients. */
export function toLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Steps are paragraph-separated so a step can wrap onto several lines. */
export function toParagraphs(value: string): string[] {
  return value
    .split(/\n\s*\n/)
    .map((block) => block.trim().replace(/\s*\n\s*/g, ' '))
    .filter((block) => block.length > 0);
}

interface TextProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  required?: boolean;
  inputMode?: 'numeric' | 'text';
}

function Text({ label, value, onChange, hint, required, inputMode }: TextProps) {
  const id = `f-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-bold">
        {label}
      </label>
      <input
        id={id}
        value={value}
        required={required}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border-2 border-line bg-surface px-4 py-3 outline-none focus:border-ink"
      />
      {hint !== undefined && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Area({
  label,
  value,
  onChange,
  rows,
  hint,
  placeholder,
}: TextProps & { rows: number; placeholder?: string }) {
  const id = `f-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-bold">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-2xl border-2 border-line bg-surface px-4 py-3 outline-none focus:border-ink"
      />
      {hint !== undefined && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
