// Acceptance-контракт OTP-экстрактора. Запуск: `npm test` (node --test, без зависимостей).
// Принцип: лучше тишина (null), чем неверный код. Эти кейсы ОБЯЗАНЫ проходить.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractOtp } from '../src/otp.js';

// [subject, body, expected]
const MUST_DETECT = [
  ['Your verification code', 'Your code is 284913. It expires in 10 minutes.', '284913'],
  ['Sign in to Acme', 'Enter G-558210 to continue', '558210'],
  ['Код подтверждения', 'Ваш проверочный код: 4471', '4471'],
  ['Confirm your email', 'Use code 12 34 56 to verify', '123456'],
  ['Подтвердите вход', 'Код для входа: 905 112', '905112'],
  ['Your one-time passcode', 'A1B2C3 is your login token', 'A1B2C3'],
];

// Должны вернуть null — иначе показали бы мусор как код.
const MUST_IGNORE = [
  ['Newsletter', 'Our 2024 report is out. Call +1 415 555 0199 for $1,299.00 deals', 'phone/сумма/год'],
  ['Receipt #88213', 'Your order total was $42.50 on 2025-06-01 at 14:35', 'сумма/дата/время'],
  ['Welcome', 'No code here, just hi', 'нет кода'],
  ['Meeting', 'See you at 14:30 tomorrow', 'время'],
];

for (const [subject, body, expected] of MUST_DETECT) {
  test(`detect: ${subject}`, () => {
    assert.equal(extractOtp(subject, body), expected);
  });
}

for (const [subject, body, why] of MUST_IGNORE) {
  test(`ignore (${why}): ${subject}`, () => {
    assert.equal(extractOtp(subject, body), null);
  });
}
