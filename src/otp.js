// OTP-экстрактор: скоринг кандидатов, не «первое число».
// Порог SCORE_THRESHOLD — ниже него код НЕ показываем (лучше тишина, чем неверный код).

const SCORE_THRESHOLD = 4;

// Ключевые слова рядом с кодом. EN + RU.
const KEYWORDS = /(code|codes|verif\w*|otp|one[\s-]?time|pass\s?code|passwords?|\bpin\b|token|confirm\w*|secur\w*|authentic\w*|\blog[\s-]?in\b|sign[\s-]?in|\b2fa\b|\bmfa\b|код\w*|пароль|подтвержд\w*|подтверд\w*|вход\w*|проверочн\w*|одноразов\w*)/i;

export function extractOtp(subject, body) {
  const subj = (subject || '').trim();
  const text = subj + '\n' + (body || '');
  const subjLen = subj.length + 1;

  const candidates = [];
  const push = (value, index, raw, flags) =>
    candidates.push({ value, index, raw, ...flags });

  // Провайдерский паттерн Google: G-123456
  for (const m of text.matchAll(/\bG-(\d{6})\b/g)) push(m[1], m.index, m[0], { provider: true });
  // Сгруппированный код: 123 456 / 12 34 56 / 123-456 (макс. run групп)
  for (const m of text.matchAll(/\b\d{1,4}(?:[\s-]\d{1,4}){1,4}\b/g)) {
    const groups = m[0].split(/[\s-]/);
    const joined = groups.join('');
    if (joined.length < 4 || joined.length > 10) continue;
    push(joined, m.index, m[0], {
      spaced: true,
      groupCount: groups.length,
      maxGroup: Math.max(...groups.map((g) => g.length)),
    });
  }
  // Чистые цифры 4–8
  for (const m of text.matchAll(/\b\d{4,8}\b/g)) push(m[0], m.index, m[0], {});
  // Буквенно-цифровые коды 6–8 (есть и буква, и цифра), напр. A1B2C3
  for (const m of text.matchAll(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,8}\b/g))
    push(m[0], m.index, m[0], { alnum: true });

  let best = null;
  for (const c of candidates) {
    const s = score(c, text, subjLen);
    if (!best || s > best.score) best = { value: c.value, score: s };
  }
  return best && best.score >= SCORE_THRESHOLD ? best.value : null;
}

function score(c, text, subjLen) {
  let s = 0;
  const v = c.value;
  const before = text.slice(Math.max(0, c.index - 80), c.index).toLowerCase();
  const near = text.slice(Math.max(0, c.index - 48), c.index).toLowerCase();
  const tail = text.slice(c.index, c.index + c.raw.length + 4);
  const lead = text.slice(Math.max(0, c.index - 3), c.index);

  // Формат
  if (c.provider) s += 4;
  else if (c.spaced) s += 2;
  if (c.alnum) s += 2;
  else if (v.length === 6) s += 2;
  else if (v.length >= 4 && v.length <= 8) s += 1;

  // Сгруппированное похоже на телефон: длинно / 4-значная группа / +код страны рядом.
  if (c.spaced) {
    if (v.length >= 9) s -= 4;
    if (c.maxGroup >= 4) s -= 3;
    if (/\+\d?\s?$/.test(before)) s -= 4;
  }

  // Близость к ключевому слову
  if (KEYWORDS.test(near)) s += 3;
  else if (KEYWORDS.test(before)) s += 1;

  // Позиция: субджект и начало тела весят больше
  if (c.index < subjLen) s += 2;
  else if (c.index < subjLen + 200) s += 1;

  // Анти-паттерны (только для чисто числовых)
  if (!c.alnum) {
    const n = Number(v);
    if (v.length === 4 && n >= 1900 && n <= 2099) s -= 3;            // год
    if (/^[:.]\d/.test(tail.slice(v.length)) || /\d[:.]$/.test(lead)) s -= 2; // время/дата HH:MM
    if (/[$€£₽]\s?$/.test(before) || /^[.,]\d{2}\b/.test(tail.slice(v.length))) s -= 3; // сумма
    if (v.length >= 9) s -= 3;                                        // длинно — телефон/id
    if (/\+\s?$/.test(before)) s -= 4;                               // +7… телефон
  }
  return s;
}
