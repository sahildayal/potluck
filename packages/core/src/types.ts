import { z } from 'zod';

/**
 * The shared contract between the API and every client. The API validates
 * against these on the way in and the web app derives its TypeScript types from
 * them, so a field can't drift on one side without the other failing to build.
 */

export const unitSystem = z.enum(['metric', 'imperial']);
export const dimension = z.enum(['mass', 'volume', 'count', 'none']);

export const sourceType = z.enum(['manual', 'website', 'photo', 'screenshot', 'video', 'fork']);

export const ingredientSchema = z.object({
  id: z.string().uuid().optional(),
  /** Derived from array order by the server. Accepted but never required —
   *  a client-supplied index that disagrees with the order is a bug waiting
   *  to happen, so order is the single source of truth. */
  position: z.number().int().min(0).optional(),
  /** Exactly as the source wrote it. Never overwritten by parsing. */
  rawText: z.string().min(1).max(300),
  item: z.string().max(200).default(''),
  note: z.string().max(300).default(''),
  qtyCanonical: z.number().nullable().default(null),
  unitCanonical: z.enum(['g', 'ml', 'count']).nullable().default(null),
  dimension: dimension.default('none'),
});

export const stepSchema = z.object({
  id: z.string().uuid().optional(),
  /** Derived from array order by the server, as with ingredients. */
  position: z.number().int().min(0).optional(),
  body: z.string().min(1).max(4000),
  /** Detected from the body at import time; null when no timer applies. */
  durationSeconds: z.number().int().positive().nullable().default(null),
});

export const recipeSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  servings: z.number().int().positive().max(100).nullable().default(null),
  notes: z.string().max(4000).default(''),
  sourceUrl: z.string().url().nullable().default(null),
  sourceType: sourceType.default('manual'),

  // Heirloom fields — all optional, all free text.
  attributedTo: z.string().max(120).default(''),
  story: z.string().max(2000).default(''),
  yearLearned: z.number().int().min(1900).max(2100).nullable().default(null),

  rating: z.number().int().min(1).max(5).nullable().default(null),
  isFavorite: z.boolean().default(false),
  forkedFromId: z.string().uuid().nullable().default(null),

  categoryIds: z.array(z.string().uuid()).default([]),
  ingredients: z.array(ingredientSchema).default([]),
  steps: z.array(stepSchema).default([]),
});

export const createRecipeSchema = recipeSchema.omit({ id: true });
export const updateRecipeSchema = createRecipeSchema.partial();

export const categorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(60),
  position: z.number().int().min(0),
  isDefault: z.boolean().default(false),
});

/** Seeded for every new account, in this order, per the requirements doc. */
export const DEFAULT_CATEGORIES = ['Main Entree', 'Breakfast', 'Dessert', 'Side', 'Snack'] as const;

export const importKind = z.enum(['url', 'image', 'text']);
export const importStatus = z.enum(['queued', 'reading', 'ready', 'failed']);

export const createImportSchema = z.object({
  kind: importKind,
  /** A URL for kind=url, an R2 object key for kind=image, raw text for kind=text. */
  payload: z.string().min(1).max(10_000),
});

export const attemptSchema = z.object({
  id: z.string().uuid().optional(),
  recipeId: z.string().uuid(),
  caption: z.string().max(500).default(''),
  wentWell: z.boolean().nullable().default(null),
  photoKey: z.string().max(200),
});

export const shoppingItemSchema = z.object({
  id: z.string().uuid().optional(),
  item: z.string().min(1).max(200),
  qtyCanonical: z.number().nullable().default(null),
  unitCanonical: z.enum(['g', 'ml', 'count']).nullable().default(null),
  recipeId: z.string().uuid().nullable().default(null),
  checked: z.boolean().default(false),
});

export type UnitSystemT = z.infer<typeof unitSystem>;
export type Ingredient = z.infer<typeof ingredientSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type CreateRecipe = z.infer<typeof createRecipeSchema>;
export type Category = z.infer<typeof categorySchema>;
export type CreateImport = z.infer<typeof createImportSchema>;
export type ImportStatus = z.infer<typeof importStatus>;
export type Attempt = z.infer<typeof attemptSchema>;
export type ShoppingItem = z.infer<typeof shoppingItemSchema>;
