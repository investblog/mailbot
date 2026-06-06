// Вебхук Telegram: команды /start /new /help и кнопки. Тон сухой, инженерный.

import { config, pickDomain } from './config.js';
import {
  createBox, activeBoxes, enforceActiveLimit, extendBox,
  touchUser, getUser, incUser,
} from './boxes.js';
import { sendMessage, answerCallback, keyboard, esc } from './telegram.js';
import { newBoxLimited } from './ratelimit.js';

const KB = keyboard([
  [{ text: 'Новый адрес', callback_data: 'new' }, { text: 'Продлить', callback_data: 'extend' }],
  [{ text: 'Помощь', callback_data: 'help' }],
]);

function fmtAddress(address, expiresAt) {
  const hours = Math.max(0, Math.round((expiresAt - Date.now() / 1000) / 3600));
  return `Адрес: <code>${esc(address)}</code>\nЖивёт ~${hours} ч. Всё, что придёт, прилетит сюда.`;
}

// Создаёт адрес. Возвращает box, либо null если упёрлись в rate-limit на /new.
async function newAddress(env, cfg, chatId, user) {
  if (await newBoxLimited(env, cfg, chatId)) return null;
  await enforceActiveLimit(env, chatId, cfg.maxActive);
  const domain = pickDomain(cfg.domains, user?.locale);
  const box = await createBox(env, chatId, domain, cfg.ttlHours);
  await incUser(env, chatId, 'boxes_total');
  return box;
}

const RL_MSG = 'Слишком часто. Лимит новых адресов исчерпан — попробуй позже.';

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

  if (text.startsWith('/start')) {
    const user = await touchUser(env, chatId, locale);
    // Если есть активный адрес — показываем его, не плодим.
    const active = await activeBoxes(env, chatId);
    if (active.length) {
      const b = active[0];
      return sendMessage(env, chatId, fmtAddress(`${b.localpart}@${b.domain}`, b.expires_at), KB);
    }
    const box = await newAddress(env, cfg, chatId, user);
    if (!box) return sendMessage(env, chatId, RL_MSG, KB);
    return sendMessage(env, chatId, fmtAddress(box.address, box.expires_at), KB);
  }

  if (text.startsWith('/new')) {
    const user = await getUser(env, chatId) || await touchUser(env, chatId, locale);
    const box = await newAddress(env, cfg, chatId, user);
    if (!box) return sendMessage(env, chatId, RL_MSG, KB);
    return sendMessage(env, chatId, fmtAddress(box.address, box.expires_at), KB);
  }

  if (text.startsWith('/help')) return sendHelp(env, chatId);

  // Любое другое сообщение — короткая подсказка.
  return sendMessage(env, chatId, 'Команды: /start · /new · /help', KB);
}

async function handleCallback(cq, env, cfg) {
  const chatId = cq.message?.chat?.id;
  const data = cq.data;
  if (!chatId) return answerCallback(env, cq.id);

  if (data === 'new') {
    const user = await getUser(env, chatId);
    const box = await newAddress(env, cfg, chatId, user);
    if (!box) {
      await sendMessage(env, chatId, RL_MSG, KB);
      return answerCallback(env, cq.id, 'Лимит');
    }
    await sendMessage(env, chatId, fmtAddress(box.address, box.expires_at), KB);
    return answerCallback(env, cq.id, 'Готово');
  }

  if (data === 'extend') {
    const active = await activeBoxes(env, chatId);
    if (!active.length) {
      await sendMessage(env, chatId, 'Активных адресов нет. /new — создать.', KB);
      return answerCallback(env, cq.id);
    }
    const b = active[0];
    const exp = await extendBox(env, b.localpart, b.domain, cfg.ttlHours);
    await sendMessage(env, chatId, fmtAddress(`${b.localpart}@${b.domain}`, exp), KB);
    return answerCallback(env, cq.id, 'Продлено');
  }

  if (data === 'help') {
    await sendHelp(env, chatId);
    return answerCallback(env, cq.id);
  }

  return answerCallback(env, cq.id);
}

function sendHelp(env, chatId) {
  return sendMessage(
    env, chatId,
    'Одноразовая почта. /new даёт адрес — всё, что на него придёт, прилетит в этот чат, ' +
      'OTP-код выделяется первой строкой.\n\n' +
      'Адрес живёт сутки и протухает сам. Письма нигде не хранятся — только здесь, в чате.\n' +
      'Не для важной почты: адрес временный, при протухании письма на него отбиваются.',
    KB
  );
}
