// Тема: dark/light/auto. data-theme на <html>, предпочтение в localStorage. (house standard)
const THEME_STORAGE_KEY = 'mailbot_theme';

export type Theme = 'dark' | 'light';
export type ThemePreference = Theme | 'auto';

export function getTheme(): Theme {
  const explicit = document.documentElement.dataset.theme as Theme | undefined;
  if (explicit === 'dark' || explicit === 'light') return explicit;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null;
    if (stored === 'dark' || stored === 'light' || stored === 'auto') return stored;
  } catch { /* blocked */ }
  return 'auto';
}

export function setTheme(theme: Theme | null): void {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

export function setThemePreference(pref: ThemePreference): void {
  try { localStorage.setItem(THEME_STORAGE_KEY, pref); } catch { /* blocked */ }
  setTheme(pref === 'auto' ? null : pref);
}

export function toggleTheme(): void {
  setThemePreference(getTheme() === 'dark' ? 'light' : 'dark');
}

export function initTheme(): void {
  const pref = getThemePreference();
  setTheme(pref === 'auto' ? null : pref);
}
