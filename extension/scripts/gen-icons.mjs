// Нарезка иконок расширения из icon-source.png в src/public/icon/. Запуск: npm run icons.
import sharp from 'sharp';
import fs from 'node:fs';
const SRC = 'icon-source.png';
const OUT = 'src/public/icon';
fs.mkdirSync(OUT, { recursive: true });
for (const s of [16, 32, 48, 128, 256]) {
  await sharp(SRC).resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(`${OUT}/${s}.png`);
}
console.log('icons generated →', OUT);
