// Delivery seam: единственное место, где ядро встречается с клиентом.
// ingest() строит нормализованное сообщение и зовёт deliver(owner, msg) — НЕ знает про Telegram.
//
//  Возвращает исход: { delivered, permanent }.
//   delivered:true                    — доставлено;
//   delivered:false, permanent:true   — доставка невозможна (бот заблокирован / битый запрос) → дроп;
//   delivered:false, permanent:false  — транзиент (уже отретраен в транспорте) → апстрим решает.

import { renderEmail } from './render.js';
import { sendMessage } from './telegram.js';
import { deleteBoxesForOwner } from './boxes.js';
import { storeMessage } from './messages.js';
import { pushToOwner } from './push.js';

export async function deliver(env, ctx, owner, msg) {
  switch (owner.kind) {
    case 'telegram':
      return deliverTelegram(env, ctx, owner, msg);
    case 'extension':
    case 'account':
      return deliverStore(env, ctx, owner, msg);
    default:
      console.error(`deliver: unsupported owner kind ${owner.kind}`);
      return { delivered: false, permanent: true };
  }
}

// Клиенты, которые показывают письма сами: сохраняем нормализованное событие в D1 (TTL = жизнь адреса).
// Расширение читает через GET /api/messages. msg.box = { localpart, domain, expires_at }.
async function deliverStore(env, ctx, owner, msg) {
  if (!msg.box) {
    console.error('deliverStore: msg.box missing');
    return { delivered: false, permanent: true };
  }
  try {
    const id = await storeMessage(env, owner, msg.box, msg);
    // Web Push: будит SW расширения (нотификация + мгновенный refresh открытого попапа).
    // Best-effort, вне критического пути доставки — не блокируем и не валим приём письма.
    const payload = {
      id,
      address: `${msg.box.localpart}@${msg.box.domain}`,
      from: msg.from || '',
      subject: msg.subject || '',
      otp: msg.otp || null,
    };
    ctx.waitUntil(pushToOwner(env, owner.id, payload));
    return { delivered: true };
  } catch (e) {
    console.error('deliverStore failed', e);
    return { delivered: false, permanent: false }; // транзиент БД → апстрим может ретраить
  }
}

async function deliverTelegram(env, ctx, owner, msg) {
  const chatId = owner.external_id;
  const text = renderEmail(msg);             // Telegram-форматирование живёт в клиентском слое
  const res = await sendMessage(env, chatId, text); // ретрай транзиента — внутри

  if (res.ok) return { delivered: true };

  // 403 — бот заблокирован: доставка невозможна, чистим адреса владельца (сужаем abuse-поверхность).
  if (res.status === 403) {
    ctx.waitUntil(deleteBoxesForOwner(env, owner.id));
    return { delivered: false, permanent: true };
  }
  // 400 — наша ошибка форматирования: ретрай не поможет.
  if (res.status === 400) return { delivered: false, permanent: true };
  // 429 / 5xx / сеть — транзиент.
  return { delivered: false, permanent: false };
}
