// Delivery policy: success / permanent(403,400) / transient. fetch замокан, без сети.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/d1.mjs';
import { ensureOwner } from '../src/owners.js';
import { createBox, activeBoxes } from '../src/boxes.js';
import { deliver } from '../src/delivery.js';

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
