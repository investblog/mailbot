// scripts/build-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { optimize } from 'svgo';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'icons-src');
const HTML_FILES = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.html'))
  .map(f => path.join(ROOT, f))
  .filter(f => fs.readFileSync(f, 'utf8').includes('<!-- SPRITE:START -->'));

const CATEGORIES = ['mono', 'brand', 'engine'];
const START_MARKER = '<!-- SPRITE:START -->';
const END_MARKER = '<!-- SPRITE:END -->';

function build() {
  if (!fs.existsSync(SRC_ROOT)) {
    console.error('[icons] Source dir not found:', SRC_ROOT);
    process.exit(1);
  }

  const allDefs = [];
  const symbols = [];

  for (const cat of CATEGORIES) {
    const dir = path.join(SRC_ROOT, cat);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.svg'))
      .sort();

    for (const file of files) {
      const name = path.basename(file, '.svg');
      const id = `i-${cat}-${name}`;
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');

      // Optimize with SVGO — keep IDs untouched, we prefix ourselves
      const { data } = optimize(raw, {
        multipass: true,
        plugins: [
          {
            name: 'preset-default',
            params: {
              overrides: {
                cleanupIds: false,
              },
            },
          },
        ],
      });

      // Extract viewBox and presentation attributes from <svg> tag
      const svgTag = data.match(/^<svg[^>]*>/)?.[0] || '';
      const vbMatch = svgTag.match(/viewBox="([^"]+)"/);
      const viewBox = vbMatch ? vbMatch[1] : '0 0 24 24';

      // Carry over presentation attributes (fill, stroke, etc.)
      const PRES_ATTRS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'];
      const extraAttrs = [];
      for (const attr of PRES_ATTRS) {
        const m = svgTag.match(new RegExp(`${attr}="([^"]+)"`));
        if (m) extraAttrs.push(`${attr}="${m[1]}"`);
      }
      const attrStr = extraAttrs.length ? ' ' + extraAttrs.join(' ') : '';

      // Strip outer <svg> tag to get inner content
      let inner = data
        .replace(/^<svg[^>]*>/, '')
        .replace(/<\/svg>\s*$/, '');

      // Collect all IDs in this SVG (gradients, clipPaths, etc.)
      const idSet = new Set();
      inner.replace(/\bid="([^"]+)"/g, (_, foundId) => {
        idSet.add(foundId);
      });

      // Prefix all IDs with icon name for uniqueness
      for (const oldId of idSet) {
        const newId = `${name}-${oldId}`;
        // Replace id="..." declarations
        inner = inner.split(`id="${oldId}"`).join(`id="${newId}"`);
        // Replace url(#...) references
        inner = inner.split(`url(#${oldId})`).join(`url(#${newId})`);
        // Replace href="#..." references (for <use>)
        inner = inner.split(`href="#${oldId}"`).join(`href="#${newId}"`);
      }

      // Extract <defs>...</defs> and hoist to shared defs
      const defsRegex = /<defs>([\s\S]*?)<\/defs>/g;
      let defsMatch;
      while ((defsMatch = defsRegex.exec(inner)) !== null) {
        allDefs.push(defsMatch[1].trim());
      }
      inner = inner.replace(/<defs>[\s\S]*?<\/defs>/g, '');

      // Clean up whitespace
      inner = inner.trim();
      if (!inner) continue;

      symbols.push(`  <symbol id="${id}" viewBox="${viewBox}"${attrStr}>${inner}</symbol>`);
    }
  }

  // Build the sprite
  const lines = ['<svg xmlns="http://www.w3.org/2000/svg" hidden>'];
  if (allDefs.length) {
    lines.push('  <defs>');
    for (const d of allDefs) {
      lines.push(`    ${d}`);
    }
    lines.push('  </defs>');
  }
  lines.push(...symbols);
  lines.push('</svg>');

  const sprite = lines.join('\n');

  // Inject into all HTML files with markers
  for (const htmlFile of HTML_FILES) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    const startIdx = html.indexOf(START_MARKER);
    const endIdx = html.indexOf(END_MARKER);

    if (startIdx === -1 || endIdx === -1) continue;

    const before = html.slice(0, startIdx + START_MARKER.length);
    const after = html.slice(endIdx);
    const newHtml = before + '\n' + sprite + '\n' + after;

    fs.writeFileSync(htmlFile, newHtml, 'utf8');
  }

  console.log(`[icons] Built sprite: ${symbols.length} icons, ${allDefs.length} defs → ${HTML_FILES.length} file(s)`);
}

build();
