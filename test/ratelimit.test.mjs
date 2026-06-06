// Abuse-проверки на фейковом KV (TTL игнорируем — проверяем счётную логику).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDenied, hitLimit, addressLimited, newBoxLimited } from '../src/ratelimit.js';

function fakeKV() {
  const m = new Map();
  return {
    store: m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
  };
}

test('isDenied: пусто → false, есть ключ → true', async () => {
  const env = { RL: fakeKV() };
  assert.equal(await isDenied(env, 'a@b.c'), false);
  assert.equal(await isDenied(env, ''), false);
  env.RL.store.set('deny:spam@x.y', '1');
  assert.equal(await isDenied(env, 'spam@x.y'), true);
});

test('hitLimit: первые N — false, далее — true', async () => {
  const env = { RL: fakeKV() };
  assert.equal(await hitLimit(env, 'k', 2, 60), false);
  assert.equal(await hitLimit(env, 'k', 2, 60), false);
  assert.equal(await hitLimit(env, 'k', 2, 60), true);
  assert.equal(await hitLimit(env, 'k', 2, 60), true);
});

test('addressLimited уважает cfg.rlPerHour', async () => {
  const env = { RL: fakeKV() };
  const cfg = { rlPerHour: 1 };
  assert.equal(await addressLimited(env, cfg, 'x@d'), false);
  assert.equal(await addressLimited(env, cfg, 'x@d'), true);
  // другой адрес — свой счётчик
  assert.equal(await addressLimited(env, cfg, 'y@d'), false);
});

test('newBoxLimited: часовой лимит', async () => {
  const env = { RL: fakeKV() };
  const cfg = { newPerHour: 2, newPerDay: 100 };
  assert.equal(await newBoxLimited(env, cfg, 7), false);
  assert.equal(await newBoxLimited(env, cfg, 7), false);
  assert.equal(await newBoxLimited(env, cfg, 7), true);
});

test('newBoxLimited: суточный лимит срабатывает раньше часового и не съедает часовой', async () => {
  const env = { RL: fakeKV() };
  const cfg = { newPerHour: 100, newPerDay: 2 };
  assert.equal(await newBoxLimited(env, cfg, 9), false);
  assert.equal(await newBoxLimited(env, cfg, 9), false);
  assert.equal(await newBoxLimited(env, cfg, 9), true);
  // часовой счётчик не должен был инкрементиться на заблокированной попытке
  assert.equal(Number(env.RL.store.get('new:h:9')), 2);
});
