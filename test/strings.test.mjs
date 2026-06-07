// Двуязычие клиента: выбор языка по локали + локализованные подписи письма.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { langOf, strings, fmt } from '../src/strings.js';
import { renderEmail } from '../src/render.js';

test('langOf: ru* → ru, остальное → en', () => {
  assert.equal(langOf('ru'), 'ru');
  assert.equal(langOf('ru-RU'), 'ru');
  assert.equal(langOf('RU'), 'ru');
  assert.equal(langOf('en'), 'en');
  assert.equal(langOf('en-US'), 'en');
  assert.equal(langOf('de'), 'en');
  assert.equal(langOf(undefined), 'en');
  assert.equal(langOf(null), 'en');
});

test('строки различаются по языку', () => {
  assert.equal(strings('ru').btnNew, 'Новый адрес');
  assert.equal(strings('en').btnNew, 'New address');
  assert.notEqual(strings('ru').help, strings('en').help);
});

test('fmt подставляет переменные', () => {
  assert.equal(fmt('go {url} now', { url: 'X' }), 'go X now');
});

test('подписи письма локализованы по lang', () => {
  const ru = renderEmail({ from: 'a@b', subject: 's', body: 'hi', lang: 'ru' });
  const en = renderEmail({ from: 'a@b', subject: 's', body: 'hi', lang: 'en' });
  assert.match(ru, /\nот: a@b/);
  assert.match(en, /\nfrom: a@b/);
});

test('нет subject → локализованный плейсхолдер', () => {
  assert.match(renderEmail({ from: 'a@b', body: 'x', lang: 'ru' }), /<b>\(без темы\)<\/b>/);
  assert.match(renderEmail({ from: 'a@b', body: 'x', lang: 'en' }), /<b>\(no subject\)<\/b>/);
});
