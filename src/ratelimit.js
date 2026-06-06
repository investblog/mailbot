// Общие abuse-проверки на KV. Используются и email(), и /ingest, и /new —
// один источник истины, чтобы Plan B (внешний релей) не стал обходом лимитов.
// KV не атомарен (нет incr) — для MVP достаточно read-modify-write.

export async function isDenied(env, from) {
  if (!from) return false;
  return (await env.RL.get(`deny:${from}`)) !== null;
}

// Инкремент счётчика с TTL. true = лимит исчерпан (не инкрементим сверх).
export async function hitLimit(env, key, limit, ttlSeconds) {
  const cur = Number((await env.RL.get(key)) || 0);
  if (cur >= limit) return true;
  await env.RL.put(key, String(cur + 1), { expirationTtl: ttlSeconds });
  return false;
}

// Rate-limit входящих на конкретный адрес.
export function addressLimited(env, cfg, address) {
  return hitLimit(env, `rl:${address}`, cfg.rlPerHour, 3600);
}

// Rate-limit создания адресов на chat_id: и часовой, и суточный.
// Читаем оба до инкремента, чтобы не «съесть» часовой лимит, когда уже упёрлись в суточный.
export async function newBoxLimited(env, cfg, chatId) {
  const hKey = `new:h:${chatId}`;
  const dKey = `new:d:${chatId}`;
  const h = Number((await env.RL.get(hKey)) || 0);
  const d = Number((await env.RL.get(dKey)) || 0);
  if (h >= cfg.newPerHour || d >= cfg.newPerDay) return true;
  await env.RL.put(hKey, String(h + 1), { expirationTtl: 3600 });
  await env.RL.put(dKey, String(d + 1), { expirationTtl: 86400 });
  return false;
}
