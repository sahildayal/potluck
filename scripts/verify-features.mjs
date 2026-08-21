#!/usr/bin/env node
/**
 * End-to-end check of the social, import and category features.
 *
 * Drives three real accounts through the API the way the app does, because these
 * features are mostly about what one account can and cannot see of another's —
 * which is exactly the thing a single-user test cannot catch. The third account
 * is not padding: two accounts can only show that sharing works, never that it
 * stays contained, and a bystander seeing nothing is the actual guarantee.
 *
 * Usage: node scripts/verify-features.mjs [base] [origin]
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

function client() {
  let cookie = '';
  return async (path, init = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: origin,
        ...init.headers,
      },
      redirect: 'manual',
    });
    const set = response.headers.getSetCookie?.() ?? [];
    if (set.length > 0) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  };
}

const signUp = (c, handle, suffix) =>
  c('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({
      email: `${handle}-${suffix}@verify.test`,
      password: 'a-really-long-password',
      name: handle[0].toUpperCase() + handle.slice(1),
      handle: `${handle}${suffix}`,
    }),
  });

/** A tiny but genuinely valid 2x2 WebP, so the photo path is exercised. */
const TINY_WEBP = Buffer.from(
  'UklGRjIAAABXRUJQVlA4ICYAAACyAgCdASoCAAIALmk0mk0iIiIiIgBoSygABc6zbAAA/vuUAAA=',
  'base64',
);

async function main() {
  console.log(`feature verification against ${base}\n`);
  const suffix = Date.now().toString().slice(-8);

  const alice = client();
  const bob = client();
  const carol = client();

  const a = await signUp(alice, 'alice', suffix);
  const b = await signUp(bob, 'bob', suffix);
  await signUp(carol, 'carol', suffix);
  check('two accounts created', a.status === 200 && b.status === 200);

  const aliceHandle = `alice${suffix}`;
  const bobHandle = `bob${suffix}`;
  const carolHandle = `carol${suffix}`;

  // ---------------------------------------------------------------- categories
  const cats = await alice('/api/categories');
  const dessert = cats.body.categories.find((c) => c.name === 'Dessert');
  check('default categories present', cats.body.categories.length === 5);

  const made = await alice('/api/recipes', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Verification Kheer',
      servings: 4,
      categoryIds: [dessert.id],
      ingredients: [{ rawText: '1 cup basmati rice' }, { rawText: 'salt to taste' }],
      steps: [{ body: 'Simmer 25 minutes until thick.' }],
    }),
  });
  check('recipe created with a category', made.status === 201);
  const recipeId = made.body.recipe.id;

  const listed = await alice('/api/recipes');
  const row = listed.body.recipes.find((r) => r.id === recipeId);
  check(
    'list returns category ids so the chips can filter',
    Array.isArray(row?.categoryIds) && row.categoryIds.includes(dessert.id),
    JSON.stringify(row?.categoryIds),
  );

  // -------------------------------------------------------------------- friends
  const notFound = await alice('/api/social/friends', {
    method: 'POST',
    body: JSON.stringify({ handle: 'definitely-not-a-real-handle' }),
  });
  check('unknown handle is rejected', notFound.status === 404);

  const request = await alice('/api/social/friends', {
    method: 'POST',
    body: JSON.stringify({ handle: bobHandle }),
  });
  check('friend request sent', request.body?.status === 'pending', JSON.stringify(request.body));

  const bobFriends = await bob('/api/social/friends');
  check(
    'request shows as incoming for the other person',
    bobFriends.body.friends.some((f) => f.handle === aliceHandle && f.direction === 'incoming'),
  );

  const accepted = await bob(`/api/social/friends/${aliceHandle}/accept`, {
    method: 'POST',
    body: '{}',
  });
  check('friendship accepted', accepted.body?.status === 'accepted');

  // Only the addressee may accept — the requester accepting their own request
  // must change nothing. RLS enforces this, not the handler.
  const selfAccept = await alice(`/api/social/friends/${bobHandle}/accept`, {
    method: 'POST',
    body: '{}',
  });
  check('requester cannot accept their own request', selfAccept.status === 404);

  // --------------------------------------------------------------------- shares
  const beforeShare = await bob(`/api/recipes/${recipeId}`);
  check('friend cannot see an unshared recipe', beforeShare.status === 404);

  const shared = await alice('/api/social/shares', {
    method: 'POST',
    body: JSON.stringify({ recipeId, handle: bobHandle }),
  });
  check('recipe shared', shared.status === 201);

  const afterShare = await bob(`/api/recipes/${recipeId}`);
  check('friend can now read it', afterShare.status === 200);

  const inbox = await bob('/api/social/shared-with-me');
  check(
    'it appears in shared-with-me',
    inbox.body.recipes.some((r) => r.id === recipeId && r.ownerHandle === aliceHandle),
  );

  // Sharing grants reading, never writing.
  const edit = await bob(`/api/recipes/${recipeId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Bob was here' }),
  });
  const stillMine = await alice(`/api/recipes/${recipeId}`);
  check(
    'sharing does not grant edit rights',
    stillMine.body.recipe.title === 'Verification Kheer',
    `edit returned ${edit.status}, title is now "${stillMine.body.recipe.title}"`,
  );

  const stranger = await carol(`/api/recipes/${recipeId}`);
  check('a third party still cannot see it', stranger.status === 404);

  // Forging a share of someone else's recipe must be refused.
  const forged = await bob('/api/social/shares', {
    method: 'POST',
    body: JSON.stringify({ recipeId, handle: carolHandle }),
  });
  check('cannot share a recipe you do not own', forged.status === 404);

  // ------------------------------------------------------------------- attempts
  const post = await bob(`/api/social/recipes/${recipeId}/attempts`, {
    method: 'POST',
    body: TINY_WEBP,
    headers: { 'X-Photo-Type': 'image/webp', 'X-Caption': 'mine collapsed', 'X-Went-Well': 'false' },
  });
  check('friend can post an attempt', post.status === 201, `status ${post.status}`);

  const wall = await alice(`/api/social/recipes/${recipeId}/attempts`);
  check('the owner sees it', wall.body.attempts.length === 1);
  check('caption is attributed to the cook', wall.body.attempts[0]?.cookHandle === bobHandle);

  const carolPost = await carol(`/api/social/recipes/${recipeId}/attempts`, {
    method: 'POST',
    body: TINY_WEBP,
    headers: { 'X-Photo-Type': 'image/webp', 'X-Caption': 'nope' },
  });
  check('someone without access cannot post an attempt', carolPost.status === 404);

  const attemptId = wall.body.attempts[0].id;
  const hidden = await alice(`/api/social/attempts/${attemptId}/hide`, {
    method: 'POST',
    body: '{}',
  });
  check('recipe owner can hide an attempt', hidden.status === 200);

  const ownerDelete = await alice(`/api/social/attempts/${attemptId}`, { method: 'DELETE' });
  check(
    'recipe owner cannot delete the cook\'s photo',
    ownerDelete.status === 404,
    `status ${ownerDelete.status}`,
  );

  // -------------------------------------------------------------------- imports
  const job = await alice('/api/imports', {
    method: 'POST',
    body: JSON.stringify({ kind: 'url', payload: 'https://www.instagram.com/p/abc123/' }),
  });
  check('import job queued', job.status === 202);

  // Walled platforms should fail fast with an honest message rather than
  // retrying three times against something that will never work.
  let walled = null;
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 800));
    const state = await alice(`/api/imports/${job.body.job.id}`);
    if (state.body.job.status === 'failed' || state.body.job.status === 'ready') {
      walled = state.body.job;
      break;
    }
  }
  check(
    'walled platform fails with a useful message',
    walled?.status === 'failed' && /screenshot/i.test(walled.error ?? ''),
    walled?.error ?? 'never resolved',
  );

  const realImport = await alice('/api/imports', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'url',
      payload: 'https://www.allrecipes.com/recipe/223042/chicken-parmesan/',
    }),
  });
  let ready = null;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const state = await alice(`/api/imports/${realImport.body.job.id}`);
    if (state.body.job.status === 'ready' || state.body.job.status === 'failed') {
      ready = state.body.job;
      break;
    }
  }
  check(
    'a real recipe site imports via metadata, no AI',
    ready?.status === 'ready' && ready.draft?.via === 'metadata',
    `${ready?.status} ${ready?.error ?? ''}`,
  );
  check(
    'the draft has real ingredients',
    (ready?.draft?.ingredients?.length ?? 0) >= 5,
    `${ready?.draft?.ingredients?.length} ingredients`,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('verification crashed:', error);
  process.exit(1);
});
