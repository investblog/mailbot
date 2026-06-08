// Web Push: VAPID JWT (RFC 8292), шифрование payload (RFC 8291), хранилище подписок,
// API /api/push/*, и pushToOwner (чистка мёртвых подписок).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/d1.mjs';
import {
  createVapidAuth, encryptPayload,
  saveSubscription, listSubscriptions, deleteSubscription, pushToOwner,
} from '../src/push.js';
import { handleApi } from '../src/api.js';

const SA = 'a'.repeat(43);
const ctx = { waitUntil() {} };

// KV-шим с list/delete (нужно push-хранилищу).
function fakeKV() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) };
    },
    _map: m,
  };
}
function apiEnv() { const env = makeEnv(); env.RL = fakeKV(); env.PUSH_SUBS = fakeKV(); return env; }

const b64url = (u) => Buffer.from(u).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlToBuf = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Сгенерировать VAPID-пару (P-256): public raw(65) b64url, private 'd' b64url.
async function genVapid() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { pub, priv: jwk.d };
}

// Сгенерировать «клиентскую» подписку: ECDH-пара даёт p256dh, auth — 16 случайных байт.
async function genSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  return { endpoint, keys: { p256dh, auth } };
}

test('VAPID: createVapidAuth даёт валидный ES256 JWT, проверяемый публичным ключом', async () => {
  const { pub, priv } = await genVapid();
  const header = await createVapidAuth('https://fcm.googleapis.com/fcm/send/x', priv, pub);
  assert.match(header, /^vapid t=.+, k=.+$/);
  const t = header.match(/t=([^,]+)/)[1];
  const k = header.match(/k=(.+)$/)[1];
  assert.equal(k, pub);
  const [h, b, sig] = t.split('.');
  // header/body — корректный JSON с нужными полями
  const hj = JSON.parse(b64urlToBuf(h).toString());
  const bj = JSON.parse(b64urlToBuf(b).toString());
  assert.equal(hj.alg, 'ES256');
  assert.equal(bj.aud, 'https://fcm.googleapis.com');
  assert.ok(bj.exp > Math.floor(Date.now() / 1000));
  // подпись валидна
  const key = await crypto.subtle.importKey('raw', b64urlToBuf(pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, key, b64urlToBuf(sig), new TextEncoder().encode(`${h}.${b}`)
  );
  assert.equal(ok, true);
});

test('encryptPayload: структура aes128gcm-тела (salt|rs|idlen|keyid|ct)', async () => {
  const sub = await genSubscription();
  const body = new Uint8Array(await encryptPayload(sub.keys.p256dh, sub.keys.auth, JSON.stringify({ hi: 1 })));
  // минимум: 16 salt + 4 rs + 1 idlen + 65 keyid + (>=17 ct+tag)
  assert.ok(body.length >= 16 + 4 + 1 + 65 + 17);
  assert.equal(body[20], 65); // idlen = длина uncompressed public key
});

test('storage: save → list → delete подписки в KV', async () => {
  const env = apiEnv();
  const sub = await genSubscription();
  assert.equal(await saveSubscription(env, 'ext:o1', sub), true);
  assert.equal(await saveSubscription(env, 'ext:o1', { endpoint: 'x' }), false); // нет keys
  let subs = await listSubscriptions(env, 'ext:o1');
  assert.equal(subs.length, 1);
  assert.equal(subs[0].endpoint, sub.endpoint);
  // изоляция по owner
  assert.equal((await listSubscriptions(env, 'ext:o2')).length, 0);
  await deleteSubscription(env, 'ext:o1', sub.endpoint);
  assert.equal((await listSubscriptions(env, 'ext:o1')).length, 0);
});

test('API: /api/push/subscribe требует session, сохраняет; /unsubscribe удаляет', async () => {
  const env = apiEnv();
  const sub = await genSubscription();
  const url = 'https://api.test/api/push/subscribe';
  // без session → 401
  const noSess = await handleApi(new Request(url, { method: 'POST', headers: { authorization: 'Bearer ' + SA, 'content-type': 'application/json' }, body: JSON.stringify(sub) }), env, ctx);
  assert.equal(noSess.status, 401);
  // создаём session
  await handleApi(new Request('https://api.test/api/session', { method: 'POST', headers: { authorization: 'Bearer ' + SA, 'content-type': 'application/json' }, body: '{}' }), env, ctx);
  // subscribe → ok, в KV одна подписка
  const sub1 = await handleApi(new Request(url, { method: 'POST', headers: { authorization: 'Bearer ' + SA, 'content-type': 'application/json' }, body: JSON.stringify(sub) }), env, ctx);
  assert.equal(sub1.status, 200);
  assert.equal(env.PUSH_SUBS._map.size, 1);
  // unsubscribe → пусто
  const un = await handleApi(new Request('https://api.test/api/push/unsubscribe', { method: 'POST', headers: { authorization: 'Bearer ' + SA, 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }), env, ctx);
  assert.equal(un.status, 200);
  assert.equal(env.PUSH_SUBS._map.size, 0);
});

test('pushToOwner: шлёт на endpoint и чистит мёртвую подписку (410)', async () => {
  const env = apiEnv();
  const { pub, priv } = await genVapid();
  env.VAPID_PUBLIC_KEY = pub;
  env.VAPID_PRIVATE_KEY = priv;
  const sub = await genSubscription('https://push.example/dead');
  await saveSubscription(env, 'ext:o1', sub);

  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (endpoint, init) => {
    calls.push({ endpoint, init });
    return { status: 410, statusText: 'Gone' };
  };
  try {
    await pushToOwner(env, 'ext:o1', { id: '1', otp: '123456' });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, sub.endpoint);
  assert.equal(calls[0].init.headers['Content-Encoding'], 'aes128gcm');
  assert.match(calls[0].init.headers.Authorization, /^vapid t=/);
  // 410 → подписка удалена
  assert.equal((await listSubscriptions(env, 'ext:o1')).length, 0);
});
