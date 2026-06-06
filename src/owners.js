// email-core: владельцы адресов. Ядро не знает про Telegram — знает про owner.
// owner.kind задаёт клиента ('telegram' сейчас, 'extension'/'account' в будущем).

import { now } from './config.js';

// Префиксы id по типу владельца. id детерминированный → owner_id выводится без лишнего чтения.
const PREFIX = { telegram: 'tg', extension: 'ext', account: 'acc' };

export function ownerId(kind, externalId) {
  const p = PREFIX[kind];
  if (!p) throw new Error(`unknown owner kind: ${kind}`);
  return `${p}:${externalId}`;
}

// Upsert владельца. Возвращает {id, kind, external_id} (идентичность для core/доставки).
// sessions++ на повторном заходе — это поведение клиента (бот зовёт при /start).
export async function upsertOwner(env, kind, externalId, locale) {
  const id = ownerId(kind, externalId);
  const t = now();
  await env.DB.prepare(
    `INSERT INTO owners (id, kind, external_id, locale, sessions, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       sessions = sessions + 1,
       locale = excluded.locale,
       updated_at = excluded.updated_at`
  ).bind(id, kind, String(externalId), locale || null, t, t).run();
  return { id, kind, external_id: String(externalId) };
}

// Гарантировать существование владельца БЕЗ инкремента sessions (для /new и т.п.).
// Нужно, чтобы box.owner_id всегда ссылался на существующую строку (resolveBox делает JOIN).
export async function ensureOwner(env, kind, externalId, locale) {
  const id = ownerId(kind, externalId);
  const t = now();
  await env.DB.prepare(
    `INSERT INTO owners (id, kind, external_id, locale, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET locale = excluded.locale, updated_at = excluded.updated_at`
  ).bind(id, kind, String(externalId), locale || null, t, t).run();
  return { id, kind, external_id: String(externalId) };
}

export async function getOwnerById(env, id) {
  return env.DB.prepare('SELECT * FROM owners WHERE id = ?').bind(id).first();
}

export async function incOwner(env, id, field) {
  const cols = { boxes_total: 'boxes_total', otp_caught: 'otp_caught' };
  if (!cols[field]) return;
  await env.DB.prepare(`UPDATE owners SET ${cols[field]} = ${cols[field]} + 1 WHERE id = ?`)
    .bind(id).run();
}

export async function setLastPromo(env, id) {
  await env.DB.prepare('UPDATE owners SET last_promo = ? WHERE id = ?').bind(now(), id).run();
}
