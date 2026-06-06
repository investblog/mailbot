// Адреса: генерация, коллизии, резолв, лимиты. Вся работа с таблицами boxes/users.

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

// Создать адрес: генерим localpart, проверяем что не занят живым, до N ретраев.
export async function createBox(env, chatId, domain, ttlHours) {
  const t = now();
  const expires = t + ttlHours * 3600;
  for (let i = 0; i < MAX_GEN_RETRIES; i++) {
    const localpart = randomLocalpart();
    // INSERT упадёт на PK-коллизии (в т.ч. с протухшей строкой) — чистим протухшую и ретраим.
    const existing = await env.DB
      .prepare('SELECT expires_at FROM boxes WHERE localpart = ? AND domain = ?')
      .bind(localpart, domain).first();
    if (existing) {
      if (existing.expires_at > t) continue; // живой чужой адрес — берём другой
      await env.DB.prepare('DELETE FROM boxes WHERE localpart = ? AND domain = ?')
        .bind(localpart, domain).run();
    }
    await env.DB
      .prepare('INSERT INTO boxes (localpart, domain, chat_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(localpart, domain, chatId, t, expires).run();
    return { localpart, domain, address: `${localpart}@${domain}`, expires_at: expires };
  }
  throw new Error('localpart generation exhausted retries');
}

// Резолв входящего адреса → активный box (или null если нет/протух).
export async function resolveBox(env, localpart, domain) {
  const row = await env.DB
    .prepare('SELECT chat_id, expires_at FROM boxes WHERE localpart = ? AND domain = ?')
    .bind(localpart, domain).first();
  if (!row) return null;
  if (row.expires_at <= now()) return null; // логически протух
  return row;
}

// Активные адреса юзера (для показа/лимита).
export async function activeBoxes(env, chatId) {
  const { results } = await env.DB
    .prepare('SELECT localpart, domain, expires_at FROM boxes WHERE chat_id = ? AND expires_at > ? ORDER BY created_at DESC')
    .bind(chatId, now()).all();
  return results || [];
}

// Удержать лимит активных: сносим самые старые сверх (maxActive - 1), освобождая место под новый.
export async function enforceActiveLimit(env, chatId, maxActive) {
  const boxes = await activeBoxes(env, chatId);
  const keep = Math.max(0, maxActive - 1);
  const drop = boxes.slice(keep); // boxes отсортированы новые→старые
  for (const b of drop) {
    await env.DB.prepare('DELETE FROM boxes WHERE localpart = ? AND domain = ?')
      .bind(b.localpart, b.domain).run();
  }
}

// Продлить адрес на ttlHours от текущего момента.
export async function extendBox(env, localpart, domain, ttlHours) {
  const expires = now() + ttlHours * 3600;
  await env.DB
    .prepare('UPDATE boxes SET expires_at = ? WHERE localpart = ? AND domain = ?')
    .bind(expires, localpart, domain).run();
  return expires;
}

// --- users ---

export async function touchUser(env, chatId, locale) {
  const t = now();
  // upsert: новый — created, существующий — +1 session и обновляем локаль.
  await env.DB.prepare(
    `INSERT INTO users (chat_id, locale, sessions, created_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(chat_id) DO UPDATE SET sessions = sessions + 1, locale = excluded.locale`
  ).bind(chatId, locale || null, t).run();
  return getUser(env, chatId);
}

export async function getUser(env, chatId) {
  return env.DB.prepare('SELECT * FROM users WHERE chat_id = ?').bind(chatId).first();
}

export async function incUser(env, chatId, field) {
  const cols = { boxes_total: 'boxes_total', otp_caught: 'otp_caught' };
  if (!cols[field]) return;
  await env.DB.prepare(`UPDATE users SET ${cols[field]} = ${cols[field]} + 1 WHERE chat_id = ?`)
    .bind(chatId).run();
}
