// Web Push (RFC 8291 шифрование aes128gcm + RFC 8292 VAPID) на Web Crypto, без зависимостей.
// Порт из fastweb-cam/workers/push-cdn. Подписки расширения хранятся в KV PUSH_SUBS по owner.
//
// VAPID-пара: публичный ключ — здесь и в extension (он публичный, это applicationServerKey);
// приватный — только в secret env.VAPID_PRIVATE_KEY (P-256 'd', base64url).

export const VAPID_PUBLIC =
  'BN_UAqwCiOlWajmBMFk2XQJmGAalX6uYsyOQGpUmNPBQfj_j7XGA7SptwjgFfKkQkBR37uMmxoxRt7Df3-QxUKo';
const VAPID_SUBJECT = 'mailto:admin@emailbot.ru';

// --- base64url ---
function b64urlEncode(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function toAB(arr) {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
}
function concat(...buffers) {
  const total = buffers.reduce((s, b) => s + b.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const buf of buffers) { out.set(new Uint8Array(buf), off); off += buf.byteLength; }
  return toAB(out);
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// --- HKDF (RFC 5869), одна итерация (length <= 32) ---
async function hkdf(salt, ikm, info, length) {
  const prkKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = await crypto.subtle.sign('HMAC', prkKey, ikm);
  const expandKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const okm = await crypto.subtle.sign('HMAC', expandKey, concat(info, toAB(new Uint8Array([1]))));
  return okm.slice(0, length);
}

// --- Шифрование payload (RFC 8291 / aes128gcm) ---
export async function encryptPayload(clientPublicKeyB64, clientAuthB64, payload) {
  const ua_public = b64urlDecode(clientPublicKeyB64);
  const auth_secret = b64urlDecode(clientAuthB64);
  const enc = new TextEncoder();

  const as_keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const as_public_raw = await crypto.subtle.exportKey('raw', as_keys.publicKey);

  const ua_key = await crypto.subtle.importKey('raw', toAB(ua_public), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh_secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: ua_key }, as_keys.privateKey, 256);

  const key_info = concat(toAB(enc.encode('WebPush: info\0')), toAB(ua_public), as_public_raw);
  const ikm = await hkdf(toAB(auth_secret), ecdh_secret, key_info, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(toAB(salt), ikm, toAB(enc.encode('Content-Encoding: aes128gcm\0')), 16);
  const nonce = await hkdf(toAB(salt), ikm, toAB(enc.encode('Content-Encoding: nonce\0')), 12);

  const data = enc.encode(payload);
  const plaintext = new Uint8Array(data.length + 1);
  plaintext.set(data);
  plaintext[data.length] = 2; // финальный разделитель записи

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(nonce) }, aesKey, plaintext);

  // body: salt(16) || rs(4) || idlen(1) || keyid(65) || ciphertext+tag
  const as_public_bytes = new Uint8Array(as_public_raw);
  const rs = new DataView(new ArrayBuffer(4));
  rs.setUint32(0, plaintext.length + 16);
  return concat(
    toAB(salt), rs.buffer, toAB(new Uint8Array([as_public_bytes.length])),
    toAB(as_public_bytes), encrypted
  );
}

// --- VAPID JWT (RFC 8292) ---
export async function createVapidAuth(endpoint, privateKeyB64, publicKeyB64 = VAPID_PUBLIC, subject = VAPID_SUBJECT) {
  const url = new URL(endpoint);
  const header = { typ: 'JWT', alg: 'ES256' };
  const body = { aud: `${url.protocol}//${url.host}`, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject };
  const enc = new TextEncoder();
  const headerB64 = b64urlEncode(toAB(enc.encode(JSON.stringify(header))));
  const bodyB64 = b64urlEncode(toAB(enc.encode(JSON.stringify(body))));
  const unsigned = `${headerB64}.${bodyB64}`;

  const priv = b64urlDecode(privateKeyB64);
  const pub = b64urlDecode(publicKeyB64);
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: b64urlEncode(toAB(pub.slice(1, 33))),
    y: b64urlEncode(toAB(pub.slice(33, 65))),
    d: b64urlEncode(toAB(priv)),
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64urlEncode(sig)}, k=${publicKeyB64}`;
}

// --- Отправка одного push. Возвращает HTTP-статус push-сервиса (404/410 = подписка мертва). ---
export async function sendPush(env, sub, payload) {
  const body = await encryptPayload(sub.keys.p256dh, sub.keys.auth, JSON.stringify(payload));
  // public по умолчанию — константа (она же в extension); env.VAPID_PUBLIC_KEY нужен только тестам
  // (свежая пара), чтобы public и private были согласованы без коммита прод-секрета.
  const pub = env.VAPID_PUBLIC_KEY || VAPID_PUBLIC;
  const authorization = await createVapidAuth(sub.endpoint, env.VAPID_PRIVATE_KEY, pub);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high', // OTP — пользователь ждёт
    },
    body,
  });
  return res.status;
}

// --- Хранилище подписок в KV (по owner) ---
const subKeyPrefix = (ownerId) => `push:${ownerId}:`;
async function subKey(ownerId, endpoint) {
  return subKeyPrefix(ownerId) + (await sha256hex(endpoint)).slice(0, 24);
}

export async function saveSubscription(env, ownerId, sub) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return false;
  const key = await subKey(ownerId, sub.endpoint);
  await env.PUSH_SUBS.put(key, JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }));
  return true;
}

export async function deleteSubscription(env, ownerId, endpoint) {
  if (!endpoint) return;
  await env.PUSH_SUBS.delete(await subKey(ownerId, endpoint));
}

export async function listSubscriptions(env, ownerId) {
  const { keys } = await env.PUSH_SUBS.list({ prefix: subKeyPrefix(ownerId) });
  const subs = [];
  for (const k of keys) {
    const v = await env.PUSH_SUBS.get(k.name);
    if (v) { try { subs.push(JSON.parse(v)); } catch { /* skip */ } }
  }
  return subs;
}

// --- Разослать payload на все подписки owner. Best-effort; чистит мёртвые (404/410). ---
export async function pushToOwner(env, ownerId, payload) {
  let subs;
  try { subs = await listSubscriptions(env, ownerId); } catch { return; }
  for (const sub of subs) {
    try {
      const status = await sendPush(env, sub, payload);
      if (status === 404 || status === 410) await deleteSubscription(env, ownerId, sub.endpoint);
    } catch (e) {
      console.error('sendPush failed', e);
    }
  }
}
