// Deploy guard: запускается перед `npm run deploy` (npm predeploy).
// Ловит самые частые грабли: незаполненные id ресурсов и забытые секреты.

import { readFileSync } from 'node:fs';

const cfgPath = new URL('../wrangler.jsonc', import.meta.url);
const cfg = readFileSync(cfgPath, 'utf8');

const problems = [];

if (cfg.includes('<id>')) {
  problems.push('wrangler.jsonc содержит плейсхолдеры "<id>" — впишите реальные database_id (D1) и id (KV).');
}

// Секреты не читаются из конфига — напоминаем явно.
const requiredSecrets = ['TG_TOKEN', 'TG_SECRET'];
const optionalSecrets = ['INGEST_SECRET'];
console.log('preflight: перед деплоем должны быть заданы секреты в target environment:');
console.log('  обязательные: ' + requiredSecrets.join(', ') + '  (wrangler secret put <NAME>)');
console.log('  опциональные: ' + optionalSecrets.join(', ') + '  (план Б /ingest)');

if (problems.length) {
  console.error('\npreflight FAILED:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

console.log('\npreflight OK');
