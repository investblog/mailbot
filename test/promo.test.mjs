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
  assert.equal(config({}).catchallBot, 'allinmailbot');
});

test('limitPromo: с выключенным флагом — тишина, KV не трогаем', async () => {
  const env = { RL: fakeKV() };
  const cfg = config({});
  assert.equal(await limitPromo(env, cfg, owner, s, 'rate'), null);
  assert.equal(env.RL.store.size, 0);
});

test('limitPromo: включён → текст + кнопка-deep-link на бота с атрибуцией в start; повтор в сутки — тишина', async () => {
  const env = { RL: fakeKV() };
  const cfg = config({ CATCHALL_PROMO: 'on' });
  const p = await limitPromo(env, cfg, owner, s, 'rate');
  assert.ok(p);
  assert.equal(p.text, s.promoLimit);
  assert.equal(p.button.text, s.btnCatchall);
  assert.equal(p.button.url, 'https://t.me/allinmailbot?start=mb_rate_tg_42');
  // второй раз в пределах TTL — null (ключ уже стоит)
  assert.equal(await limitPromo(env, cfg, owner, s, 'evict'), null);
  assert.equal(env.RL.store.get('promo:limit:tg:42'), '1');
});

test('limitPromo: reason и бот уходят в deep link; payload в алфавите Telegram и ≤ 64', async () => {
  const env = { RL: fakeKV() };
  const cfg = config({ CATCHALL_PROMO: 'on', CATCHALL_BOT: 'xbot' });
  const p = await limitPromo(env, cfg, owner, s, 'evict');
  assert.equal(p.button.url, 'https://t.me/xbot?start=mb_evict_tg_42');
  const long = await limitPromo({ RL: fakeKV() }, cfg, { id: 'tg:' + '9'.repeat(80), kind: 'telegram' }, s, 'rate');
  const payload = new URL(long.button.url).searchParams.get('start');
  assert.match(payload, /^[A-Za-z0-9_-]{1,64}$/);
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
    assert.match(t.btnCatchall, /@allinmailbot/);
    assert.match(t.promoLimit, /@allinmailbot/);
  }
});
