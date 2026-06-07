// Клиент: Telegram-бот поверх email-core. Команды /start /new /help + кнопки.
// Маппит Telegram chat_id → owner(kind='telegram'); язык UI — по locale (language_code).

import { config } from './config.js';
import { activeBoxes, extendBox, provisionBox } from './boxes.js';
import { upsertOwner, ensureOwner } from './owners.js';
import { sendMessage, answerCallback, keyboard, esc } from './telegram.js';
import { strings, fmt } from './strings.js';

const KIND = 'telegram';

function kb(s) {
  return keyboard([
    [{ text: s.btnNew, callback_data: 'new' }, { text: s.btnExtend, callback_data: 'extend' }],
    [{ text: s.btnHelp, callback_data: 'help' }],
  ]);
}

function fmtAddress(s, address, expiresAt) {
  const hours = Math.max(0, Math.round((expiresAt - Date.now() / 1000) / 3600));
  return fmt(s.address, { addr: esc(address), h: hours });
}

// Создаёт адрес для владельца (общая core-логика). null если упёрлись в rate-limit на /new.
const newAddress = (env, cfg, owner, locale) => provisionBox(env, cfg, owner, locale);

export async function handleUpdate(update, env) {
  const cfg = config(env);
  if (update.callback_query) return handleCallback(update.callback_query, env, cfg);
  if (update.message) return handleMessage(update.message, env, cfg);
}

async function handleMessage(msg, env, cfg) {
  const chatId = msg.chat?.id;
  if (!chatId) return;
  const text = (msg.text || '').trim();
  const locale = msg.from?.language_code;
  const s = strings(locale);

  if (text.startsWith('/start')) {
    const owner = await upsertOwner(env, KIND, chatId, locale); // /start = заход, +session
    const active = await activeBoxes(env, owner.id);
    if (active.length) {
      const b = active[0];
      return sendMessage(env, chatId, fmtAddress(s, `${b.localpart}@${b.domain}`, b.expires_at), kb(s));
    }
    const box = await newAddress(env, cfg, owner, locale);
    if (!box) return sendMessage(env, chatId, s.rlMsg, kb(s));
    return sendMessage(env, chatId, fmtAddress(s, box.address, box.expires_at), kb(s));
  }

  if (text.startsWith('/new')) {
    const owner = await ensureOwner(env, KIND, chatId, locale); // без +session
    const box = await newAddress(env, cfg, owner, locale);
    if (!box) return sendMessage(env, chatId, s.rlMsg, kb(s));
    return sendMessage(env, chatId, fmtAddress(s, box.address, box.expires_at), kb(s));
  }

  if (text.startsWith('/help')) return sendMessage(env, chatId, s.help, kb(s));

  return sendMessage(env, chatId, s.cmds, kb(s));
}

async function handleCallback(cq, env, cfg) {
  const chatId = cq.message?.chat?.id;
  const data = cq.data;
  if (!chatId) return answerCallback(env, cq.id);
  const locale = cq.from?.language_code;
  const s = strings(locale);

  if (data === 'new') {
    const owner = await ensureOwner(env, KIND, chatId, locale);
    const box = await newAddress(env, cfg, owner, locale);
    if (!box) {
      await sendMessage(env, chatId, s.rlMsg, kb(s));
      return answerCallback(env, cq.id, s.limit);
    }
    await sendMessage(env, chatId, fmtAddress(s, box.address, box.expires_at), kb(s));
    return answerCallback(env, cq.id, s.okNew);
  }

  if (data === 'extend') {
    const owner = await ensureOwner(env, KIND, chatId, locale);
    const active = await activeBoxes(env, owner.id);
    if (!active.length) {
      await sendMessage(env, chatId, s.noActive, kb(s));
      return answerCallback(env, cq.id);
    }
    const b = active[0];
    const exp = await extendBox(env, owner.id, b.localpart, b.domain, cfg.ttlHours);
    await sendMessage(env, chatId, fmtAddress(s, `${b.localpart}@${b.domain}`, exp || b.expires_at), kb(s));
    return answerCallback(env, cq.id, s.okExtend);
  }

  if (data === 'help') {
    await sendMessage(env, chatId, s.help, kb(s));
    return answerCallback(env, cq.id);
  }

  return answerCallback(env, cq.id);
}
