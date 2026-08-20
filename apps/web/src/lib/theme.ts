export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'potluck.theme';

/**
 * Theme is applied by stamping the root element, and only for an explicit
 * choice. Leaving the attribute off for "system" is what lets the CSS fall
 * through to prefers-color-scheme instead of freezing whatever the OS was set
 * to when the app first loaded.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function readStoredTheme(): ThemeChoice {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function storeTheme(choice: ThemeChoice): void {
  localStorage.setItem(STORAGE_KEY, choice);
  applyTheme(choice);
}
