import type { Recipe } from '@potluck/core';

/**
 * The API client.
 *
 * Everything goes through one function so credentials, error shape and JSON
 * handling are decided once. `credentials: 'include'` is non-negotiable — the
 * session lives in an httpOnly cookie, which is what keeps a token out of
 * localStorage where any script on the page could read it.
 */

/**
 * In development the Vite proxy makes /api same-origin, so this is empty and
 * requests stay relative. In production the API lives on its own host, so every
 * request needs an absolute URL — and, because that makes the session cookie
 * cross-site, the API must set SameSite=None; Secure to match.
 */
const API_BASE = (import.meta.env['VITE_API_URL'] ?? '').replace(/\/$/, '');

/** Prefixes a server-relative media path with the API host. */
export function mediaUrl(path: string): string {
  return path.startsWith('http') ? path : `${API_BASE}${path}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body !== undefined && !(init.body instanceof Blob)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text.length > 0 ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : typeof payload === 'object' && payload !== null && 'message' in payload
          ? String((payload as { message: unknown }).message)
          : 'Something went wrong';
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  handle: string;
  theme: string;
  unitPreference: 'metric' | 'imperial';
  image: string | null;
}

export interface RecipeSummary {
  id: string;
  categoryIds: string[];
  ownerId: string;
  title: string;
  servings: number | null;
  rating: number | null;
  isFavorite: boolean;
  sourceType: string;
  attributedTo: string;
  updatedAt: string;
  heroPhotoId: string | null;
}

export interface RecipeDetail extends Recipe {
  id: string;
  ownerId: string;
  photos: PhotoSummary[];
}

export interface PhotoSummary {
  id: string;
  url: string;
  isHero: boolean;
  width: number | null;
  height: number | null;
  byteSize: number;
}

export interface Category {
  id: string;
  name: string;
  position: number;
  isDefault: boolean;
}

export interface ShoppingItem {
  id: string;
  item: string;
  qtyCanonical: number | null;
  unitCanonical: 'g' | 'ml' | 'count' | null;
  recipeId: string | null;
  checked: boolean;
}

export interface CatalogSummary {
  id: string;
  slug: string;
  title: string;
  summary: string;
  cuisine: string;
  mealType: string;
  mainProtein: string;
  tags: string[];
  servings: number;
  totalMinutes: number | null;
  difficulty: string;
  proteinGrams: number | null;
  calories: number | null;
}

export interface CatalogDetail extends CatalogSummary {
  ingredients: { rawText: string }[];
  steps: { body: string; durationSeconds: number | null }[];
}

export interface CatalogFacets {
  cuisines: { value: string; count: number }[];
  meals: { value: string; count: number }[];
  total: number;
}

export interface BrowseParams {
  q?: string;
  meal?: string;
  cuisine?: string;
  minProtein?: number;
  sort?: 'relevance' | 'protein' | 'quick' | 'newest';
  limit?: number;
  offset?: number;
}

export interface ImportJob {
  id: string;
  kind: 'url' | 'image' | 'text';
  status: 'queued' | 'reading' | 'ready' | 'failed';
  error: string | null;
  draft: RecipeDraft | null;
}

export interface RecipeDraft {
  title: string;
  servings: number | null;
  ingredients: { rawText: string }[];
  steps: { body: string }[];
  notes?: string;
  via?: string;
}

export interface Friend {
  id: string;
  handle: string;
  displayName: string;
  status: 'pending' | 'accepted';
  direction: 'incoming' | 'outgoing';
}

export interface SharedRecipe {
  id: string;
  title: string;
  servings: number | null;
  attributedTo: string;
  ownerHandle: string;
  ownerName: string;
}

export interface AttemptEntry {
  id: string;
  caption: string;
  wentWell: boolean | null;
  createdAt: string;
  cookId: string;
  cookHandle: string;
  cookName: string;
  hidden: boolean;
  url: string;
}

export const api = {
  me: () => request<{ user: SessionUser | null }>('/api/me'),

  signUp: (input: { email: string; password: string; name: string; handle: string }) =>
    request<{ user: SessionUser }>('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  signIn: (input: { email: string; password: string }) =>
    request<{ user: SessionUser }>('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  signOut: () => request<unknown>('/api/auth/sign-out', { method: 'POST', body: '{}' }),

  recipes: {
    list: () => request<{ recipes: RecipeSummary[] }>('/api/recipes'),
    get: (id: string) => request<{ recipe: RecipeDetail }>(`/api/recipes/${id}`),
    create: (input: unknown) =>
      request<{ recipe: RecipeDetail }>('/api/recipes', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    update: (id: string, input: unknown) =>
      request<{ recipe: RecipeDetail }>(`/api/recipes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    remove: (id: string) => request<unknown>(`/api/recipes/${id}`, { method: 'DELETE' }),
    setFavorite: (id: string, isFavorite: boolean) =>
      request<{ id: string; isFavorite: boolean }>(`/api/recipes/${id}/favorite`, {
        method: 'POST',
        body: JSON.stringify({ isFavorite }),
      }),
    setRating: (id: string, rating: number | null) =>
      request<{ id: string; rating: number | null }>(`/api/recipes/${id}/rating`, {
        method: 'POST',
        body: JSON.stringify({ rating }),
      }),
    fork: (id: string) =>
      request<{ recipe: RecipeDetail }>(`/api/recipes/${id}/fork`, { method: 'POST' }),
  },

  photos: {
    // The body is the already-downscaled blob; width/height ride as query
    // params because the body slot is taken. Content-Type is set by the
    // browser from blob.type, which is exactly the header the server checks.
    upload: (recipeId: string, blob: Blob, width: number, height: number) =>
      request<{ id: string; url: string; isHero: boolean }>(
        `/api/photos/recipes/${recipeId}?width=${width}&height=${height}`,
        { method: 'POST', body: blob },
      ),
    setHero: (id: string) =>
      request<{ id: string; isHero: boolean }>(`/api/photos/${id}/hero`, {
        method: 'POST',
        body: '{}',
      }),
    remove: (id: string) => request<unknown>(`/api/photos/${id}`, { method: 'DELETE' }),
  },

  catalog: {
    facets: () => request<CatalogFacets>('/api/catalog/facets'),
    browse: (params: BrowseParams) => {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '' && value !== null) search.set(key, String(value));
      }
      const qs = search.toString();
      return request<{ recipes: CatalogSummary[]; total: number; limit: number; offset: number }>(
        `/api/catalog${qs.length > 0 ? `?${qs}` : ''}`,
      );
    },
    get: (slug: string) => request<{ recipe: CatalogDetail }>(`/api/catalog/${slug}`),
    save: (slug: string) =>
      request<{ recipe: { id: string; title: string } }>(`/api/catalog/${slug}/save`, {
        method: 'POST',
        body: '{}',
      }),
  },

  imports: {
    list: () => request<{ jobs: ImportJob[] }>('/api/imports'),
    create: (kind: 'url' | 'image' | 'text', payload: string) =>
      request<{ job: { id: string; status: string } }>('/api/imports', {
        method: 'POST',
        body: JSON.stringify({ kind, payload }),
      }),
    get: (id: string) => request<{ job: ImportJob }>(`/api/imports/${id}`),
    confirm: (id: string, recipe: unknown) =>
      request<{ recipe: { id: string; title: string } }>(`/api/imports/${id}/confirm`, {
        method: 'POST',
        body: JSON.stringify(recipe),
      }),
    discard: (id: string) => request<unknown>(`/api/imports/${id}`, { method: 'DELETE' }),
  },

  social: {
    findUser: (handle: string) =>
      request<{ user: { id: string; handle: string; displayName: string }; known: boolean }>(
        `/api/social/users/${encodeURIComponent(handle)}`,
      ),
    friends: () => request<{ friends: Friend[] }>('/api/social/friends'),
    addFriend: (handle: string) =>
      request<{ status: string }>('/api/social/friends', {
        method: 'POST',
        body: JSON.stringify({ handle }),
      }),
    acceptFriend: (handle: string) =>
      request<{ status: string }>(`/api/social/friends/${encodeURIComponent(handle)}/accept`, {
        method: 'POST',
        body: '{}',
      }),
    removeFriend: (handle: string) =>
      request<unknown>(`/api/social/friends/${encodeURIComponent(handle)}`, { method: 'DELETE' }),

    sharedWithMe: () => request<{ recipes: SharedRecipe[] }>('/api/social/shared-with-me'),
    share: (recipeId: string, handle: string) =>
      request<{ shared: boolean }>('/api/social/shares', {
        method: 'POST',
        body: JSON.stringify({ recipeId, handle }),
      }),

    attempts: (recipeId: string) =>
      request<{ attempts: AttemptEntry[] }>(`/api/social/recipes/${recipeId}/attempts`),
    postAttempt: (recipeId: string, blob: Blob, caption: string, wentWell: boolean | null) =>
      request<{ id: string; url: string }>(`/api/social/recipes/${recipeId}/attempts`, {
        method: 'POST',
        body: blob,
        headers: {
          'X-Photo-Type': blob.type,
          'X-Caption': caption,
          'X-Went-Well': wentWell === null ? '' : String(wentWell),
        },
      }),
    deleteAttempt: (id: string) =>
      request<unknown>(`/api/social/attempts/${id}`, { method: 'DELETE' }),
    hideAttempt: (id: string) =>
      request<{ hidden: boolean }>(`/api/social/attempts/${id}/hide`, {
        method: 'POST',
        body: '{}',
      }),
  },

  shopping: {
    list: () => request<{ items: ShoppingItem[] }>('/api/shopping'),
    add: (item: string) =>
      request<{ item: ShoppingItem }>('/api/shopping', {
        method: 'POST',
        body: JSON.stringify({ item }),
      }),
    fromRecipe: (recipeId: string) =>
      request<{ items: ShoppingItem[] }>(`/api/shopping/from-recipe/${recipeId}`, {
        method: 'POST',
        body: '{}',
      }),
    check: (id: string, checked: boolean) =>
      request<{ item: ShoppingItem }>(`/api/shopping/${id}/check`, {
        method: 'POST',
        body: JSON.stringify({ checked }),
      }),
    remove: (id: string) => request<unknown>(`/api/shopping/${id}`, { method: 'DELETE' }),
    clearChecked: () =>
      request<{ cleared: number }>('/api/shopping/clear-checked', {
        method: 'POST',
        body: '{}',
      }),
  },

  categories: {
    list: () => request<{ categories: Category[] }>('/api/categories'),
    create: (name: string) =>
      request<{ category: Category }>('/api/categories', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    rename: (id: string, name: string) =>
      request<{ category: Category }>(`/api/categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    reorder: (ids: string[]) =>
      request<{ categories: Category[] }>('/api/categories/reorder', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    remove: (id: string) => request<unknown>(`/api/categories/${id}`, { method: 'DELETE' }),
  },
};
