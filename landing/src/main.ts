import { initTheme } from './theme';
import { initI18n, setLocale } from './i18n';
import type { Locale } from './i18n';

// Theme — sync, no flash
initTheme();

// i18n — async
initI18n();

// Language dropdown
const langToggle = document.getElementById('lang-toggle');
const langMenu = document.getElementById('lang-menu');

langToggle?.addEventListener('click', () => {
  const open = langMenu?.classList.toggle('is-open');
  langToggle.setAttribute('aria-expanded', String(!!open));
});

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('lang-dropdown');
  if (dropdown && !dropdown.contains(e.target as Node)) {
    langMenu?.classList.remove('is-open');
    langToggle?.setAttribute('aria-expanded', 'false');
  }
});

langMenu?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-lang]');
  if (!btn) return;
  setLocale(btn.getAttribute('data-lang') as Locale);
  langMenu.classList.remove('is-open');
  langToggle?.setAttribute('aria-expanded', 'false');
});

// Mobile menu
const mobileToggle = document.getElementById('mobile-toggle');
const mobileMenu = document.getElementById('mobile-menu');

mobileToggle?.addEventListener('click', () => {
  mobileMenu?.classList.toggle('is-open');
});

mobileMenu?.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).tagName === 'A') {
    mobileMenu.classList.remove('is-open');
  }
});
