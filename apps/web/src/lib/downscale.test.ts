import { describe, expect, it } from 'vitest';
import { fitWithinEdge, formatBytes } from './downscale.ts';

/**
 * The dimension maths is the one part of the upload path that runs with no
 * canvas involved, so it is what gets pinned down here — a wrong answer means
 * either an unnecessarily tiny photo or an upload that blows past the 2 MB
 * server cap.
 */
describe('fitWithinEdge', () => {
  it('leaves an image already within the cap untouched', () => {
    expect(fitWithinEdge(800, 600, 1200)).toEqual({ width: 800, height: 600 });
  });

  it('scales the longest edge down to the cap, keeping aspect ratio', () => {
    // 4000x3000 is 4:3; scaling the 4000 edge to 1200 should take 3000 to 900.
    expect(fitWithinEdge(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 });
  });

  it('scales by whichever edge is longest, not always width', () => {
    // A portrait photo's longest edge is height.
    expect(fitWithinEdge(3000, 4000, 1200)).toEqual({ width: 900, height: 1200 });
  });

  it('never upscales a smaller source image', () => {
    expect(fitWithinEdge(400, 300, 1200)).toEqual({ width: 400, height: 300 });
  });

  it('lands exactly on the cap for a square image over the limit', () => {
    expect(fitWithinEdge(2000, 2000, 1200)).toEqual({ width: 1200, height: 1200 });
  });

  it('never rounds a dimension down to zero for an extreme aspect ratio', () => {
    const { height } = fitWithinEdge(12000, 5, 1200);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});

describe('formatBytes', () => {
  it('shows small counts in bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('rounds to the nearest kilobyte once past 1024 bytes', () => {
    expect(formatBytes(102_400)).toBe('100 KB');
  });
});
