export type Locale = 'en' | 'ru';

export type TranslationMap = Record<string, string>;

const STORAGE_KEY = 'gem-locale';
const SUPPORTED: Locale[] = ['en', 'ru'];

let current: Locale = 'en';
let strings: TranslationMap = {};

const modules: Record<Locale, () => Promise<{ default: TranslationMap }>> = {
  en: () => import('./translations/en'),
  ru: () => import('./translations/ru'),
};

function detectLocale(): Locale {
  // 1. URL slug has highest priority (/ru/)
  const pathLang = location.pathname.split('/')[1] as Locale;
  if (pathLang && SUPPORTED.includes(pathLang)) return pathLang;

  // 2. localStorage
  const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
  if (saved && SUPPORTED.includes(saved)) return saved;

  // 3. Browser language
  const nav = navigator.language.toLowerCase();
  for (const loc of SUPPORTED) {
    if (nav === loc || nav.startsWith(loc + '-')) return loc;
  }
  return 'en';
}

export function getLocale(): Locale {
  return current;
}

export async function setLocale(locale: Locale): Promise<void> {
  const mod = await modules[locale]();
  strings = mod.default;
  current = locale;
  localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale;
  applyTranslations();
}

const VARS: Record<string, () => string> = {
  year: () => new Date().getFullYear().toString(),
};

export function t(key: string): string {
  let val = strings[key] || key;
  val = val.replace(/\{(\w+)\}/g, (_, name: string) => VARS[name]?.() ?? `{${name}}`);
  return val;
}

export function applyTranslations(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')!;
    const val = t(key);
    if (val !== key) el.textContent = val;
  });

  // innerHTML variant (for strings with inline markup, e.g. <b>, <br>)
  document.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    const key = el.getAttribute('data-i18n-html')!;
    const val = t(key);
    if (val !== key) el.innerHTML = val;
  });

  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria')!;
    const val = t(key);
    if (val !== key) el.setAttribute('aria-label', val);
  });

  // Locale-specific internal links (/path → /ru/path)
  document.querySelectorAll<HTMLAnchorElement>('[data-locale-link]').forEach((el) => {
    const path = el.getAttribute('data-locale-link')!;
    el.href = current === 'en' ? `/${path}` : `/${current}/${path}`;
  });

  document.querySelectorAll<HTMLElement>('[data-lang]').forEach((el) => {
    el.classList.toggle('is-active', el.getAttribute('data-lang') === current);
  });

  const langLabel = document.querySelector<HTMLElement>('[data-lang-label]');
  if (langLabel) langLabel.textContent = current.toUpperCase();
}

export async function initI18n(): Promise<void> {
  await setLocale(detectLocale());
}
