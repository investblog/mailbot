// gotemailbot — один Worker, три входа: email() приём, fetch() вебхук, scheduled() чистка.

import PostalMime from 'postal-mime';
import { config, now } from './config.js';
import { resolveBox, getUser, incUser, deleteBoxesForChat } from './boxes.js';
import { extractOtp } from './otp.js';
import { htmlToText } from './html.js';
import { sendMessage, esc } from './telegram.js';
import { handleUpdate } from './bot.js';
import { maybePromo } from './promo.js';
import { isDenied, addressLimited } from './ratelimit.js';

const BODY_LIMIT = 3400; // лимит TG 4096, оставляем место под заголовки

export default {
  // === Приём почты от Cloudflare Email Routing ===
  async email(message, env, ctx) {
    const cfg = config(env);
    const to = String(message.to || '').toLowerCase();
    const from = String(message.from || '').toLowerCase();
    const [localpart, domain] = splitAddr(to);

    if (!localpart || !cfg.domains.includes(domain)) {
      return message.setReject('550 5.1.1 no such user');
    }
    // Abuse-проверки: denylist отправителя + rate-limit на адрес.
    if (await isDenied(env, from)) return message.setReject('550 5.7.1 sender denied');
    if (await addressLimited(env, cfg, to)) return message.setReject('550 5.7.1 rate limited');

    const box = await resolveBox(env, localpart, domain);
    if (!box) return message.setReject('550 5.1.1 no such user');

    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const r = await ingest(env, cfg, ctx, box.chat_id, raw, from);
    // Транзиентный сбой доставки в TG → 451, чтобы отправляющий MX ретраил.
    if (!r.delivered && !r.permanent) {
      return message.setReject('451 4.7.0 temporary delivery failure, retry later');
    }
  },

  // === Вебхук Telegram + (на будущее) HTTP-приём писем от своего релея ===
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/webhook') {
      // Защита вебхука секретным токеном (Telegram шлёт его в заголовке).
      if (env.TG_SECRET &&
          request.headers.get('x-telegram-bot-api-secret-token') !== env.TG_SECRET) {
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
      if (!localpart || !cfg.domains.includes(domain)) return new Response('no such user', { status: 550 });
      if (await isDenied(env, from)) return new Response('sender denied', { status: 550 });
      if (await addressLimited(env, cfg, to)) return new Response('rate limited', { status: 550 });
      const box = await resolveBox(env, localpart, domain);
      if (!box) return new Response('no such user', { status: 550 });
      const raw = new Uint8Array(await request.arrayBuffer());
      const r = await ingest(env, cfg, ctx, box.chat_id, raw, from);
      // Зеркалим политику email(): транзиентный сбой → 503 (релей ретраит), иначе принято.
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
  const res = await sendMessage(env, chatId, msg);

  if (!res.ok) {
    // 403 — бот заблокирован: доставка невозможна, чистим адреса чата (снижаем abuse-поверхность).
    if (res.status === 403) {
      ctx.waitUntil(deleteBoxesForChat(env, chatId));
      return { delivered: false, permanent: true };
    }
    // 400 — наша ошибка форматирования: ретрай не поможет, логируем и дропаем.
    if (res.status === 400) return { delivered: false, permanent: true };
    // 429 / 5xx / сеть — транзиентно: просим ретрай (SMTP 451 / HTTP 503).
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

function renderEmail({ from, subject, body, links, otp, attachments }) {
  const parts = [];
  // Код первой строкой: жирным + дублем в <code> (тап = копирование).
  if (otp) parts.push(`🔑 <b>${esc(otp)}</b>  <code>${esc(otp)}</code>`);
  parts.push(`<b>${esc(subject)}</b>`);
  parts.push(`от: ${esc(from)}`);
  parts.push('');

  let text = body || '(пустое тело)';
  if (text.length > BODY_LIMIT) text = text.slice(0, BODY_LIMIT) + '…';
  parts.push(esc(text));

  if (links && links.length) {
    parts.push('');
    parts.push('🔗 ссылки:');
    // Сырой URL plain Telegram сам делает кликабельным.
    for (const l of links) parts.push(esc(l));
  }
  if (attachments && attachments.length) {
    parts.push('');
    for (const a of attachments) parts.push(`📎 ${esc(a)}`);
  }
  return parts.join('\n');
}

// --- helpers ---
function splitAddr(addr) {
  const at = addr.lastIndexOf('@');
  if (at < 1) return [null, null];
  return [addr.slice(0, at), addr.slice(at + 1)];
}
