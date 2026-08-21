import { useEffect, useState } from 'react';
import { mediaUrl } from './api.ts';

/**
 * Turns a photo endpoint path into a same-origin object URL the browser can
 * actually paint.
 *
 * Photo routes are cookie-authenticated, and in production web and API sit on
 * different origins. A plain `<img src="https://api…">` does not reliably
 * carry the session cookie there — third-party cookie restrictions drop it
 * silently, so the photo would 404 in production while working fine on
 * localhost where everything is same-origin. Fetching the bytes ourselves
 * with `credentials: 'include'` sends the cookie explicitly, and handing the
 * browser the resulting blob as an object URL sidesteps the whole problem.
 *
 * The object URL is revoked whenever the path changes and on unmount, so
 * scrolling past a hundred recipe cards does not pin a hundred blobs in
 * memory.
 */
export function usePhotoUrl(path: string | null | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    setUrl(undefined);
    if (path === null || path === undefined) return;

    let cancelled = false;
    let objectUrl: string | undefined;

    void fetch(mediaUrl(path), { credentials: 'include' })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (cancelled || blob === null) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        // Left as undefined — callers fall back to the doodle rather than
        // showing a broken-image icon.
      });

    return () => {
      cancelled = true;
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return url;
}
