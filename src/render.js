// Сборка сообщения для Telegram. Гарантирует итоговую длину <= TG_MSG_LIMIT,
// чтобы длинный subject / много ссылок / вложений не дали 400 (после которого письмо дропается).
// HTML-теги ставим только сами (otp + <b>subject</b>); тело/ссылки/имена — escape'им.

import { esc } from './telegram.js';

export const TG_MSG_LIMIT = 4000; // < 4096, запас на эмодзи/служебку
const SUBJECT_MAX = 200;
const FROM_MAX = 120;
const LINK_MAX = 200;
const LINKS_MAX = 5;
const ATTACH_MAX = 10;
const ATTACH_NAME_MAX = 100;

const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

export function renderEmail({ from, subject, body, links, otp, attachments }) {
  // Заголовок (с тегами) — всегда сохраняем целиком, поэтому subject жёстко ограничен.
  const head = [];
  if (otp) head.push(`🔑 <b>${esc(otp)}</b>  <code>${esc(otp)}</code>`);
  head.push(`<b>${esc(clip(String(subject || '(без темы)'), SUBJECT_MAX))}</b>`);
  head.push(`от: ${esc(clip(String(from || ''), FROM_MAX))}`);

  // Подвал: ссылки + вложения, тоже ограничены по числу и длине.
  const foot = [];
  const ls = (links || []).slice(0, LINKS_MAX).map((l) => esc(clip(String(l), LINK_MAX)));
  if (ls.length) foot.push('', '🔗 ссылки:', ...ls);
  const as = (attachments || []).slice(0, ATTACH_MAX);
  if (as.length) {
    foot.push('');
    for (const a of as) foot.push(`📎 ${esc(clip(String(a), ATTACH_NAME_MAX))}`);
  }

  const headStr = head.join('\n');
  const footStr = foot.join('\n');

  // Тело получает остаток бюджета. Режем тело (а не итог), чтобы не разорвать теги в head.
  const reserved = headStr.length + footStr.length + 4; // \n-разделители
  const budget = Math.max(0, TG_MSG_LIMIT - reserved);
  let bodyStr = esc(String(body || '(пустое тело)'));
  if (bodyStr.length > budget) bodyStr = bodyStr.slice(0, Math.max(0, budget - 1)) + '…';

  let out = `${headStr}\n\n${bodyStr}`;
  if (footStr) out += `\n${footStr}`;
  // Страховка: если head+foot сами по себе огромны — финальный clamp (теги уже целостны выше).
  if (out.length > TG_MSG_LIMIT) out = out.slice(0, TG_MSG_LIMIT);
  return out;
}
