// Сборка сообщения для Telegram. Гарантирует итоговую длину <= TG_MSG_LIMIT,
// чтобы длинный subject / много ссылок / вложений не дали 400 (после которого письмо дропается).
// HTML-теги ставим только сами (otp + <b>subject</b>); всё пользовательское — escape'им.

export const TG_MSG_LIMIT = 4000; // < 4096, запас на эмодзи/служебку
const SUBJECT_MAX = 200;
const FROM_MAX = 120;
const LINK_MAX = 200;
const LINKS_MAX = 5;
const ATTACH_MAX = 10;
const ATTACH_NAME_MAX = 100;
const OTP_MAX = 32;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escAttr = (s) => String(s).replace(/[&<>"]/g, (c) => (c === '"' ? '&quot;' : ESC[c]));

// Экранирует и обрезает по ИТОГОВОЙ (escaped) длине, посимвольно — никогда не разрезая entity.
// Это закрывает класс бага «срез внутри &lt;/&amp; → malformed HTML → Telegram 400 → дроп письма».
function escClip(raw, max) {
  if (max <= 0) return '';
  let out = '';
  for (const ch of String(raw)) {
    const e = ESC[ch] || ch;
    if (out.length + e.length > max) {
      // Усечение. Многоточие добавляем, только если оно само влезает в max (иначе строго ≤ max).
      return out.length + 1 <= max ? out + '…' : out;
    }
    out += e;
  }
  return out;
}

// Только http(s) — никаких javascript:/data: в href.
function safeHref(href) {
  return /^https?:\/\//i.test(String(href || '')) ? String(href) : null;
}
function hostOf(href) {
  const m = String(href).match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1] : href;
}

// Рендер тела из токенов normalize.js: текст — escape с бюджетом, ссылки — наши <a href>.
// Сами строим единственные разрешённые теги <a>; сырой <https://...> в сообщение не попадает.
function renderBody(tokens, budget) {
  let out = '';
  for (const tok of tokens) {
    const remaining = budget - out.length;
    if (remaining <= 0) break;
    if (tok.type === 'link') {
      const href = safeHref(tok.href);
      if (!href) { out += escClip(tok.label || '', remaining); continue; }
      let label = (tok.label || '').trim() || hostOf(href);
      if (label.length > 80) label = label.slice(0, 80);
      const seg = `<a href="${escAttr(href)}">${escClip(label, 80)}</a>`;
      if (seg.length <= remaining) out += seg; // ссылка атомарна: влезла — добавили, нет — стоп
      else break;
    } else {
      out += escClip(tok.value, remaining);
    }
  }
  return out;
}

export function renderEmail({ from, subject, bodyTokens, body, links, otp, attachments }) {
  // Заголовок (с тегами) — сохраняем целиком, поэтому каждое поле ограничено по escaped-длине.
  const head = [];
  if (otp) head.push(`🔑 <b>${escClip(otp, OTP_MAX)}</b>  <code>${escClip(otp, OTP_MAX)}</code>`);
  head.push(`<b>${escClip(subject || '(без темы)', SUBJECT_MAX)}</b>`);
  head.push(`от: ${escClip(from || '', FROM_MAX)}`);

  // Подвал: ссылки + вложения, ограничены по числу и escaped-длине.
  const foot = [];
  const ls = (links || []).slice(0, LINKS_MAX).map((l) => escClip(l, LINK_MAX));
  if (ls.length) foot.push('', '🔗 ссылки:', ...ls);
  const as = (attachments || []).slice(0, ATTACH_MAX);
  if (as.length) {
    foot.push('');
    for (const a of as) foot.push(`📎 ${escClip(a, ATTACH_NAME_MAX)}`);
  }

  const headStr = head.join('\n');
  const footStr = foot.join('\n');

  // Тело получает остаток бюджета. Токены (text/link) рендерим entity-safe; ссылки атомарны.
  // Все части ограничены по длине, поэтому итог ≤ TG_MSG_LIMIT по конструкции — clamp не нужен.
  const reserved = headStr.length + footStr.length + 3; // \n\n + \n
  const budget = Math.max(0, TG_MSG_LIMIT - reserved);
  // bodyTokens — основной путь; body-строка оставлена для обратной совместимости/тестов.
  const tokens = bodyTokens && bodyTokens.length
    ? bodyTokens
    : [{ type: 'text', value: body || '(пустое тело)' }];
  const bodyStr = renderBody(tokens, budget) || escClip('(пустое тело)', budget);

  let out = `${headStr}\n\n${bodyStr}`;
  if (footStr) out += `\n${footStr}`;
  return out;
}
