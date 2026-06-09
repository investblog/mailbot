// Нормализация тела + безопасные TG-ссылки. Два реальных класса писем + инварианты.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBody } from '../src/normalize.js';
import { extractOtp } from '../src/otp.js';
import { renderEmail, TG_MSG_LIMIT } from '../src/render.js';

const linkLabels = (toks) => toks.filter((t) => t.type === 'link').map((t) => t.label);
const linkByHrefIncludes = (toks, sub) => toks.find((t) => t.type === 'link' && t.href.includes(sub));

// Общие инварианты итогового HTML-сообщения.
function assertSafe(out) {
  assert.ok(out.length <= TG_MSG_LIMIT, `длина ${out.length} > ${TG_MSG_LIMIT}`);
  assert.ok(!/&(?!(amp|lt|gt|quot);)/.test(out), 'оборванная HTML entity');
  // никаких сырых <url> и чужих тегов — только наши <b> <code> <a ...> </a>
  assert.ok(!/&lt;https?:/i.test(out), 'сырой <url> в сообщении');
  assert.ok(!/<(?!\/?(?:b|code|a)(?:\s|>|$))/i.test(out), 'чужой/непостроенный тег');
}

test('Anthropic/Stripe receipt forward: чистка + ссылки', () => {
  const raw = [
    '---------- Forwarded message ---------',
    'From: Anthropic <receipts@anthropic.com>',
    'Date: Mon, 2 Jun 2026 10:00:00 +0000',
    'Subject: Your receipt from Anthropic',
    'To: user@example.com',
    '',
    '​Receipt from Anthropic­',
    '',
    '',
    '',
    'invoice illustration <https://stripe.com/img/illustration.png>',
    '',
    'Amount paid $20.00',
    '',
    'Download invoice <https://pay.stripe.com/invoice/abc/pdf>',
    'Download receipt <https://pay.stripe.com/receipt/xyz/pdf>',
    '',
    'stripe logo <https://stripe.com/img/logo.png>',
  ].join('\n');

  const { tokens, plain } = normalizeBody(raw);

  // forwarded headers удалены
  assert.ok(!/Forwarded message/i.test(plain));
  assert.ok(!/^Subject:/m.test(plain));
  assert.ok(!/^From:/m.test(plain));
  // invisibles удалены
  assert.ok(!/[​­]/.test(plain));
  // нет 3+ пустых строк подряд
  assert.ok(!/\n{3,}/.test(plain));
  // полезные ссылки распознаны
  assert.ok(linkByHrefIncludes(tokens, 'invoice/abc/pdf'), 'нет invoice-ссылки');
  assert.ok(linkByHrefIncludes(tokens, 'receipt/xyz/pdf'), 'нет receipt-ссылки');
  // мусорные illustration/logo дропнуты
  assert.ok(!linkByHrefIncludes(tokens, 'illustration.png'), 'illustration не дропнут');
  assert.ok(!linkByHrefIncludes(tokens, 'logo.png'), 'logo не дропнут');

  const out = renderEmail({ from: 'user@example.com', subject: 'Fwd: receipt', bodyTokens: tokens, attachments: ['invoice.pdf'] });
  assertSafe(out);
  assert.match(out, /<a href="https:\/\/pay\.stripe\.com\/invoice\/abc\/pdf">/);
  assert.match(out, /📎 invoice\.pdf/);
});

test('Cloudflare login token forward: OTP + ссылки + footer', () => {
  const subject = 'Fwd: Your Cloudflare login token: 7064094';
  const raw = [
    '7064094',
    '',
    '---------- Forwarded message ---------',
    'From: Cloudflare <noreply@notify.cloudflare.com>',
    'Date: Mon, 2 Jun 2026 09:00:00 +0000',
    'Subject: Your Cloudflare login token: 7064094',
    'To: user@example.com',
    '',
    '*Your Cloudflare login token*',
    '',
    'A new login attempt was made to access the Cloudflare account for user@example.com.',
    '',
    'Was this you? Enter this token on the challenge page:',
    '',
    '7064094',
    '',
    "If this wasn't you, please immediately change your password <https://dash.cloudflare.com/profile> and set up two-factor authentication <https://dash.cloudflare.com/profile/auth>.",
    '',
    'www.cloudflare.com <https://www.cloudflare.com/> | Community <https://community.cloudflare.com/>',
    'Facebook <https://www.facebook.com/Cloudflare/> X <https://x.com/Cloudflare> LinkedIn <https://www.linkedin.com/company/cloudflare>',
  ].join('\n');

  const { tokens, plain } = normalizeBody(raw);

  // OTP по нормализованному plain
  assert.equal(extractOtp(subject, plain), '7064094');
  assert.ok(plain.startsWith('7064094'));
  // forwarded headers удалены, markdown-звёздочки сняты
  assert.ok(!/Forwarded message/i.test(plain));
  assert.ok(!/\*/.test(plain), 'остались звёздочки');
  // body-ссылки кликабельны (label — не вся строка)
  const pwd = linkByHrefIncludes(tokens, '/profile');
  assert.ok(pwd && /change your password/.test(pwd.label));
  assert.ok(!/If this wasn't you/.test(pwd.label), 'label захватил всё предложение');
  const twofa = linkByHrefIncludes(tokens, '/profile/auth');
  assert.ok(twofa && /set up two-factor authentication/.test(twofa.label));
  // footer-ссылки без захвата лишнего
  const labels = linkLabels(tokens);
  for (const l of ['www.cloudflare.com', 'Community', 'Facebook', 'X', 'LinkedIn']) {
    assert.ok(labels.includes(l), `нет чистой footer-метки: ${l}`);
  }

  const out = renderEmail({ from: 'user@example.com', subject, bodyTokens: tokens, otp: '7064094' });
  assertSafe(out);
  assert.ok(out.startsWith('🔑 <b>7064094</b>'));
  assert.match(out, /<a href="https:\/\/dash\.cloudflare\.com\/profile">/);
});

test('HTML-сущности в plain декодируются (не удваиваются при экранировании)', () => {
  const { plain, tokens } = normalizeBody('Use &lt;minsize=2&gt; and A &amp; B');
  assert.equal(plain, 'Use <minsize=2> and A & B');
  const out = renderEmail({ from: 'a@b', subject: 's', bodyTokens: tokens });
  assert.match(out, /&lt;minsize=2&gt;/);     // одинарно экранировано
  assert.ok(!/&amp;lt;/.test(out), 'двойное экранирование сущности');
});

test('URL в скобках с пробелами тоже распознаётся', () => {
  const { tokens } = normalizeBody('Proudly sent via Groove ( https://www.groovehq.com?a=1&amp;b=2 )');
  const link = tokens.find((t) => t.type === 'link');
  assert.ok(link && link.href === 'https://www.groovehq.com?a=1&b=2', 'parens-url не распознан');
  const out = renderEmail({ from: 'a@b', subject: 's', bodyTokens: tokens });
  assert.match(out, /<a href="https:\/\/www\.groovehq\.com\?a=1&amp;b=2">/);
});

test('javascript: href не превращается в ссылку', () => {
  const out = renderEmail({
    from: 'a@b', subject: 's',
    bodyTokens: [{ type: 'link', label: 'click', href: 'javascript:alert(1)' }],
  });
  assert.ok(!/<a /.test(out), 'небезопасный href стал ссылкой');
  assert.match(out, /click/);
});
