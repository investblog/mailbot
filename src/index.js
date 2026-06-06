// gotemailbot — один Worker, три входа: email() приём, fetch() вебхук, scheduled() чистка.

import PostalMime from 'postal-mime';
import { config, now } from './config.js';
import { resolveBox, getUser, incUser, deleteBoxesForChat } from './boxes.js';
import { extractOtp } from './otp.js';
import { htmlToText } from './html.js';
import { sendMessage } from './telegram.js';
import { renderEmail } from './render.js';
import { handleUpdate } from './bot.js';
import { maybePromo } from './promo.js';
import { isDenied, addressLimited } from './ratelimit.js';

export default {
  // === Приём почты от Cloudflare Email Routing ===
  // Email Workers НЕ умеют transient/4xx-отказ: setReject — всегда permanent.
  // Поэтому транзиентный сбой доставки добиваем ретраем в sendMessage, иначе принимаем и дропаем.
  async email(message, env, ctx) {
    const cfg = config(env);
    const to = String(message.to || '').toLowerCase();
    const from = String(message.from || '').toLowerCase();
    const [localpart, domain] = splitAddr(to);

    // Порядок: домен → размер → denylist → resolve → rate-limit → доставка.
    // (rate-limit пишет KV — не делаем это для несуществующих адресов на catch-all домене.)
    if (!localpart || !cfg.domains.includes(domain)) {
      return message.setReject('550 5.1.1 no such user');
    }
    if (message.rawSize > cfg.maxRawBytes) {
      return message.setReject('552 5.3.4 message too large'); // permanent — на ретрае не уменьшится
    }
    if (await isDenied(env, from)) return message.setReject('550 5.7.1 sender denied');

    const box = await resolveBox(env, localpart, domain);
    if (!box) return message.setReject('550 5.1.1 no such user');
    if (await addressLimited(env, cfg, to)) return message.setReject('550 5.7.1 rate limited');

    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    await ingest(env, cfg, ctx, box.chat_id, raw, from);
    // Исход доставки не влияет на SMTP-ответ: транзиент уже отретраен внутри,
    // постоянный сбой принимаем (permanent-bounce на временный сбой TG был бы хуже потери).
  },

  // === Вебхук Telegram + (на будущее) HTTP-приём писем от своего релея ===
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/webhook') {
      // Fail-closed: без TG_SECRET вебхук недоступен (иначе любой шлёт фейковые updates).
      if (!env.TG_SECRET) {
        console.error('TG_SECRET not set — webhook disabled');
        return new Response('webhook misconfigured', { status: 503 });
      }
      if (request.headers.get('x-telegram-bot-api-secret-token') !== env.TG_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      const update = await request.json().catch(() => null);
      if (update) ctx.waitUntil(handleUpdate(update, env));
      return new Response('ok');
    }

    // Источник-агностичный приём: свой MX-релей (Yandex/VPS) шлёт сырой MIME сюда.
    // Plan B обязан проходить ТЕ ЖЕ abuse-проверки, что и email(), иначе релей = обход лимитов.
    if (request.method === 'POST' && url.pathname === '/ingest') {
      if (!env.INGEST_SECRET ||
          request.headers.get('authorization') !== `Bearer ${env.INGEST_SECRET}`) {
        return new Response('forbidden', { status: 403 });
      }
      const cfg = config(env);
      const to = (url.searchParams.get('to') || '').toLowerCase();
      const from = (url.searchParams.get('from') || '').toLowerCase();
      const [localpart, domain] = splitAddr(to);
      // Тот же порядок и набор abuse-проверок, что в email().
      if (!localpart || !cfg.domains.includes(domain)) return new Response('no such user', { status: 550 });
      const sizeHdr = Number(request.headers.get('content-length') || 0);
      if (sizeHdr > cfg.maxRawBytes) return new Response('message too large', { status: 413 });
      if (await isDenied(env, from)) return new Response('sender denied', { status: 550 });
      const box = await resolveBox(env, localpart, domain);
      if (!box) return new Response('no such user', { status: 550 });
      if (await addressLimited(env, cfg, to)) return new Response('rate limited', { status: 550 });
      const raw = new Uint8Array(await request.arrayBuffer());
      if (raw.byteLength > cfg.maxRawBytes) return new Response('message too large', { status: 413 });
      const r = await ingest(env, cfg, ctx, box.chat_id, raw, from);
      // Здесь transient-ретрай возможен на стороне релея: транзиент → 503, иначе принято.
      if (!r.delivered && !r.permanent) return new Response('retry later', { status: 503 });
      return new Response('ok');
    }

    return new Response('gotemailbot', { status: 200 });
  },

  // === Cron: физическое удаление протухших строк (логически они уже мертвы) ===
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      env.DB.prepare('DELETE FROM boxes WHERE expires_at <= ?').bind(now()).run()
    );
  },
};

// --- общий конвейер обработки письма (источник-агностичный) ---
// Возвращает исход доставки: { delivered, permanent }.
//  - delivered:true            — ушло в TG, считаем доставленным;
//  - delivered:false permanent:true  — доставка невозможна (бот заблокирован / битый запрос) → принять и дропнуть;
//  - delivered:false permanent:false — транзиентный сбой (429/5xx/сеть) → вызывающий просит ретрай.
async function ingest(env, cfg, ctx, chatId, raw, from) {
  let parsed;
  try {
    parsed = await PostalMime.parse(raw);
  } catch (e) {
    console.error('parse failed', e);
    return { delivered: false, permanent: true }; // битый MIME ретраить бессмысленно
  }

  const subject = parsed.subject || '(без темы)';
  let body = parsed.text || '';
  let links = [];
  if (!body && parsed.html) {
    const out = await htmlToText(parsed.html);
    body = out.text;
    links = out.links;
  }

  const otp = extractOtp(subject, body);
  const attachments = (parsed.attachments || []).map((a) => a.filename || 'файл');

  const msg = renderEmail({ from, subject, body, links, otp, attachments });
  const res = await sendMessage(env, chatId, msg); // ретрай транзиента — внутри

  if (!res.ok) {
    // 403 — бот заблокирован: доставка невозможна, чистим адреса чата (снижаем abuse-поверхность).
    if (res.status === 403) {
      ctx.waitUntil(deleteBoxesForChat(env, chatId));
      return { delivered: false, permanent: true };
    }
    // 400 — наша ошибка форматирования: ретрай не поможет, логируем и дропаем.
    if (res.status === 400) return { delivered: false, permanent: true };
    // 429 / 5xx / сеть — транзиент (уже отретраен в sendMessage). email() дропает,
    // /ingest отдаёт 503 (там ретрай возможен на стороне релея).
    return { delivered: false, permanent: false };
  }

  // Доставлено: телеметрия + промо вне горячего пути.
  if (otp) {
    ctx.waitUntil(incUser(env, chatId, 'otp_caught'));
    ctx.waitUntil((async () => {
      const user = await getUser(env, chatId);
      await maybePromo(env, cfg, chatId, user);
    })());
  }
  return { delivered: true };
}

// --- helpers ---
function splitAddr(addr) {
  const at = addr.lastIndexOf('@');
  if (at < 1) return [null, null];
  return [addr.slice(0, at), addr.slice(at + 1)];
}
