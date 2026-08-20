import { describe, expect, it } from 'vitest';
import { detectDurations, formatDuration, primaryDuration } from './duration.js';

describe('detectDurations', () => {
  it('finds a simple duration', () => {
    const [first] = detectDurations('Simmer for 10 minutes.');
    expect(first?.seconds).toBe(600);
    expect(first?.text).toBe('10 minutes');
  });

  it('handles hours and abbreviations', () => {
    expect(detectDurations('Bake 1 hour')[0]?.seconds).toBe(3600);
    expect(detectDurations('Rest 45 min')[0]?.seconds).toBe(2700);
    expect(detectDurations('Blanch 90 secs')[0]?.seconds).toBe(90);
  });

  it('folds "1 hour 30 minutes" into one duration', () => {
    const found = detectDurations('Braise for 1 hour 30 minutes until tender.');
    expect(found).toHaveLength(1);
    expect(found[0]?.seconds).toBe(5400);
  });

  it('keeps genuinely separate durations separate', () => {
    const found = detectDurations('Bake 40 minutes, then cool 15 minutes before slicing.');
    expect(found).toHaveLength(2);
    expect(found[0]?.seconds).toBe(2400);
    expect(found[1]?.seconds).toBe(900);
  });

  it('takes the lower bound of a range so the timer fires early', () => {
    expect(detectDurations('Fry 5 to 7 minutes')[0]?.seconds).toBe(300);
    expect(detectDurations('Rest 1-2 hours')[0]?.seconds).toBe(3600);
  });

  it('ignores numbers that are not durations', () => {
    expect(detectDurations('Serves 4 people.')).toHaveLength(0);
    expect(detectDurations('Add 2 onions and 3 cloves of garlic.')).toHaveLength(0);
  });

  it('does not mistake an oven temperature for a timer', () => {
    const found = detectDurations('Preheat to 350F, then bake 25 minutes.');
    expect(found).toHaveLength(1);
    expect(found[0]?.seconds).toBe(1500);
  });

  it('rejects implausibly long durations', () => {
    expect(detectDurations('Ferment 200 hours')).toHaveLength(0);
  });
});

describe('primaryDuration', () => {
  it('offers the longest duration in a step', () => {
    expect(primaryDuration('Bake 40 minutes, checking every 5 minutes.')).toBe(2400);
  });

  it('returns null when a step has no timer', () => {
    expect(primaryDuration('Season generously with salt.')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('renders minutes and seconds', () => {
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(600)).toBe('10:00');
  });

  it('renders hours when present', () => {
    expect(formatDuration(5400)).toBe('1:30:00');
  });
});
