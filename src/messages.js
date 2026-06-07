// Хранилище входящих для клиентов, которые показывают письма сами (расширение).
// Только нормализованный текст. TTL = жизнь адреса; протухшие чистит Cron.

import { now, nowMs } from './config.js';

const PAYLOAD_VERSION = 1;

function randomId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// Сохранить нормализованное письмо. box = { localpart, domain, expires_at(sec) }.
export async function storeMessage(env, owner, box, msg) {
  const id = randomId();
  const payload = JSON.stringify({
    v: PAYLOAD_VERSION,
    body: msg.plain || '',            // плоский текст (фолбэк для рендера)
    tokens: msg.bodyTokens || [],     // токены (text/link) для богатого рендера
    links: msg.links || [],
    attachments: msg.attachments || [],
  });
  await env.DB.prepare(
    `INSERT INTO messages (id, owner_id, localpart, domain, from_addr, subject, otp, payload, created_at_ms, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, owner.id, box.localpart, box.domain,
    msg.from || '', msg.subject || '', msg.otp || null, payload,
    nowMs(), box.expires_at
  ).run();
  return id;
}

// Курсор polling: "<ms>:<id>". Монотонный — письма с одинаковым ms не теряются.
function parseCursor(cursor) {
  const s = String(cursor || '');
  const i = s.indexOf(':');
  if (i < 0) return { ms: 0, id: '' };
  return { ms: Number(s.slice(0, i)) || 0, id: s.slice(i + 1) };
}
const makeCursor = (m) => `${m.created_at}:${m.id}`;

// Входящие владельца ПОСЛЕ курсора (ASC по (ms,id)). Только не протухшие. Возвращает {messages, next_cursor}.
export async function listMessages(env, ownerId, cursor = '', limit = 50) {
  const { ms, id } = parseCursor(cursor);
  const { results } = await env.DB.prepare(
    `SELECT id, localpart, domain, from_addr, subject, otp, payload, created_at_ms
     FROM messages
     WHERE owner_id = ? AND expires_at > ?
       AND (created_at_ms > ? OR (created_at_ms = ? AND id > ?))
     ORDER BY created_at_ms ASC, id ASC LIMIT ?`
  ).bind(ownerId, now(), ms, ms, id, limit).all();
  const messages = (results || []).map(rowToMessage);
  const next_cursor = messages.length ? makeCursor(messages[messages.length - 1]) : cursor;
  return { messages, next_cursor };
}

// Одно письмо с проверкой владельца (ownership в SQL).
export async function getMessage(env, ownerId, id) {
  const row = await env.DB.prepare(
    `SELECT id, localpart, domain, from_addr, subject, otp, payload, created_at_ms
     FROM messages WHERE id = ? AND owner_id = ? AND expires_at > ?`
  ).bind(id, ownerId, now()).first();
  return row ? rowToMessage(row) : null;
}

export async function deleteExpiredMessages(env) {
  await env.DB.prepare('DELETE FROM messages WHERE expires_at <= ?').bind(now()).run();
}

function rowToMessage(row) {
  let payload = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch { /* ignore */ }
  return {
    id: row.id,
    address: `${row.localpart}@${row.domain}`,
    from: row.from_addr,
    subject: row.subject,
    otp: row.otp,
    created_at: row.created_at_ms,
    body: payload.body || '',
    tokens: payload.tokens || [],
    links: payload.links || [],
    attachments: payload.attachments || [],
  };
}
