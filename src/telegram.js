// Telegram Bot API через обычный fetch. parse_mode: HTML.
// Безопасность: теги ставим сами (код без спецсимволов), тело письма экранируем.

const API = 'https://api.telegram.org/bot';

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function call(env, method, payload) {
  const res = await fetch(`${API}${env.TG_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`TG ${method} ${res.status}: ${detail}`);
  }
  return res;
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
