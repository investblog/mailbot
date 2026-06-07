// scripts/build-ru.mjs
// Builds Russian locale into public-ru/ for deployment to fastweb.su
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'public-ru');
const TRANS_DIR = path.join(ROOT, 'src', 'translations');

const RU_DOMAIN = 'https://emailbot.ru';
const DEFAULT_DOMAIN = 'https://mailbot.click';
const LOCALES = ['en', 'ru'];
const LOCALE_DOMAINS = { ru: RU_DOMAIN };
const DEFAULT_LOCALE = 'en';

const OG_LOCALE_MAP = {
  en: 'en_US', ru: 'ru_RU',
};

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

// --- Transform passes (same as build-i18n.mjs) ---

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

function applyMeta(html, strings, titleKey, descKey, pathSuffix) {
  const title = strings[titleKey] ? interpolate(strings[titleKey]) : null;
  const desc = strings[descKey] ? interpolate(strings[descKey]) : null;
  const url = localeUrl('ru', pathSuffix);

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
  const ogLocale = OG_LOCALE_MAP['ru'];
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

  // JSON-LD url
  html = html.replace(
    /("url"\s*:\s*)"[^"]*"/,
    `$1"${url}"`
  );

  // html lang
  html = html.replace(/<html\s+lang="[^"]*"/, `<html lang="ru"`);

  return html;
}

function stripHeadTags(html) {
  // Remove any existing canonical and hreflang tags (from prior build-i18n pass)
  html = html.replace(/\s*<link\s+rel="canonical"\s+href="[^"]*">\n?/g, '');
  html = html.replace(/\s*<link\s+rel="alternate"\s+hreflang="[^"]*"\s+href="[^"]*">\n?/g, '');
  return html;
}

function addHeadTags(html, pathSuffix) {
  html = stripHeadTags(html);
  const url = localeUrl('ru', pathSuffix);
  const canonical = `<link rel="canonical" href="${url}">`;
  const hreflang = buildHreflangTags(pathSuffix);
  return html.replace('</head>', `  ${canonical}\n  ${hreflang}\n</head>`);
}

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

// --- Copy helpers ---

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// --- Sitemap for fastweb.su ---

function generateSitemap() {
  const lastmod = new Date().toISOString().split('T')[0];

  const entries = PAGES.map(([, pathSuffix]) => {
    const url = localeUrl('ru', pathSuffix);
    const xhtml = LOCALES.map(alt =>
      `    <xhtml:link rel="alternate" hreflang="${alt}" href="${localeUrl(alt, pathSuffix)}"/>`
    );
    xhtml.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${DEFAULT_DOMAIN}/${pathSuffix ? pathSuffix + '/' : ''}"/>`);
    return `  <url>\n    <loc>${url}</loc>\n    <lastmod>${lastmod}</lastmod>\n${xhtml.join('\n')}\n  </url>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>`;
}

// --- Build ---

function build() {
  // Clean output
  if (fs.existsSync(OUT)) {
    fs.rmSync(OUT, { recursive: true });
  }
  fs.mkdirSync(OUT, { recursive: true });

  const strings = loadTranslations('ru');

  // Process each page
  for (const [srcFile, outputSubdir, titleKey, descKey] of PAGES) {
    // Try original source first, fall back to subdir/index.html
    // (build-i18n.mjs deletes e.g. privacy.html → privacy/index.html)
    let srcPath = path.join(PUBLIC, srcFile);
    if (!fs.existsSync(srcPath) && outputSubdir) {
      srcPath = path.join(PUBLIC, outputSubdir, 'index.html');
    }
    if (!fs.existsSync(srcPath)) continue;

    let html = inlineCSS(fs.readFileSync(srcPath, 'utf8'));
    html = applyDataI18n(html, strings);
    html = applyDataI18nHtml(html, strings);
    html = applyDataI18nPlaceholder(html, strings);
    html = applyDataI18nAria(html, strings);
    html = applyDataI18nHref(html, strings);
    html = applyMeta(html, strings, titleKey, descKey, outputSubdir);
    html = addHeadTags(html, outputSubdir);

    // Output at root: public-ru/index.html or public-ru/privacy/index.html
    const outDir = outputSubdir ? path.join(OUT, outputSubdir) : OUT;
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  }

  // Copy static assets
  const assetDirs = ['css', 'js', 'img', 'assets'];
  for (const dir of assetDirs) {
    const src = path.join(PUBLIC, dir);
    if (fs.existsSync(src)) {
      copyDirSync(src, path.join(OUT, dir));
    }
  }

  // Copy favicon
  const favicon = path.join(PUBLIC, 'favicon.svg');
  if (fs.existsSync(favicon)) {
    fs.copyFileSync(favicon, path.join(OUT, 'favicon.svg'));
  }

  // Copy 404.html
  const notFound = path.join(PUBLIC, '404.html');
  if (fs.existsSync(notFound)) {
    fs.copyFileSync(notFound, path.join(OUT, '404.html'));
  }

  // Copy sw.js (push notifications service worker)
  const sw = path.join(PUBLIC, 'sw.js');
  if (fs.existsSync(sw)) {
    fs.copyFileSync(sw, path.join(OUT, 'sw.js'));
  }

  // Copy sitemap.xsl
  const xsl = path.join(PUBLIC, 'sitemap.xsl');
  if (fs.existsSync(xsl)) {
    fs.copyFileSync(xsl, path.join(OUT, 'sitemap.xsl'));
  }

  // sitemap.xml
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'), generateSitemap(), 'utf8');

  // robots.txt
  const robots = [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${RU_DOMAIN}/sitemap.xml`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'robots.txt'), robots, 'utf8');

  console.log(`[build-ru] Built Russian locale to public-ru/ for ${RU_DOMAIN}`);
  console.log(`[build-ru]   ${PAGES.length} pages + sitemap.xml + robots.txt + static assets`);
}

build();
