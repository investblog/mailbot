// Минимальный адаптер D1 поверх node:sqlite — для lifecycle-тестов на настоящем SQLite
// (D1 это и есть SQLite). Требует флаг node --experimental-sqlite.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

// Возвращает фейковый env с .DB, повторяющим подмножество D1 API: prepare().bind().first/all/run.
export function makeEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const DB = {
    prepare(sql) {
      let args = [];
      return {
        bind(...a) { args = a; return this; },
        async first() { const r = db.prepare(sql).get(...args); return r ?? null; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
        async run() {
          const r = db.prepare(sql).run(...args);
          return { success: true, meta: { changes: r.changes, last_row_id: r.lastInsertRowid } };
        },
      };
    },
  };
  return { DB };
}
