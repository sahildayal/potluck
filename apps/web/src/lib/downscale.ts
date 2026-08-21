/**
 * Client-side photo downscaling before upload.
 *
 * Load-bearing, not a nicety: the free Neon tier is 512 MB total and photo
 * bytes share it with every recipe's text, so a phone's 4000px, 4 MB original
 * would eat the database in a few dozen uploads. Capping the longest edge at
 * 1200px and re-encoding as WebP at 0.82 quality gets a typical kitchen photo
 * down to roughly 80-150 KB — small enough that a few thousand photos still
 * fit alongside the recipes.
 */

const MAX_EDGE = 1200;
const QUALITY = 0.82;

/**
 * The resize maths on its own, split out so it can be unit tested without a
 * canvas. Never upscales — a small source image is left exactly as it is,
 * because stretching it would spend bytes making it blurrier, not sharper.
 */
export function fitWithinEdge(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface EncodedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Decodes a picked file, resizes it onto a canvas, and re-encodes it.
 *
 * WebP first, since it gets the target size at a given quality more reliably
 * than JPEG. Safari on older iOS cannot encode WebP from canvas — `toBlob`
 * hands back null rather than throwing — so a JPEG retry at the same quality
 * is the fallback rather than a hard failure.
 */
export async function encodeForUpload(file: File): Promise<EncodedPhoto> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithinEdge(bitmap.width, bitmap.height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('Canvas is not available in this browser');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const webp = await toBlob(canvas, 'image/webp');
  const blob = webp ?? (await toBlob(canvas, 'image/jpeg'));
  if (blob === null) throw new Error('This browser could not encode the photo');

  return { blob, width, height };
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/** "142 KB" — how the upload UI shows what a photo cost, per the requirement
 *  that the user sees the resulting size rather than taking it on faith. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}
