// scripts/build-i18n.mjs
// Pre-renders locale-specific HTML pages for SEO + generates sitemap.xml
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const TRANS_DIR = path.join(ROOT, 'src', 'translations');

const DEFAULT_DOMAIN = 'https://mailbot.click';
const LOCALE_DOMAINS = { ru: 'https://emailbot.ru' };
const LOCALES = ['en', 'ru'];
const RTL = [];
const DEFAULT_LOCALE = 'en';

const OG_LOCALE_MAP = {
  en: 'en_US', ru: 'ru_RU',
};

/** Pages to pre-render: [sourceFile, outputSubdir, metaTitleKey, metaDescKey] */
const PAGES = [
  ['index.html', '', 'meta.title', 'meta.description'],
];

const VARS = {
  year: () => new Date().getFullYear().toString(),
};

function interpolate(val) {
  return val.replace(/\{(\w+)\}/g, (_, name) => VARS[name]?.() ?? `{${name}}`);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function loadTranslations(locale) {
  const file = path.join(TRANS_DIR, `${locale}.ts`);
  const content = fs.readFileSync(file, 'utf8');
  const eqBrace = content.indexOf('= {');
  if (eqBrace === -1) throw new Error(`Cannot parse ${file}`);
  const start = eqBrace + 2;
  const end = content.lastIndexOf('}');
  const objStr = content.slice(start, end + 1);
  return new Function(`return ${objStr}`)();
}

function localeUrl(locale, pathSuffix = '') {
  if (LOCALE_DOMAINS[locale]) {
    const domain = LOCALE_DOMAINS[locale];
    return pathSuffix ? `${domain}/${pathSuffix}/` : `${domain}/`;
  }
  const base = locale === DEFAULT_LOCALE ? `${DEFAULT_DOMAIN}/` : `${DEFAULT_DOMAIN}/${locale}/`;
  return pathSuffix ? `${base}${pathSuffix}/` : base;
}

function buildHreflangTags(pathSuffix = '') {
  const tags = LOCALES.map(loc =>
    `<link rel="alternate" hreflang="${loc}" href="${localeUrl(loc, pathSuffix)}">`
  );
  tags.push(`<link rel="alternate" hreflang="x-default" href="${DEFAULT_DOMAIN}/${pathSuffix ? pathSuffix + '/' : ''}">`);
  return tags.join('\n  ');
}

// --- Transform passes ---

function applyDataI18n(html, strings) {
  return html.replace(
    /(<[^>]+\bdata-i18n="([^"]+)"[^>]*>)([^<]*)/g,
    (match, tag, key, text) => {
      const val = strings[key] ? interpolate(strings[key]) : text;
      return `${tag}${val}`;
    }
  );
}

function applyDataI18nHtml(html, strings) {
  // Replace innerHTML of elements with data-i18n-html="key"
  // Matches: <tag data-i18n-html="key">...any content...</tag>
  return html.replace(
    /(<([a-z]\w*)\b[^>]*\bdata-i18n-html="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/gi,
    (match, openTag, tagName, key, content, closeTag) => {
      const val = strings[key] ? interpolate(strings[key]) : content;
      return `${openTag}${val}${closeTag}`;
    }
  );
}

function applyDataI18nPlaceholder(html, strings) {
  return html.replace(
    /<([^>]*)\bdata-i18n-placeholder="([^"]+)"([^>]*)>/g,
    (match, before, key, after) => {
      const val = strings[key] ? interpolate(strings[key]) : null;
      if (!val) return match;
      const full = `${before}data-i18n-placeholder="${key}"${after}`;
      const updated = full.replace(/placeholder="[^"]*"/, `placeholder="${escapeHtml(val)}"`);
      return `<${updated}>`;
    }
  );
}

function applyDataI18nAria(html, strings) {
  return html.replace(
    /<([^>]*)\bdata-i18n-aria="([^"]+)"([^>]*)>/g,
    (match, before, key, after) => {
      const val = strings[key] ? interpolate(strings[key]) : null;
      if (!val) return match;
      const full = `${before}data-i18n-aria="${key}"${after}`;
      const updated = full.replace(/aria-label="[^"]*"/, `aria-label="${escapeHtml(val)}"`);
      return `<${updated}>`;
    }
  );
}

function applyDataI18nHref(html, strings) {
  return html.replace(
    /<([^>]*)\bdata-i18n-href="([^"]+)"([^>]*)>/g,
    (match, before, key, after) => {
      const val = strings[key] ? interpolate(strings[key]) : null;
      if (!val) return match;
      const full = `${before}data-i18n-href="${key}"${after}`;
      const updated = full.replace(/href="[^"]*"/, `href="${escapeHtml(val)}"`);
      return `<${updated}>`;
    }
  );
}

function applyMeta(html, strings, locale, titleKey = 'meta.title', descKey = 'meta.description', pathSuffix = '') {
  const title = strings[titleKey] ? interpolate(strings[titleKey]) : null;
  const desc = strings[descKey] ? interpolate(strings[descKey]) : null;
  const url = localeUrl(locale, pathSuffix);

  if (title) {
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
    html = html.replace(
      /(<meta\s+property="og:title"\s+content=")[^"]*"/,
      `$1${escapeHtml(title)}"`
    );
  }

  if (desc) {
    html = html.replace(
      /(<meta\s+name="description"\s+content=")[^"]*"/,
      `$1${escapeHtml(desc)}"`
    );
    html = html.replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*"/,
      `$1${escapeHtml(desc)}"`
    );
  }

  // og:url
  html = html.replace(
    /(<meta\s+property="og:url"\s+content=")[^"]*"/,
    `$1${url}"`
  );

  // og:locale
  const ogLocale = OG_LOCALE_MAP[locale] || locale;
  if (html.includes('property="og:locale"')) {
    html = html.replace(
      /(<meta\s+property="og:locale"\s+content=")[^"]*"/,
      `$1${ogLocale}"`
    );
  } else {
    html = html.replace(
      /(<meta\s+property="og:type"\s+content="[^"]*">)/,
      `$1\n  <meta property="og:locale" content="${ogLocale}">`
    );
  }

  // JSON-LD url (only present on index.html)
  html = html.replace(
    /("url"\s*:\s*)"[^"]*"/,
    `$1"${url}"`
  );

  // html lang & dir
  if (RTL.includes(locale)) {
    html = html.replace(/<html\s+lang="[^"]*"/, `<html lang="${locale}" dir="rtl"`);
  } else {
    html = html.replace(/<html\s+lang="[^"]*"/, `<html lang="${locale}"`);
  }

  return html;
}

function addHeadTags(html, locale, pathSuffix = '') {
  const url = localeUrl(locale, pathSuffix);
  const canonical = `<link rel="canonical" href="${url}">`;
  const hreflang = buildHreflangTags(pathSuffix);
  return html.replace('</head>', `  ${canonical}\n  ${hreflang}\n</head>`);
}

// --- Sitemap ---

function generateSitemap() {
  const lastmod = new Date().toISOString().split('T')[0];

  function urlEntry(pathSuffix = '') {
    return LOCALES.map(loc => {
      const url = localeUrl(loc, pathSuffix);
      const xhtml = LOCALES.map(alt =>
        `    <xhtml:link rel="alternate" hreflang="${alt}" href="${localeUrl(alt, pathSuffix)}"/>`
      );
      xhtml.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${DEFAULT_DOMAIN}/${pathSuffix ? pathSuffix + '/' : ''}"/>`);
      return `  <url>\n    <loc>${url}</loc>\n    <lastmod>${lastmod}</lastmod>\n${xhtml.join('\n')}\n  </url>`;
    });
  }

  const allEntries = PAGES.flatMap(([, sub]) => urlEntry(sub));

  return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${allEntries.join('\n')}
</urlset>`;
}

// --- Inline CSS ---

function inlineCSS(html) {
  return html.replace(
    /<link\s+rel="stylesheet"\s+href="\/css\/([^"]+)">/g,
    (match, filename) => {
      const cssPath = path.join(PUBLIC, 'css', filename);
      if (!fs.existsSync(cssPath)) return match;
      const css = fs.readFileSync(cssPath, 'utf8');
      return `<style>/* ${filename} */\n${css}</style>`;
    }
  );
}

// --- Build ---

function processPage(srcFile, outputSubdir, titleKey, descKey, translations) {
  const srcPath = path.join(PUBLIC, srcFile);
  if (!fs.existsSync(srcPath)) return;

  const srcHtml = inlineCSS(fs.readFileSync(srcPath, 'utf8'));

  for (const locale of LOCALES) {
    const strings = translations[locale];
    let html = srcHtml;

    html = applyDataI18n(html, strings);
    html = applyDataI18nHtml(html, strings);
    html = applyDataI18nPlaceholder(html, strings);
    html = applyDataI18nAria(html, strings);
    html = applyDataI18nHref(html, strings);
    html = applyMeta(html, strings, locale, titleKey, descKey, outputSubdir);
    html = addHeadTags(html, locale, outputSubdir);

    // Determine output path
    let outDir;
    if (outputSubdir) {
      // e.g. privacy → public/privacy/ or public/ru/privacy/
      outDir = locale === DEFAULT_LOCALE
        ? path.join(PUBLIC, outputSubdir)
        : path.join(PUBLIC, locale, outputSubdir);
    } else {
      // index.html → public/ or public/ru/
      outDir = locale === DEFAULT_LOCALE ? PUBLIC : path.join(PUBLIC, locale);
    }

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  }

  // Remove source .html if it was moved into a subdir (e.g. privacy.html → privacy/index.html)
  if (outputSubdir && fs.existsSync(srcPath)) {
    fs.unlinkSync(srcPath);
  }
}

function build() {
  // Load all translations once
  const translations = {};
  for (const locale of LOCALES) {
    translations[locale] = loadTranslations(locale);
  }

  // Process each page
  for (const [srcFile, outputSubdir, titleKey, descKey] of PAGES) {
    processPage(srcFile, outputSubdir, titleKey, descKey, translations);
  }

  // sitemap.xml
  fs.writeFileSync(path.join(PUBLIC, 'sitemap.xml'), generateSitemap(), 'utf8');

  // robots.txt
  const robots = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${DEFAULT_DOMAIN}/sitemap.xml`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(PUBLIC, 'robots.txt'), robots, 'utf8');

  const pageCount = PAGES.length * LOCALES.length;
  console.log(`[i18n] Pre-rendered ${pageCount} pages (${PAGES.length} pages × ${LOCALES.length} locales) + sitemap.xml + robots.txt`);
}

build();
