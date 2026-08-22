#!/usr/bin/env node
/**
 * Smoke test against a running deployment.
 *
 * Deliberately end-to-end and deliberately small: it exercises the paths that
 * would be catastrophic to ship broken, not every branch. If signup works, a
 * recipe round-trips with its quantities parsed, and row-level security still
 * refuses a stranger's recipe, the deployment is fundamentally sound.
 *
 * Usage: node scripts/smoke.mjs http://localhost:8787 [origin]
 *
 * better-auth enforces CSRF by checking the Origin header against its
 * trustedOrigins, so every request carries one — a request without an Origin is
 * rejected with 403, exactly as a browser-less attacker's would be. The origin
 * defaults to the base URL and can be overridden when the API is configured
 * with a different APP_URL than the one being called (dev runs the web app on
 * :5173 and the API on :8787).
 */

const base = process.argv[2] ?? 'http://localhost:8787';
const origin = process.argv[3] ?? process.env.SMOKE_ORIGIN ?? base;

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Keeps the session cookie across requests, the way a browser would. */
function makeClient() {
  let cookie = '';
  return async (path, init = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie.length > 0 ? { Cookie: cookie } : {}),
        Origin: origin,
        ...init.headers,
      },
      redirect: 'manual',
    });
    const setCookie = response.headers.getSetCookie?.() ?? [];
    if (setCookie.length > 0) {
      cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    }
    const text = await response.text();
    let body = null;
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  };
}

async function waitForReady(attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${base}/ready`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return true;
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function main() {
  console.log(`smoke test against ${base}\n`);

  const ready = await waitForReady();
  check('service reports ready', ready);
  if (!ready) process.exit(1);

  const health = await fetch(`${base}/health`).then((r) => r.json());
  check('liveness responds', health.ok === true);

  const alice = makeClient();
  const suffix = Date.now();

  // --- signup ---------------------------------------------------------------
  const signUp = await alice('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({
      email: `alice-${suffix}@smoke.test`,
      password: 'a-really-long-password',
      name: 'Alice',
      handle: `alice${suffix}`,
    }),
  });
  check('signup succeeds', signUp.status === 200, `status ${signUp.status}`);

  const me = await alice('/api/me');
  check('session resolves', me.body?.user?.handle === `alice${suffix}`);

  // --- default categories ---------------------------------------------------
  const categories = await alice('/api/categories');
  check(
    'five default categories seeded',
    categories.body?.categories?.length === 5,
    `got ${categories.body?.categories?.length}`,
  );

  // --- recipe round trip ----------------------------------------------------
  const created = await alice('/api/recipes', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Smoke Test Dal',
      servings: 4,
      ingredients: [{ rawText: '1 cup red lentils' }, { rawText: 'salt to taste' }],
      steps: [{ body: 'Simmer 25 minutes until collapsing.' }],
    }),
  });
  check('recipe created', created.status === 201, `status ${created.status}`);

  const recipe = created.body?.recipe;
  if (recipe === undefined || recipe === null) {
    console.error('recipe was not created; the checks below cannot run');
    console.log(`${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  }

  check(
    'quantities parsed into canonical units',
    recipe?.ingredients?.[0]?.qtyCanonical > 200 && recipe?.ingredients?.[0]?.unitCanonical === 'ml',
    JSON.stringify(recipe?.ingredients?.[0]),
  );
  check(
    'unparseable quantity kept as raw text',
    recipe?.ingredients?.[1]?.qtyCanonical === null,
  );
  check(
    'timer detected from step text',
    recipe?.steps?.[0]?.durationSeconds === 1500,
    `got ${recipe?.steps?.[0]?.durationSeconds}`,
  );

  // --- shopping list --------------------------------------------------------
  const shopping = await alice(`/api/shopping/from-recipe/${recipe.id}`, {
    method: 'POST',
    body: '{}',
  });
  check('ingredients reach the shopping list', shopping.body?.items?.length >= 2);

  // --- authorisation --------------------------------------------------------
  // The important one. A second account must not see the first one's recipe,
  // and this is checked through the public API rather than against the database
  // — if row-level security regressed, this is where it shows.
  const bob = makeClient();
  await bob('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({
      email: `bob-${suffix}@smoke.test`,
      password: 'a-really-long-password',
      name: 'Bob',
      handle: `bob${suffix}`,
    }),
  });

  const bobList = await bob('/api/recipes');
  check("stranger's recipe list is empty", bobList.body?.recipes?.length === 0);

  const bobDirect = await bob(`/api/recipes/${recipe.id}`);
  check(
    'stranger cannot fetch the recipe by id',
    bobDirect.status === 404,
    `status ${bobDirect.status}`,
  );

  const anonymous = await fetch(`${base}/api/recipes`);
  check('anonymous request is rejected', anonymous.status === 401, `status ${anonymous.status}`);

  // Photo upload, and specifically the hero id reaching the *list* endpoint.
  //
  // This is a regression test for a correlated-subquery bug that produced no
  // error and no warning: the hero lookup interpolated a bare "id", which
  // Postgres resolved against recipe_photos rather than the outer recipes row,
  // so the comparison was rp.recipe_id = rp.id and heroPhotoId was always null.
  // The recipe detail endpoint was unaffected, so only a card on the list
  // screen showed the fault — as a missing photo, which looks like a styling
  // problem rather than a broken query.
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  // init.headers is spread last in makeClient, so this overrides its JSON default.
  const upload = await alice(`/api/photos/recipes/${recipe.id}?width=1&height=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: onePixelPng,
  });
  const uploaded = upload.body;
  check('owner can upload a photo', upload.status === 201, `status ${upload.status}`);
  check('first photo becomes the hero', uploaded?.isHero === true);

  const withPhoto = await alice('/api/recipes');
  const listed = withPhoto.body?.recipes?.find((r) => r.id === recipe.id);
  check(
    'hero photo id reaches the recipe list',
    listed?.heroPhotoId === uploaded?.id,
    `list gave ${String(listed?.heroPhotoId)}, upload gave ${String(uploaded?.id)}`,
  );

  // Signing in by handle as well as by email.
  //
  // Added after a real lockout: the account existed, the password was right,
  // and the email had one character different from the handle. The app never
  // displays the address it was created with, so there was nothing to check
  // against.
  const byHandle = await fetch(`${base}/api/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ identifier: `alice${suffix}`, password: 'a-really-long-password' }),
  });
  check('can sign in with a handle', byHandle.status === 200, `status ${byHandle.status}`);

  const byEmail = await fetch(`${base}/api/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ identifier: `alice-${suffix}@smoke.test`, password: 'a-really-long-password' }),
  });
  check('can still sign in with an email', byEmail.status === 200, `status ${byEmail.status}`);

  const wrongPassword = await fetch(`${base}/api/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ identifier: `alice${suffix}`, password: 'not-the-password' }),
  });
  check('a wrong password still fails', wrongPassword.status === 401, `status ${wrongPassword.status}`);

  const noSuchHandle = await fetch(`${base}/api/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ identifier: 'nobodyhasthishandle', password: 'a-really-long-password' }),
  });
  const noSuchBody = await noSuchHandle.json().catch(() => ({}));
  check(
    'an unknown handle fails the same way as a wrong password',
    noSuchHandle.status === 401 && /invalid email or password/i.test(String(noSuchBody.message ?? '')),
    `status ${noSuchHandle.status}, message ${String(noSuchBody.message)}`,
  );

  // Preferences. The measurement toggle was read-only for a while because this
  // endpoint did not exist, which is the kind of gap a UI screenshot hides and
  // a request does not.
  const before = await alice('/api/me');
  check(
    'new accounts default to imperial',
    before.body?.user?.unitPreference === 'imperial',
    `got ${String(before.body?.user?.unitPreference)}`,
  );

  const switched = await alice('/api/me', {
    method: 'PATCH',
    body: JSON.stringify({ unitPreference: 'metric' }),
  });
  check('can switch measurement system', switched.status === 200, `status ${switched.status}`);

  const after = await alice('/api/me');
  check('the switch persists', after.body?.user?.unitPreference === 'metric');

  const nonsense = await alice('/api/me', {
    method: 'PATCH',
    body: JSON.stringify({ unitPreference: 'furlongs' }),
  });
  check('rejects a unit system it does not have', nonsense.status === 400, `status ${nonsense.status}`);

  const escalate = await alice('/api/me', {
    method: 'PATCH',
    body: JSON.stringify({ handle: 'admin', email: 'someone@else.test' }),
  });
  check(
    'cannot change identity through the preferences endpoint',
    escalate.status === 400,
    `status ${escalate.status}`,
  );

  const strangerUpload = await bob(`/api/photos/recipes/${recipe.id}?width=1&height=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: onePixelPng,
  });
  check(
    'stranger cannot attach a photo to a recipe they do not own',
    strangerUpload.status === 404,
    `status ${strangerUpload.status}`,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('smoke test crashed:', error);
  process.exit(1);
});
