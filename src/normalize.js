// email-core: нормализация plain-text тела письма перед рендером.
// Чистит forwarded-заголовки, невидимый мусор, пустоты и markdown-звёздочки,
// и разбирает ссылки вида "Label <url>" / "Label (url)" в токены — чтобы render
// собрал безопасные <a href>, а не тащил сырой <https://...> в Telegram.
//
// normalizeBody(text) -> { tokens, plain }
//   tokens: [{type:'text', value} | {type:'link', label, href}]
//   plain:  очищенный текст (с label вместо ссылок, без href) — для extractOtp.

// Невидимые/служебные кодовые точки → удалить:
// soft hyphen, CGJ, zero-width (200B–200F), bidi (202A–202E), word-joiners (2060–206F), BOM.
const INVISIBLE = /[­͏​-‏‪-‮⁠-⁯﻿]/g;
// Экзотические пробелы (NBSP, figure/narrow/em-пробелы и пр.) → обычный пробел.
const WEIRD_SPACE = /[    -  　]/g;

const FWD_MARKER = /^[-\s]*(?:begin\s+)?forwarded\s+message[-\s]*$/i;
const HEADER_LINE = /^(?:Subject|Date|Sent|From|Reply-To|To|Cc|Bcc):/i;
const JUNK_LABEL = /\b(logo|illustration|icon|banner)\b/i;
const HAS_URL = /[<(]\s*https?:\/\/[^>)\s]+\s*[>)]/; // non-global: безопасно для .test()

const URL_BRACKET = /[<(]\s*(https?:\/\/[^>)\s]+)\s*[>)]/g;
export const LABEL_MAX = 80;

function stripInvisibles(s) {
  return s.replace(INVISIBLE, '').replace(WEIRD_SPACE, ' ');
}

// Декод HTML-сущностей, иногда попадающих в text/plain (&amp; &lt; &gt; &quot; &nbsp; числовые).
// Делаем ДО экранирования в render — иначе сущности удвоятся (&amp; → &amp;amp;).
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') {
      const code = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, k) ? NAMED_ENTITIES[k] : m;
  });
}

// *text* / **text** — снимаем эмфазис-звёздочки (Markdown мы не включаем).
function stripEmphasis(s) {
  return s.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/\*([^*\n]+)\*/g, '$1');
}

// Удалить блок "---- Forwarded message ----" + следующие за ним служебные заголовки.
function removeForwardedBlock(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (FWD_MARKER.test(lines[i].trim())) {
      i++;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t === '' || HEADER_LINE.test(t)) i++;
        else { i--; break; }
      }
      continue;
    }
    out.push(lines[i]);
  }
  return out;
}

const collapseSpaces = (s) => s.replace(/\s+/g, ' ').trim();
const tidyText = (s) => s.replace(/[^\S\n]{2,}/g, ' '); // схлопнуть кратные пробелы/табы, не трогая \n

// Граница label = ближайший текст перед URL. Жёсткие разделители (| \n двойной пробел/таб),
// затем мягкие (предложенческая пунктуация), затем кап по длине. Так label не захватывает
// всю строку/предложение (ТЗ §5). Точные anchor-метки дал бы HTML-парс — это можно добавить позже.
const LEADING_STOPWORD = /^(?:and|or|then|please|to)\s+/i;

function computeSplit(before) {
  // 1) последний жёсткий разделитель
  let cut = 0;
  for (const re of [/\|/g, /\n/g, / {2,}/g, /\t+/g]) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(before)) !== null) cut = Math.max(cut, m.index + m[0].length);
  }
  // 2) последняя предложенческая пунктуация в остатке
  const rest = before.slice(cut);
  let soft = 0;
  const re = /[.,:;!?]\s+/g;
  let m;
  while ((m = re.exec(rest)) !== null) soft = m.index + m[0].length;
  let labelStart = cut + soft;
  let label = collapseSpaces(before.slice(labelStart));
  label = label.replace(LEADING_STOPWORD, '');
  // 3) кап по длине (по границе слова)
  if (label.length > LABEL_MAX) {
    label = label.slice(label.length - LABEL_MAX).replace(/^\S*\s+/, '');
  }
  return [before.slice(0, labelStart), label];
}

function tokenizeLinks(text) {
  const tokens = [];
  let lastIndex = 0;
  for (const m of text.matchAll(URL_BRACKET)) {
    const href = m[1];
    const before = text.slice(lastIndex, m.index);
    const [pre, label] = computeSplit(before);
    if (pre) tokens.push({ type: 'text', value: pre });
    if (!JUNK_LABEL.test(label)) tokens.push({ type: 'link', label, href });
    // junk-ссылку (logo/illustration) просто дропаем вместе с label
    lastIndex = m.index + m[0].length;
  }
  const tail = text.slice(lastIndex);
  if (tail) tokens.push({ type: 'text', value: tail });
  for (const t of tokens) if (t.type === 'text') t.value = tidyText(t.value);
  return tokens;
}

function tokensToPlain(tokens) {
  return tokens.map((t) => (t.type === 'link' ? t.label : t.value)).join('');
}

export function normalizeBody(input) {
  let lines = stripInvisibles(decodeEntities(String(input || ''))).split(/\r?\n/);
  lines = removeForwardedBlock(lines);
  lines = lines.map((l) => stripEmphasis(l.trim()));
  // Дроп строк-картинок/логотипов ("stripe logo <url>", "invoice illustration <url>").
  lines = lines.filter((l) => !(JUNK_LABEL.test(l) && HAS_URL.test(l)));

  // Схлопнуть пустые строки: 3+ подряд → одна; срезать пустоту по краям.
  const collapsed = [];
  let blanks = 0;
  for (const l of lines) {
    if (l === '') { blanks++; if (blanks <= 1) collapsed.push(''); }
    else { blanks = 0; collapsed.push(l); }
  }
  while (collapsed.length && collapsed[0] === '') collapsed.shift();
  while (collapsed.length && collapsed[collapsed.length - 1] === '') collapsed.pop();

  const tokens = tokenizeLinks(collapsed.join('\n'));
  return { tokens, plain: tokensToPlain(tokens) };
}
