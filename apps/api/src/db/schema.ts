import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Drizzle has no first-class bytea, so declare one that maps to Buffer. */
const customBytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Every table that holds user data carries an owner column, because that column
 * is what the row-level security policies key off. A table without one is a
 * table RLS cannot protect — `rls.test.ts` fails the build if one appears.
 */

/**
 * One users table, shared by better-auth and the app.
 *
 * better-auth owns `display_name`, `email`, `email_verified`, `avatar_key` and
 * the timestamps (mapped from its `name` / `image` field names in auth.ts).
 * Everything else is ours. Keeping it as one table avoids the join-on-every-
 * request that a split design forces, and keeps the RLS policies simple.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    handle: text('handle').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    avatarKey: text('avatar_key'),
    theme: text('theme').notNull().default('system'),
    unitPreference: text('unit_preference').notNull().default('metric'),
    invitedBy: uuid('invited_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_handle_key').on(t.handle),
    uniqueIndex('users_email_key').on(t.email),
  ],
);

/**
 * better-auth's own tables.
 *
 * These are deliberately unreachable by the application role. Sessions have to
 * be resolved *before* we know who the caller is, so they cannot sit behind the
 * same app.user_id gate as everything else — which means the honest way to
 * protect them is a separate database role that only the auth handler uses.
 * `potluck_app` is granted nothing on these three tables at all.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sessions_token_key').on(t.token), index('sessions_user_id_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Added in better-auth 1.7; unique with accountId. */
  issuer: text('issuer').notNull(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  /** scrypt hash (better-auth's default) for the credential provider.
   *  Never leaves the database — potluck_app has no privilege on this table. */
  password: text('password'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('accounts_issuer_account_id_key').on(t.issuer, t.accountId),
    index('accounts_user_id_idx').on(t.userId),
  ],
);

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

/**
 * Signup is invite-only. A code is single-use: redeemedBy is set in the same
 * transaction that creates the account, and a partial unique index makes a
 * double redemption impossible even under a race.
 */
export const inviteCodes = pgTable(
  'invite_codes',
  {
    code: text('code').primaryKey(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    redeemedBy: uuid('redeemed_by').references(() => users.id, { onDelete: 'set null' }),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('invite_codes_redeemed_by_key').on(t.redeemedBy)],
);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  isDefault: boolean('is_default').notNull().default(false),
});

export const recipes = pgTable('recipes', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  servings: integer('servings'),
  notes: text('notes').notNull().default(''),
  sourceUrl: text('source_url'),
  sourceType: text('source_type').notNull().default('manual'),

  // Heirloom fields. Optional, and the reason people keep family recipes.
  attributedTo: text('attributed_to').notNull().default(''),
  story: text('story').notNull().default(''),
  yearLearned: integer('year_learned'),

  rating: smallint('rating'),
  isFavorite: boolean('is_favorite').notNull().default(false),

  /**
   * Self-reference. A fork is a copy, not a pointer, so deleting the original
   * leaves forks intact — this records lineage only.
   */
  forkedFromId: uuid('forked_from_id'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ingredients = pgTable('ingredients', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),

  /** Exactly as the source wrote it. Parsing never overwrites this. */
  rawText: text('raw_text').notNull(),
  item: text('item').notNull().default(''),
  note: text('note').notNull().default(''),

  /** Null whenever the measurement could not be understood — "a pinch". */
  qtyCanonical: real('qty_canonical'),
  unitCanonical: text('unit_canonical'),
  dimension: text('dimension').notNull().default('none'),
});

export const steps = pgTable('steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  position: integer('position').notNull().default(0),
  body: text('body').notNull(),
  /** Detected from the body at import time; drives Cooking Mode's timers. */
  durationSeconds: integer('duration_seconds'),
});

/**
 * Photo bytes live in Postgres rather than object storage.
 *
 * Not the textbook choice — but enabling Cloudflare R2 requires a card on file
 * even inside its free allowance, and this project's hard constraint is that no
 * card exists anywhere. Postgres large-object columns are a perfectly good
 * answer at this scale: the client downscales to 1200px WebP before upload, so
 * a photo is 80-150 KB, and Neon's free 0.5 GB holds a few thousand of them
 * alongside the recipe text.
 *
 * `bytes` is deliberately isolated to these two tables so that swapping in S3,
 * R2 or MinIO later means implementing one storage interface, not a migration
 * of the whole schema.
 */
export const recipePhotos = pgTable('recipe_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  bytes: customBytea('bytes').notNull(),
  contentType: text('content_type').notNull().default('image/webp'),
  byteSize: integer('byte_size').notNull(),
  width: integer('width'),
  height: integer('height'),
  isHero: boolean('is_hero').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recipeCategories = pgTable(
  'recipe_categories',
  {
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.categoryId] })],
);

/**
 * Friendship is stored once, not twice, with the pair ordered so that
 * (a,b) and (b,a) cannot both exist. Status is 'pending' or 'accepted'.
 */
export const friendships = pgTable(
  'friendships',
  {
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.requesterId, t.addresseeId] })],
);

export const recipeShares = pgTable(
  'recipe_shares',
  {
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.recipientId] })],
);

/**
 * "I made this" — a photo of how your version actually turned out, attached to
 * someone else's recipe. Note ownerId here is the COOK, not the recipe owner,
 * which is what lets a cook delete their own attempt.
 */
export const attempts = pgTable('attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  bytes: customBytea('bytes').notNull(),
  contentType: text('content_type').notNull().default('image/webp'),
  byteSize: integer('byte_size').notNull(),
  caption: text('caption').notNull().default(''),
  wentWell: boolean('went_well'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A recipe's owner can hide an attempt from their own page without being able
 * to delete someone else's photo. This lives in its own table rather than as a
 * column on `attempts` for a specific reason: RLS grants permission per row,
 * not per column, so a policy letting the recipe owner UPDATE the attempt row
 * would also let them rewrite the cook's caption. Splitting the table keeps
 * both policies simple and honest.
 */
export const attemptHides = pgTable(
  'attempt_hides',
  {
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    /** The recipe owner doing the hiding — this is the RLS key. */
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.ownerId] })],
);

export const shoppingItems = pgTable('shopping_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  item: text('item').notNull(),
  qtyCanonical: real('qty_canonical'),
  unitCanonical: text('unit_canonical'),
  recipeId: uuid('recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
  checked: boolean('checked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The import queue. The worker polls this rather than us running a broker —
 * one fewer moving part on a 1 GB node, and Postgres is already there.
 */
export const importJobs = pgTable('import_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  payload: text('payload').notNull(),
  status: text('status').notNull().default('queued'),
  error: text('error'),
  /** The extracted recipe, held for the review screen until the user saves it. */
  draft: text('draft'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The public recipe catalog.
 *
 * Unlike everything else in this schema there is no owner_id, because nobody
 * owns these — they are a shared library every signed-in user can read and
 * nobody can write through the application. The RLS policy is correspondingly
 * inverted: SELECT is unconditionally true, and there is no INSERT, UPDATE or
 * DELETE policy at all, so the seed pipeline (running as the migration role) is
 * the only thing that can change it.
 *
 * Ingredients and steps are jsonb rather than child tables. They are read as a
 * whole document and never queried by their parts, and one row per recipe keeps
 * a 1,000+ row catalog to a single index scan instead of three joins.
 */
export const catalogRecipes = pgTable(
  'catalog_recipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable, human-readable, and the dedup key for the generator. */
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),

    cuisine: text('cuisine').notNull(),
    mealType: text('meal_type').notNull(),
    mainProtein: text('main_protein').notNull().default(''),
    tags: text('tags').array().notNull().default([]),

    servings: integer('servings').notNull().default(2),
    totalMinutes: integer('total_minutes'),
    difficulty: text('difficulty').notNull().default('easy'),

    /**
     * Per serving, and an ESTIMATE — produced by a language model, not a lab.
     * Surfaced as "about 32 g" in the UI for that reason; good enough to sort
     * and filter by, not good enough to build a diet on.
     */
    proteinGrams: real('protein_grams'),
    calories: integer('calories'),

    ingredients: jsonb('ingredients').notNull().default([]),
    steps: jsonb('steps').notNull().default([]),

    /**
     * The ingredient lines flattened to plain text, purely so the search vector
     * can index them. Postgres forbids subqueries inside a generated column, so
     * reaching into the jsonb from the tsvector expression is not possible —
     * denormalising it here is the honest fix rather than a trigger nobody
     * remembers exists.
     */
    ingredientsText: text('ingredients_text').notNull().default(''),

    /** Same reason as ingredients_text: array_to_string is STABLE, not
     *  IMMUTABLE, so a generated column cannot flatten the tags array itself. */
    tagsText: text('tags_text').notNull().default(''),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('catalog_recipes_slug_key').on(t.slug),
    index('catalog_recipes_meal_type_idx').on(t.mealType),
    index('catalog_recipes_cuisine_idx').on(t.cuisine),
    index('catalog_recipes_protein_idx').on(t.proteinGrams),
  ],
);
