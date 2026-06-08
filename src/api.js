// Публичный API расширения (второй клиент). Анонимный device-token.
//
// Auth: Bearer <deviceSecret> (32 байта в base64url или hex). Сервер хеширует секрет (SHA-256)
// и работает с owner kind='extension', id = ext:<hash>. БД хранит только хеш — утечка БД не даёт токенов.
// /api/session требует валидный Bearer и СОЗДАЁТ owner (ensureOwner). Остальные эндпоинты требуют
// существующего owner (иначе 401). Ownership во всех операциях проверяется в SQL.

import { config } from './config.js';
import { ownerId as makeOwnerId, ensureOwner, getOwnerById } from './owners.js';
import { activeBoxes, extendBox, deleteBox, provisionBox } from './boxes.js';
import { listMessages, getMessage } from './messages.js';
import { hitLimit } from './ratelimit.js';

const KIND = 'extension';
const API_RL_PER_MIN = 120; // общий лимит запросов на токен

// Формат секрета: 32 байта в base64url (43 симв.) или hex (64 симв.). Короткие/произвольные → 400.
const B64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const HEX_32 = /^[0-9a-f]{64}$/i;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function bearer(request) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/);
  return m ? m[1].trim() : null;
}

function splitAddr(addr) {
  const at = String(addr).lastIndexOf('@');
  if (at < 1) return [null, null];
  return [addr.slice(0, at), addr.slice(at + 1)];
}

export async function handleApi(request, env, _ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const cfg = config(env);

  // --- Auth: строгий формат секрета ---
  const secret = bearer(request);
  if (!secret || !(B64URL_32.test(secret) || HEX_32.test(secret))) {
    return json({ error: 'invalid token' }, 400);
  }
  const hash = await sha256hex(secret);
  const oid = makeOwnerId(KIND, hash);

  // Rate-limit на токен — только для мутаций. GET-поллинг (boxes/messages) идемпотентен и
  // частый; если писать в KV на каждый GET, free-tier лимит (1000 put/день) выжигается и кладёт API.
  if (request.method !== 'GET' && request.method !== 'OPTIONS' &&
      await hitLimit(env, `api:${oid}`, API_RL_PER_MIN, 60)) {
    return json({ error: 'rate limited' }, 429);
  }

  const locale = url.searchParams.get('locale') || undefined;

  // POST /api/session — создаёт/обновляет owner из хеша секрета.
  if (request.method === 'POST' && parts[1] === 'session' && parts.length === 2) {
    let body = {};
    try { body = await request.json(); } catch { /* ignore */ }
    await ensureOwner(env, KIND, hash, body.locale || locale);
    return json({ ok: true, session: { kind: KIND } });
  }

  // Остальные эндпоинты требуют существующего owner.
  const ownerRow = await getOwnerById(env, oid);
  if (!ownerRow) return json({ error: 'no session' }, 401);
  const owner = { id: oid, kind: KIND, external_id: hash, locale: ownerRow.locale };

  // --- /api/boxes ---
  if (parts[1] === 'boxes') {
    // GET /api/boxes
    if (request.method === 'GET' && parts.length === 2) {
      const boxes = await activeBoxes(env, oid);
      return json({ boxes: boxes.map((b) => ({ address: `${b.localpart}@${b.domain}`, expires_at: b.expires_at })) });
    }
    // POST /api/boxes — создать
    if (request.method === 'POST' && parts.length === 2) {
      let body = {};
      try { body = await request.json(); } catch { /* ignore */ }
      const box = await provisionBox(env, cfg, owner, body.locale || owner.locale);
      if (!box) return json({ error: 'rate limited' }, 429);
      return json({ box: { address: box.address, expires_at: box.expires_at } }, 201);
    }
    // /api/boxes/:addr/extend  и  DELETE /api/boxes/:addr
    if (parts.length >= 3) {
      const [lp, dom] = splitAddr(decodeURIComponent(parts[2]));
      if (!lp || !cfg.domains.includes(dom)) return json({ error: 'bad address' }, 400);

      if (request.method === 'POST' && parts[3] === 'extend' && parts.length === 4) {
        const exp = await extendBox(env, oid, lp, dom, cfg.ttlHours);
        if (!exp) return json({ error: 'not found' }, 404); // не принадлежит владельцу
        return json({ box: { address: `${lp}@${dom}`, expires_at: exp } });
      }
      if (request.method === 'DELETE' && parts.length === 3) {
        const ok = await deleteBox(env, oid, lp, dom);
        return ok ? json({ ok: true }) : json({ error: 'not found' }, 404);
      }
    }
  }

  // --- /api/messages ---
  if (parts[1] === 'messages') {
    // GET /api/messages?cursor=
    if (request.method === 'GET' && parts.length === 2) {
      const cursor = url.searchParams.get('cursor') || '';
      const { messages, next_cursor } = await listMessages(env, oid, cursor);
      return json({ messages, next_cursor });
    }
    // GET /api/messages/:id
    if (request.method === 'GET' && parts.length === 3) {
      const m = await getMessage(env, oid, decodeURIComponent(parts[2]));
      return m ? json({ message: m }) : json({ error: 'not found' }, 404);
    }
  }

  return json({ error: 'not found' }, 404);
}
