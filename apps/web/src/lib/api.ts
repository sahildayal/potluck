import type { Recipe } from '@potluck/core';

/**
 * The API client.
 *
 * Everything goes through one function so credentials, error shape and JSON
 * handling are decided once. `credentials: 'include'` is non-negotiable — the
 * session lives in an httpOnly cookie, which is what keeps a token out of
 * localStorage where any script on the page could read it.
 */

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
  const response = await fetch(path, {
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
  ownerId: string;
  title: string;
  servings: number | null;
  rating: number | null;
  isFavorite: boolean;
  sourceType: string;
  attributedTo: string;
  updatedAt: string;
}

export interface RecipeDetail extends Recipe {
  id: string;
  ownerId: string;
  photos: { id: string; url: string; isHero: boolean }[];
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
