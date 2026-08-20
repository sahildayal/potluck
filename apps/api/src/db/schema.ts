import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Every table that holds user data carries an owner column, because that column
 * is what the row-level security policies key off. A table without one is a
 * table RLS cannot protect — `rls.test.ts` fails the build if one appears.
 */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    handle: text('handle').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email').notNull(),
    avatarKey: text('avatar_key'),
    theme: text('theme').notNull().default('system'),
    unitPreference: text('unit_preference').notNull().default('metric'),
    invitedBy: uuid('invited_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_handle_key').on(t.handle),
    uniqueIndex('users_email_key').on(t.email),
  ],
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

export const recipePhotos = pgTable('recipe_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id')
    .notNull()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  r2Key: text('r2_key').notNull(),
  width: integer('width'),
  height: integer('height'),
  isHero: boolean('is_hero').notNull().default(false),
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
  r2Key: text('r2_key').notNull(),
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
