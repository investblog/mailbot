// Промо Catchall в момент лимита: флаг, частота (KV), канал, fail-closed, атрибуция.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitPromo } from '../src/promo.js';
import { strings } from '../src/strings.js';
import { config } from '../src/config.js';

function fakeKV() {
  const m = new Map();
  return {
    store: m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
  };
}

const owner = { id: 'tg:42', kind: 'telegram' };
const s = strings('ru');

test('config: CATCHALL_PROMO выключен по умолчанию, включается только "on"', () => {
  assert.equal(config({}).catchallPromo, false);
  assert.equal(config({ CATCHALL_PROMO: 'off' }).catchallPromo, false);
  assert.equal(config({ CATCHALL_PROMO: 'on' }).catchallPromo, true);
  assert.equal(config({ CATCHALL_PROMO: 'ON' }).catchallPromo, true);
  assert.equal(config({}).catchallBase, 'https://catchall.in/');
});

test('limitPromo: с выключенным флагом — тишина, KV не трогаем', async () => {
  const env = { RL: fakeKV() };
  const cfg = config({});
  assert.equal(await limitPromo(env, cfg, owner, s, 'rate'), null);
  assert.equal(env.RL.store.size, 0);
});

test('limitPromo: включён → текст + URL-кнопка с атрибуцией; повтор в сутки — тишина', async () => {
  const env = { RL: fakeKV() };
  const cfg = config({ CATCHALL_PROMO: 'on' });
  const p = await limitPromo(env, cfg, owner, s, 'rate');
  assert.ok(p);
  assert.equal(p.text, s.promoLimit);
  assert.equal(p.button.text, s.btnCatchall);
  assert.equal(p.button.url,
    'https://catchall.in/?utm_source=gotemailbot&utm_medium=bot&utm_campaign=limit_rate&cid=tg%3A42');
  // второй раз в пределах TTL — null (ключ уже стоит)
  assert.equal(await limitPromo(env, cfg, owner, s, 'evict'), null);
  assert.equal(env.RL.store.get('promo:limit:tg:42'), '1');
});

test('limitPromo: reason уходит в utm_campaign', async () => {
  const env = { RL: fakeKV() };
  const cfg = config({ CATCHALL_PROMO: 'on', CATCHALL_BASE: 'https://x.test/' });
  const p = await limitPromo(env, cfg, owner, s, 'evict');
  assert.match(p.button.url, /^https:\/\/x\.test\/\?.*utm_campaign=limit_evict&/);
});

test('limitPromo: только telegram-владельцы', async () => {
  const env = { RL: fakeKV() };
  const cfg = config({ CATCHALL_PROMO: 'on' });
  assert.equal(await limitPromo(env, cfg, { id: 'ext:1', kind: 'extension' }, s, 'rate'), null);
  assert.equal(await limitPromo(env, cfg, null, s, 'rate'), null);
});

test('limitPromo: сбой KV → fail-closed (не показываем)', async () => {
  const env = { RL: { async get() { throw new Error('kv down'); }, async put() {} } };
  const cfg = config({ CATCHALL_PROMO: 'on' });
  assert.equal(await limitPromo(env, cfg, owner, s, 'rate'), null);
});

test('строки промо есть в обоих языках и содержат Catchall, без домена', () => {
  for (const l of ['ru', 'en']) {
    const t = strings(l);
    assert.match(t.promoLimit, /Catchall/);
    assert.doesNotMatch(t.promoLimit, /catchall\.in/);
    assert.match(t.btnCatchall, /Catchall/);
  }
});
