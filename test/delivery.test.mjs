// Delivery policy: success / permanent(403,400) / transient. fetch замокан, без сети.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/d1.mjs';
import { ensureOwner } from '../src/owners.js';
import { createBox, activeBoxes } from '../src/boxes.js';
import { deliver } from '../src/delivery.js';
import { listMessages } from '../src/messages.js';

const owner = { id: 'tg:1', kind: 'telegram', external_id: '1' };
const msg = { from: 'a@b.c', subject: 's', body: 'b', links: [], attachments: [], otp: null };

function ctxCollect() {
  const tasks = [];
  return { ctx: { waitUntil: (p) => tasks.push(p) }, drain: () => Promise.all(tasks) };
}

// Подменяем глобальный fetch на ответ с заданным статусом.
function stubFetch(status, { throws = false } = {}) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => {
    if (throws) throw new Error('network');
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => '' };
  };
  return () => { globalThis.fetch = orig; };
}

test('200 → delivered', async () => {
  const env = { TG_TOKEN: 'x' };
  const restore = stubFetch(200);
  const { ctx } = ctxCollect();
  const r = await deliver(env, ctx, owner, msg);
  restore();
  assert.deepEqual(r, { delivered: true });
});

test('403 → permanent + сносит адреса владельца', async () => {
  const env = makeEnv();
  env.TG_TOKEN = 'x';
  await ensureOwner(env, 'telegram', 1);
  await createBox(env, 'tg:1', 'mailbot.click', 24);
  const restore = stubFetch(403);
  const { ctx, drain } = ctxCollect();
  const r = await deliver(env, ctx, owner, msg);
  await drain();
  restore();
  assert.equal(r.delivered, false);
  assert.equal(r.permanent, true);
  assert.equal((await activeBoxes(env, 'tg:1')).length, 0); // адреса снесены
});

test('400 → permanent, адреса не трогаем', async () => {
  const env = makeEnv();
  env.TG_TOKEN = 'x';
  await ensureOwner(env, 'telegram', 1);
  await createBox(env, 'tg:1', 'mailbot.click', 24);
  const restore = stubFetch(400);
  const { ctx, drain } = ctxCollect();
  const r = await deliver(env, ctx, owner, msg);
  await drain();
  restore();
  assert.equal(r.permanent, true);
  assert.equal((await activeBoxes(env, 'tg:1')).length, 1); // не снесены
});

test('429 после ретраев → transient', async () => {
  const env = { TG_TOKEN: 'x' };
  const restore = stubFetch(429);
  const { ctx } = ctxCollect();
  const r = await deliver(env, ctx, owner, msg);
  restore();
  assert.equal(r.delivered, false);
  assert.equal(r.permanent, false);
});

test('extension: сохраняет нормализованное письмо в messages', async () => {
  const env = makeEnv();
  await ensureOwner(env, 'extension', 'devhash');
  const extOwner = { id: 'ext:devhash', kind: 'extension', external_id: 'devhash' };
  const extMsg = {
    from: 's@x.y', subject: 'Code', plain: 'your code 284913',
    bodyTokens: [{ type: 'text', value: 'your code 284913' }], links: [], attachments: [],
    otp: '284913', box: { localpart: 'lp', domain: 'mailbot.click', expires_at: 9_999_999_999 },
  };
  const r = await deliver(env, ctxCollect().ctx, extOwner, extMsg);
  assert.deepEqual(r, { delivered: true });
  const { messages } = await listMessages(env, 'ext:devhash', '');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].otp, '284913');
  assert.equal(messages[0].address, 'lp@mailbot.click');
});
