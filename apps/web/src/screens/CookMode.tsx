import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { formatDuration } from '@potluck/core';
import { api, type SessionUser } from '../lib/api.ts';

/**
 * Cook Mode — the screen this whole app exists to be good at.
 *
 * Design constraints come from the kitchen, not from a style guide: the phone
 * is propped against something two feet away, your hands are wet, and you get
 * one glance. So: one step at a time, type large enough to read standing up,
 * the entire left and right halves of the screen as navigation targets, and the
 * screen kept awake.
 *
 * The signature is the timer. A duration detected in the step text becomes a
 * saffron band that drains across the bottom of the screen as it runs — legible
 * from across the room without reading a single digit, which is the actual job.
 */
export function CookMode({ id, user }: { id: string; user: SessionUser }) {
  void user;
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery({
    queryKey: ['recipe', id],
    queryFn: () => api.recipes.get(id),
  });

  const recipe = data?.recipe;
  const steps = recipe?.steps ?? [];
  const [index, setIndex] = useState(0);

  const step = steps[index];
  const total = steps.length;

  const next = useCallback(() => setIndex((i) => Math.min(total - 1, i + 1)), [total]);
  const previous = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useWakeLock(total > 0);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowRight' || event.key === ' ') next();
      if (event.key === 'ArrowLeft') previous();
      if (event.key === 'Escape') navigate(`/recipe/${id}`);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, previous, navigate, id]);

  if (isLoading) return <Centered>Getting the method…</Centered>;
  if (recipe === undefined || step === undefined) return <Centered>Nothing to cook here.</Centered>;

  return (
    <div className="relative flex min-h-dvh flex-col bg-ground">
      <header className="flex items-center justify-between px-5 py-4">
        <button
          type="button"
          onClick={() => navigate(`/recipe/${id}`)}
          className="text-sm text-muted underline underline-offset-2"
        >
          Stop cooking
        </button>
        <p className="tnum text-sm text-muted">
          Step {index + 1} of {total}
        </p>
      </header>

      {/* The whole middle of the screen is the navigation target. Tapping the
          left third goes back, the rest goes forward — no small buttons to hit
          with the back of a knuckle. */}
      <main className="relative flex flex-1 items-center px-6">
        <button
          type="button"
          onClick={previous}
          disabled={index === 0}
          aria-label="Previous step"
          className="absolute inset-y-0 left-0 w-1/3 cursor-w-resize disabled:cursor-default"
        />
        <button
          type="button"
          onClick={next}
          disabled={index === total - 1}
          aria-label="Next step"
          className="absolute inset-y-0 right-0 w-2/3 cursor-e-resize disabled:cursor-default"
        />

        <p className="pointer-events-none relative mx-auto max-w-2xl text-[clamp(1.75rem,5.5vw,3rem)] leading-[1.25] font-medium">
          {step.body}
        </p>
      </main>

      <footer className="px-5 pb-8">
        {step.durationSeconds !== null && step.durationSeconds !== undefined ? (
          <Timer key={step.id ?? index} seconds={step.durationSeconds} />
        ) : (
          <StepDots total={total} index={index} />
        )}
      </footer>
    </div>
  );
}

/**
 * The draining band.
 *
 * Deliberately not a spinner or a ring: a horizontal band the width of the
 * screen is readable at a glance from a distance, and its remaining length maps
 * directly onto remaining time without any reading.
 */
function Timer({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const from = remaining;
    const tick = window.setInterval(() => {
      const left = Math.max(0, from - Math.round((Date.now() - started) / 1000));
      setRemaining(left);
      if (left === 0) {
        setRunning(false);
        setDone(true);
      }
    }, 250);
    return () => window.clearInterval(tick);
    // `remaining` is intentionally not a dependency: including it would restart
    // the interval every tick and the timer would never advance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const fraction = seconds > 0 ? remaining / seconds : 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (done) {
            setRemaining(seconds);
            setDone(false);
            setRunning(true);
          } else {
            setRunning((r) => !r);
          }
        }}
        className="flex w-full items-baseline justify-between rounded-md border border-line bg-surface px-4 py-3"
      >
        <span className="font-medium">
          {done ? 'Time’s up — start again' : running ? 'Pause' : `Start ${formatDuration(seconds)}`}
        </span>
        <span className="tnum font-display text-2xl">{formatDuration(remaining)}</span>
      </button>

      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-raised"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={seconds}
        aria-valuenow={remaining}
        aria-label="Time remaining"
      >
        <div
          className="h-full rounded-full bg-saffron transition-[width] duration-1000 ease-linear"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}

function StepDots({ total, index }: { total: number; index: number }) {
  return (
    <div className="flex justify-center gap-1.5" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i === index ? 'w-6 bg-enamel' : 'w-1.5 bg-line-strong'
          }`}
        />
      ))}
    </div>
  );
}

/**
 * Keeps the screen on while cooking.
 *
 * Wake Lock is unsupported on some browsers and rejects when the tab is
 * backgrounded; both are fine and neither should surface an error to someone
 * holding a knife. Failing silently is the correct behaviour here.
 */
function useWakeLock(active: boolean): void {
  const lock = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;

    let cancelled = false;

    const acquire = async () => {
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void sentinel.release();
          return;
        }
        lock.current = sentinel;
      } catch {
        // No wake lock available. The recipe still works.
      }
    };

    void acquire();

    // Re-acquire when returning from another app; the lock is dropped on hide.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock.current?.release();
      lock.current = null;
    };
  }, [active]);
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-dvh place-items-center p-8 text-muted">{children}</div>;
}
