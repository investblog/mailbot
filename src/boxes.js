// email-core: адреса (генерация, коллизии, резолв, лимиты). Привязка к OWNER, не к клиенту.

import { now } from './config.js';

// Алфавит без неоднозначных символов (нет 0/o, 1/l/i). 31 символ.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const LOCALPART_LEN = 8; // 31^8 ≈ 8.5e11 — перебор живых адресов нереалистичен
const MAX_GEN_RETRIES = 5;

function randomLocalpart() {
  const buf = new Uint8Array(LOCALPART_LEN);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < LOCALPART_LEN; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

// Создать адрес для владельца: генерим localpart, проверяем что не занят живым, до N ретраев.
export async function createBox(env, ownerId, domain, ttlHours) {
  const t = now();
  const expires = t + ttlHours * 3600;
  for (let i = 0; i < MAX_GEN_RETRIES; i++) {
    const localpart = randomLocalpart();
    // PK = (localpart, domain). Коллизия с протухшей строкой — чистим и переиспользуем.
    const existing = await env.DB
      .prepare('SELECT expires_at FROM boxes WHERE localpart = ? AND domain = ?')
      .bind(localpart, domain).first();
    if (existing) {
      if (existing.expires_at > t) continue; // живой чужой адрес — берём другой
      await env.DB.prepare('DELETE FROM boxes WHERE localpart = ? AND domain = ?')
        .bind(localpart, domain).run();
    }
    await env.DB
      .prepare('INSERT INTO boxes (localpart, domain, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(localpart, domain, ownerId, t, expires).run();
    return { localpart, domain, address: `${localpart}@${domain}`, expires_at: expires };
  }
  throw new Error('localpart generation exhausted retries');
}

// Резолв входящего адреса → владелец + срок (или null если нет/протух).
// JOIN, чтобы один round-trip отдавал и идентичность владельца (kind/external_id) для доставки.
export async function resolveBox(env, localpart, domain) {
  const row = await env.DB.prepare(
    `SELECT b.owner_id, b.expires_at, o.kind, o.external_id, o.locale
     FROM boxes b JOIN owners o ON o.id = b.owner_id
     WHERE b.localpart = ? AND b.domain = ?`
  ).bind(localpart, domain).first();
  if (!row) return null;
  if (row.expires_at <= now()) return null; // логически протух
  return {
    expires_at: row.expires_at,
    owner: { id: row.owner_id, kind: row.kind, external_id: row.external_id, locale: row.locale },
  };
}

// Активные адреса владельца (для показа/лимита).
export async function activeBoxes(env, ownerId) {
  const { results } = await env.DB
    .prepare('SELECT localpart, domain, expires_at FROM boxes WHERE owner_id = ? AND expires_at > ? ORDER BY created_at DESC')
    .bind(ownerId, now()).all();
  return results || [];
}

// Удержать лимит активных: сносим самые старые сверх (maxActive - 1), освобождая место под новый.
export async function enforceActiveLimit(env, ownerId, maxActive) {
  const boxes = await activeBoxes(env, ownerId);
  const keep = Math.max(0, maxActive - 1);
  const drop = boxes.slice(keep); // boxes отсортированы новые→старые
  for (const b of drop) {
    await env.DB.prepare('DELETE FROM boxes WHERE localpart = ? AND domain = ?')
      .bind(b.localpart, b.domain).run();
  }
}

// Снести все адреса владельца (напр. клиент недоступен — доставка невозможна).
export async function deleteBoxesForOwner(env, ownerId) {
  await env.DB.prepare('DELETE FROM boxes WHERE owner_id = ?').bind(ownerId).run();
}

// Продлить адрес на ttlHours от текущего момента.
export async function extendBox(env, localpart, domain, ttlHours) {
  const expires = now() + ttlHours * 3600;
  await env.DB
    .prepare('UPDATE boxes SET expires_at = ? WHERE localpart = ? AND domain = ?')
    .bind(expires, localpart, domain).run();
  return expires;
}
