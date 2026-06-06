// Рендер сообщения: экранирование и контроль итоговой длины (< TG лимита).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEmail, TG_MSG_LIMIT } from '../src/render.js';

test('тело экранируется, сырые угловые скобки из письма не попадают как теги', () => {
  const out = renderEmail({
    from: 'a@b.c', subject: 'hi', body: 'x < y & z > w <script>', links: [], attachments: [],
  });
  assert.match(out, /&lt;/);
  assert.match(out, /&amp;/);
  assert.ok(!out.includes('<script>'));
});

test('OTP — первой строкой, жирным и в <code>', () => {
  const out = renderEmail({
    from: 'a@b.c', subject: 'code', body: 'body', links: [], attachments: [], otp: '123456',
  });
  assert.ok(out.startsWith('🔑 <b>123456</b>'));
  assert.match(out, /<code>123456<\/code>/);
});

test('subject экранируется (битый HTML из темы не ломает parse_mode)', () => {
  const out = renderEmail({
    from: 'a@b.c', subject: 'Order <b>#1</b> & co', body: 'b', links: [], attachments: [],
  });
  assert.match(out, /&lt;b&gt;#1&lt;\/b&gt;/);
  assert.match(out, /&amp; co/);
});

test('итог не превышает лимит при огромных subject/body/links/attachments', () => {
  const out = renderEmail({
    from: 'from@'.padEnd(5000, 'x'),
    subject: 'S'.repeat(5000),
    body: 'B'.repeat(200000),
    links: Array.from({ length: 50 }, (_, i) => 'https://example.com/' + 'p'.repeat(500) + i),
    attachments: Array.from({ length: 50 }, (_, i) => 'file' + i + '_'.repeat(500) + '.pdf'),
    otp: '999111',
  });
  assert.ok(out.length <= TG_MSG_LIMIT, `длина ${out.length} > ${TG_MSG_LIMIT}`);
  // заголовок с OTP уцелел (теги не разорваны обрезкой)
  assert.ok(out.startsWith('🔑 <b>999111</b>'));
});

test('пустое тело даёт плейсхолдер', () => {
  const out = renderEmail({ from: 'a@b', subject: 's', body: '', links: [], attachments: [] });
  assert.match(out, /пустое тело/);
});
