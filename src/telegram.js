// Telegram Bot API через обычный fetch. parse_mode: HTML.
// Безопасность: теги ставим сами (код без спецсимволов), тело письма экранируем.

const API = 'https://api.telegram.org/bot';
const MAX_ATTEMPTS = 3;        // best-effort ретрай в пределах вызова
const MAX_RETRY_AFTER = 5;     // сек: дольше ждать не имеет смысла в рамках запроса

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTransient = (status) => status === 0 || status === 429 || status >= 500;

// В Email Workers нет SMTP-transient/retry — поэтому транзиентные сбои TG
// (429/5xx/сеть) добиваем ретраем здесь же. Постоянные (400/403) не ретраим.
async function call(env, method, payload) {
  let last = { ok: false, status: 0 };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(`${API}${env.TG_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error(`TG ${method} network error (try ${attempt}): ${e}`);
      last = { ok: false, status: 0 };
      if (attempt < MAX_ATTEMPTS) { await sleep(300 * attempt); continue; }
      return last;
    }
    if (res.ok) return { ok: true, status: res.status };

    const detail = await res.text().catch(() => '');
    console.error(`TG ${method} ${res.status} (try ${attempt}): ${detail}`);
    last = { ok: false, status: res.status };
    if (!isTransient(res.status) || attempt === MAX_ATTEMPTS) return last;

    // 429: уважаем Retry-After, если он разумный.
    let wait = 300 * attempt;
    const ra = Number(res.headers.get('retry-after'));
    if (res.status === 429 && ra > 0) {
      if (ra > MAX_RETRY_AFTER) return last; // ждать слишком долго — отдаём как сбой
      wait = ra * 1000;
    }
    await sleep(wait);
  }
  return last;
}

export function sendMessage(env, chatId, text, opts = {}) {
  return call(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...opts,
  });
}

export function answerCallback(env, id, text) {
  return call(env, 'answerCallbackQuery', { callback_query_id: id, text: text || '' });
}

// Инлайн-клавиатура под сообщением бота.
export function keyboard(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}
