/**
 * Cloudflare Pages worker: serves the PWA and proxies the API onto the same
 * origin.
 *
 * Why this exists at all — the session cookie.
 *
 * With the app on pages.dev and the API on onrender.com, the browser sees the
 * cookie as third-party. Safari has blocked those outright since 2020, so on
 * every iPhone the sign-in POST succeeded, the Set-Cookie was discarded, the
 * next request came back anonymous, and the app quietly re-rendered the sign-in
 * screen. No error anywhere, because nothing had errored. Desktop Chrome still
 * permits SameSite=None cookies, which is exactly why it looked fine there.
 *
 * Note this was never a Cloudflare problem: onrender.com is on the Public
 * Suffix List, so potluck-web.onrender.com and potluck-api-pcct.onrender.com
 * were cross-site too. The move here neither caused it nor fixed it.
 *
 * Routing /api through this worker means the browser only ever talks to one
 * origin. The cookie is first-party, Safari keeps it, and CORS stops being
 * involved. It also makes production match development, where Vite has always
 * proxied /api for the same reason.
 *
 * The cost is one extra hop: browser -> Cloudflare edge -> Render.
 */

/**
 * Where the API actually lives. If the API moves, this moves with it — the
 * built bundle now uses relative paths, so nothing else needs to know.
 */
const API_ORIGIN = 'https://potluck-api-pcct.onrender.com';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /health and /ready are API endpoints that happen to sit above /api, so
    // they need naming explicitly. Without them the smoke test asked this
    // origin whether the service was ready and got the app's own HTML back.
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname === '/health' ||
      url.pathname === '/ready'
    ) {
      const target = new URL(url.pathname + url.search, API_ORIGIN);
      // Constructing from the original request carries the method, headers and
      // body through untouched — including Origin, which better-auth checks for
      // CSRF, and Cookie, which is the whole point of the exercise.
      return fetch(new Request(target, request));
    }

    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;

    // The app routes /browse and /recipe/:id itself, so an unknown path is a
    // client route rather than a missing file. Only navigations fall back: a
    // POST to a path that does not exist is a genuine 404, and replaying it
    // against index.html would hide a real bug.
    if (request.method !== 'GET') return asset;

    return env.ASSETS.fetch(new Request(new URL('/index.html', url), { method: 'GET' }));
  },
};
