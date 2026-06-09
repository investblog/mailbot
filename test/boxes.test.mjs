// owner/box lifecycle на настоящем SQLite (через node:sqlite шим).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers/d1.mjs';
import { upsertOwner, ensureOwner, getOwnerById } from '../src/owners.js';
import {
  createBox, resolveBox, activeBoxes, enforceActiveLimit, extendBox, deleteBoxesForOwner,
} from '../src/boxes.js';

const future = 9_999_999_999;
const insertBox = (env, lp, dom, owner, created, exp = future) =>
  env.DB.prepare('INSERT INTO boxes (localpart,domain,owner_id,created_at,expires_at) VALUES (?,?,?,?,?)')
    .bind(lp, dom, owner, created, exp).run();

test('upsertOwner бампит sessions, ensureOwner — нет', async () => {
  const env = makeEnv();
  const o = await upsertOwner(env, 'telegram', 111, 'en');
  assert.equal(o.id, 'tg:111');
  assert.equal((await getOwnerById(env, 'tg:111')).sessions, 1);
  await upsertOwner(env, 'telegram', 111, 'ru');
  const row = await getOwnerById(env, 'tg:111');
  assert.equal(row.sessions, 2);
  assert.equal(row.locale, 'ru');
  await ensureOwner(env, 'telegram', 111, 'en');
  assert.equal((await getOwnerById(env, 'tg:111')).sessions, 2); // не изменилось
});

test('createBox → resolveBox отдаёт идентичность владельца', async () => {
  const env = makeEnv();
  await ensureOwner(env, 'telegram', 1, 'en');
  const b = await createBox(env, 'tg:1', 'mailbot.click', 24);
  const r = await resolveBox(env, b.localpart, 'mailbot.click');
  assert.equal(r.owner.id, 'tg:1');
  assert.equal(r.owner.kind, 'telegram');
  assert.equal(r.owner.external_id, '1');
});

test('domain — часть PK: один localpart на двух доменах = разные адреса', async () => {
  const env = makeEnv();
  await ensureOwner(env, 'telegram', 1);
  await ensureOwner(env, 'telegram', 2);
  await insertBox(env, 'samelp', 'mailbot.click', 'tg:1', 1);
  await insertBox(env, 'samelp', 'emailbot.ru', 'tg:2', 1);
  assert.equal((await resolveBox(env, 'samelp', 'mailbot.click')).owner.id, 'tg:1');
  assert.equal((await resolveBox(env, 'samelp', 'emailbot.ru')).owner.id, 'tg:2');
});

test('протухший box не резолвится', async () => {
  const env = makeEnv();
  await ensureOwner(env, 'telegram', 1);
  await insertBox(env, 'deadlp', 'mailbot.click', 'tg:1', 1, 1); // expires_at в прошлом
  assert.equal(await resolveBox(env, 'deadlp', 'mailbot.click'), null);
});

test('enforceActiveLimit сносит самые старые сверх лимита', async () => {
  const env = makeEnv();
  await ensureOwner(env, 'telegram', 1);
  await insertBox(env, 'a', 'mailbot.click', 'tg:1', 100);
  await insertBox(env, 'b', 'mailbot.click', 'tg:1', 200);
  await insertBox(env, 'c', 'mailbot.click', 'tg:1', 300); // самый новый
  const dropped = await enforceActiveLimit(env, 'tg:1', 2);   // keep = maxActive-1 = 1
  const left = await activeBoxes(env, 'tg:1');
  assert.equal(left.length, 1);
  assert.equal(left[0].localpart, 'c');
  assert.deepEqual(dropped, ['b@mailbot.click', 'a@mailbot.click']); // отключённые: новые→старые
});

test('extendBox двигает expires_at вперёд (owner-scoped)', async () => {
  const env = makeEnv();
  await ensureOwner(env, 'telegram', 1);
  await insertBox(env, 'x', 'mailbot.click', 'tg:1', 1, 1); // протух
  const exp = await extendBox(env, 'tg:1', 'x', 'mailbot.click', 24);
  assert.ok(exp > Math.floor(Date.now() / 1000));
  assert.ok((await resolveBox(env, 'x', 'mailbot.click')) !== null);
});

test('extendBox/deleteBox чужой адрес не трогают (ownership в SQL)', async () => {
  const env = makeEnv();
  await ensureOwner(env, 'telegram', 1);
  await ensureOwner(env, 'telegram', 2);
  await insertBox(env, 'mine', 'mailbot.click', 'tg:1', 1);
  // tg:2 пытается продлить/удалить чужой адрес
  assert.equal(await extendBox(env, 'tg:2', 'mine', 'mailbot.click', 24), null);
  const { deleteBox } = await import('../src/boxes.js');
  assert.equal(await deleteBox(env, 'tg:2', 'mine', 'mailbot.click'), false);
  assert.ok((await resolveBox(env, 'mine', 'mailbot.click')) !== null); // адрес жив
  // владелец удаляет свой
  assert.equal(await deleteBox(env, 'tg:1', 'mine', 'mailbot.click'), true);
  assert.equal(await resolveBox(env, 'mine', 'mailbot.click'), null);
});

test('deleteBoxesForOwner сносит все адреса владельца', async () => {
  const env = makeEnv();
  await ensureOwner(env, 'telegram', 1);
  await insertBox(env, 'a', 'mailbot.click', 'tg:1', 1);
  await insertBox(env, 'b', 'emailbot.ru', 'tg:1', 1);
  await deleteBoxesForOwner(env, 'tg:1');
  assert.equal((await activeBoxes(env, 'tg:1')).length, 0);
});
