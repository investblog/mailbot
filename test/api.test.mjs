// API расширения: auth (формат токена, session), boxes CRUD, messages+курсор, изоляция, CORS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/d1.mjs';
import { handleApi } from '../src/api.js';

const SA = 'a'.repeat(43); // валидный base64url 32 байта
const SB = 'b'.repeat(43);
const ctx = { waitUntil() {} };

function fakeKV() {
  const m = new Map();
  return { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); } };
}
function apiEnv() { const env = makeEnv(); env.RL = fakeKV(); return env; }

async function call(env, method, path, { secret, body, search } = {}) {
  const headers = {};
  if (secret !== undefined) headers.authorization = 'Bearer ' + secret;
  if (body) headers['content-type'] = 'application/json';
  const url = 'https://api.test' + path + (search ? '?' + search : '');
  const req = new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return handleApi(req, env, ctx);
}
const session = (env, secret) => call(env, 'POST', '/api/session', { secret, body: { locale: 'en' } });

test('auth: без токена и короткий токен → 400', async () => {
  const env = apiEnv();
  assert.equal((await call(env, 'POST', '/api/session', {})).status, 400);
  assert.equal((await call(env, 'POST', '/api/session', { secret: 'short' })).status, 400);
});

test('session создаёт owner; без session прочие эндпоинты → 401', async () => {
  const env = apiEnv();
  assert.equal((await call(env, 'GET', '/api/boxes', { secret: SA })).status, 401); // нет session
  const r = await session(env, SA);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).session, { kind: 'extension' });
  assert.equal((await call(env, 'GET', '/api/boxes', { secret: SA })).status, 200); // теперь ок
});

test('boxes: создать → список → продлить → удалить', async () => {
  const env = apiEnv();
  await session(env, SA);
  const created = await call(env, 'POST', '/api/boxes', { secret: SA, body: {} });
  assert.equal(created.status, 201);
  const addr = (await created.json()).box.address;
  assert.match(addr, /@mailbot\.click$/);

  const list = await (await call(env, 'GET', '/api/boxes', { secret: SA })).json();
  assert.equal(list.boxes.length, 1);
  assert.equal(list.boxes[0].address, addr);

  const ext = await call(env, 'POST', `/api/boxes/${encodeURIComponent(addr)}/extend`, { secret: SA, body: {} });
  assert.equal(ext.status, 200);

  const del = await call(env, 'DELETE', `/api/boxes/${encodeURIComponent(addr)}`, { secret: SA });
  assert.equal(del.status, 200);
  assert.equal((await (await call(env, 'GET', '/api/boxes', { secret: SA })).json()).boxes.length, 0);
});

test('messages: курсор монотонный (одинаковый created_at_ms не теряется)', async () => {
  const env = apiEnv();
  await session(env, SA);
  // owner id = ext:<sha256(SA)> — узнаём через создание адреса (не нужно). Вставим 2 msg с одним ms.
  const oid = (await env.DB.prepare("SELECT id FROM owners LIMIT 1").first()).id;
  const ins = (id, ms) => env.DB.prepare(
    `INSERT INTO messages (id,owner_id,localpart,domain,from_addr,subject,otp,payload,created_at_ms,expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, oid, 'lp', 'mailbot.click', 'a@b', 's', '123456', '{"v":1}', ms, 9_999_999_999).run();
  await ins('m1', 1000);
  await ins('m2', 1000); // тот же ms

  const all = await (await call(env, 'GET', '/api/messages', { secret: SA })).json();
  const ids = all.messages.map((m) => m.id).sort();
  assert.deepEqual(ids, ['m1', 'm2']);
  assert.ok(all.next_cursor.includes(':'));
  // повторный запрос с next_cursor → пусто (всё прочитано)
  const after = await (await call(env, 'GET', '/api/messages', { secret: SA, search: 'cursor=' + encodeURIComponent(all.next_cursor) })).json();
  assert.equal(after.messages.length, 0);
});

test('изоляция: owner B не видит и не трогает данные owner A', async () => {
  const env = apiEnv();
  await session(env, SA);
  await session(env, SB);
  const addr = (await (await call(env, 'POST', '/api/boxes', { secret: SA, body: {} })).json()).box.address;

  // B не видит box A
  assert.equal((await (await call(env, 'GET', '/api/boxes', { secret: SB })).json()).boxes.length, 0);
  // B не может продлить/удалить адрес A
  assert.equal((await call(env, 'POST', `/api/boxes/${encodeURIComponent(addr)}/extend`, { secret: SB, body: {} })).status, 404);
  assert.equal((await call(env, 'DELETE', `/api/boxes/${encodeURIComponent(addr)}`, { secret: SB })).status, 404);
  // адрес A жив
  assert.equal((await (await call(env, 'GET', '/api/boxes', { secret: SA })).json()).boxes.length, 1);
});

test('CORS: OPTIONS preflight и обычный ответ содержат заголовки', async () => {
  const env = apiEnv();
  const pre = await call(env, 'OPTIONS', '/api/session', { secret: SA });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
  const r = await session(env, SA);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
});
