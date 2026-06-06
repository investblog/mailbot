const STORAGE_KEY = 'fw-theme';
type Theme = 'dark' | 'light';

function getPreferred(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (saved === 'dark' || saved === 'light') return saved;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);

  // Toggle icon visibility
  const iconLight = document.getElementById('theme-icon-light');
  const iconDark = document.getElementById('theme-icon-dark');
  if (iconLight && iconDark) {
    iconLight.hidden = theme === 'dark';
    iconDark.hidden = theme === 'light';
  }
}

export function initTheme(): void {
  apply(getPreferred());

  const btn = document.getElementById('theme-toggle');
  btn?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') as Theme;
    apply(current === 'dark' ? 'light' : 'dark');
  });
}
