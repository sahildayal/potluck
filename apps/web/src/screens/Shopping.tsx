import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatQuantity, type UnitSystem } from '@potluck/core';
import { api, type SessionUser, type ShoppingItem } from '../lib/api.ts';
import { BottomNav, NavSpacer } from '../components/BottomNav.tsx';
import { Doodle } from '../components/Doodle.tsx';

/**
 * The shopping list.
 *
 * Designed for one hand in a supermarket aisle: big tap targets, checked items
 * sink to the bottom rather than vanishing (so you can untick a mistake), and
 * the add field stays at the top where your thumb already is.
 */
export function Shopping({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const system: UnitSystem = user.unitPreference === 'imperial' ? 'imperial' : 'metric';

  const list = useQuery({ queryKey: ['shopping'], queryFn: api.shopping.list });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['shopping'] });

  const add = useMutation({
    mutationFn: (item: string) => api.shopping.add(item),
    onSuccess: () => {
      setDraft('');
      void invalidate();
    },
  });

  const check = useMutation({
    mutationFn: ({ id, checked }: { id: string; checked: boolean }) => api.shopping.check(id, checked),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.shopping.remove(id),
    onSuccess: invalidate,
  });

  const clear = useMutation({ mutationFn: api.shopping.clearChecked, onSuccess: invalidate });

  const items = list.data?.items ?? [];
  const outstanding = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);

  return (
    <div className="wash-mint safe-top min-h-dvh">
      <div className="mx-auto w-full max-w-2xl px-5">
        <header className="pt-4 pb-5">
          <h1 className="font-display text-[2rem] leading-none">Shopping</h1>
          <p className="mt-1 text-sm font-semibold text-muted">
            {outstanding.length === 0
              ? 'Nothing left to buy'
              : `${outstanding.length} still to get`}
          </p>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim().length > 0) add.mutate(draft.trim());
          }}
          className="flex gap-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add something — “2 cups rice”"
            aria-label="Add an item"
            className="min-w-0 flex-1 rounded-full border-2 border-line bg-surface px-5 py-3.5 outline-none focus:border-ink"
          />
          <button
            type="submit"
            disabled={draft.trim().length === 0}
            className="shrink-0 rounded-full bg-primary px-5 py-3.5 font-bold text-primary-ink disabled:opacity-40"
          >
            Add
          </button>
        </form>

        {list.isSuccess && items.length === 0 && <EmptyList />}

        <ul className="mt-5 flex flex-col gap-2">
          {[...outstanding, ...done].map((item) => (
            <li key={item.id}>
              <Row
                item={item}
                system={system}
                onToggle={() => check.mutate({ id: item.id, checked: !item.checked })}
                onRemove={() => remove.mutate(item.id)}
              />
            </li>
          ))}
        </ul>

        {done.length > 0 && (
          <button
            type="button"
            onClick={() => clear.mutate()}
            className="mt-5 w-full rounded-full border-2 border-line py-3 font-bold text-muted"
          >
            Clear {done.length} ticked {done.length === 1 ? 'item' : 'items'}
          </button>
        )}

        <NavSpacer />
      </div>
      <BottomNav />
    </div>
  );
}

function Row({
  item,
  system,
  onToggle,
  onRemove,
}: {
  item: ShoppingItem;
  system: UnitSystem;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const formatted =
    item.qtyCanonical !== null && item.unitCanonical !== null
      ? formatQuantity(
          {
            qty: item.qtyCanonical,
            unit: item.unitCanonical,
            dimension:
              item.unitCanonical === 'g' ? 'mass' : item.unitCanonical === 'ml' ? 'volume' : 'count',
          },
          system,
        )
      : null;

  return (
    <div
      className={`flex items-center gap-3 rounded-[var(--radius-block)] bg-card px-4 py-3 shadow-[var(--shadow-card)] ${
        item.checked ? 'opacity-55' : ''
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        role="checkbox"
        aria-checked={item.checked}
        aria-label={`${item.checked ? 'Untick' : 'Tick'} ${item.item}`}
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition-colors ${
          item.checked ? 'border-mint-ink bg-mint text-mint-ink' : 'border-line-strong'
        }`}
      >
        {item.checked && (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m5 13 4 4L19 7" />
          </svg>
        )}
      </button>

      <span className={`min-w-0 flex-1 ${item.checked ? 'line-through' : ''}`}>
        {formatted !== null && (
          <span className="tnum font-bold">
            {formatted.value}
            {formatted.unit.length > 0 ? ` ${formatted.unit}` : ''}{' '}
          </span>
        )}
        {item.item}
      </span>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${item.item}`}
        className="shrink-0 px-1 text-xl leading-none text-muted"
      >
        &times;
      </button>
    </div>
  );
}

function EmptyList() {
  return (
    <div className="mt-6 rounded-[var(--radius-card)] bg-card px-6 py-12 text-center shadow-[var(--shadow-card)]">
      <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-full bg-mint text-mint-ink">
        <Doodle name="greens" className="h-11 w-11" />
      </div>
      <h2 className="font-display text-2xl">Empty basket</h2>
      <p className="mx-auto mt-2 max-w-xs text-muted">
        Add something above, or open a recipe and send its ingredients straight here.
      </p>
    </div>
  );
}
