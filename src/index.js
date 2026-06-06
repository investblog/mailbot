// gotemailbot — один Worker, три входа: email() приём, fetch() вебхук, scheduled() чистка.

import PostalMime from 'postal-mime';
import { config, now } from './config.js';
import { resolveBox, getUser, incUser } from './boxes.js';
import { extractOtp } from './otp.js';
import { htmlToText } from './html.js';
import { sendMessage, esc } from './telegram.js';
import { handleUpdate } from './bot.js';
import { maybePromo } from './promo.js';

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
    // Rate-limit на адрес + denylist отправителя.
    if (await isDenied(env, from)) return message.setReject('550 5.7.1 sender denied');
    if (await rateLimited(env, cfg, to)) return message.setReject('550 5.7.1 rate limited');

    const box = await resolveBox(env, localpart, domain);
    if (!box) return message.setReject('550 5.1.1 no such user');

    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    await ingest(env, cfg, ctx, box.chat_id, raw, from);
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
      const box = await resolveBox(env, localpart, domain);
      if (!box) return new Response('no such user', { status: 550 });
      const raw = new Uint8Array(await request.arrayBuffer());
      ctx.waitUntil(ingest(env, cfg, ctx, box.chat_id, raw, from));
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
async function ingest(env, cfg, ctx, chatId, raw, from) {
  let parsed;
  try {
    parsed = await PostalMime.parse(raw);
  } catch (e) {
    console.error('parse failed', e);
    return;
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
  await sendMessage(env, chatId, msg);

  // Телеметрия + промо — вне горячего пути.
  if (otp) ctx.waitUntil(incUser(env, chatId, 'otp_caught'));
  ctx.waitUntil((async () => {
    if (otp) {
      const user = await getUser(env, chatId);
      await maybePromo(env, cfg, chatId, user);
    }
  })());
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

async function isDenied(env, from) {
  if (!from) return false;
  const hit = await env.RL.get(`deny:${from}`);
  return hit !== null;
}

// KV-счётчик с TTL. Не атомарно (KV это не умеет) — для MVP достаточно.
async function rateLimited(env, cfg, address) {
  const key = `rl:${address}`;
  const cur = Number((await env.RL.get(key)) || 0);
  if (cur >= cfg.rlPerHour) return true;
  await env.RL.put(key, String(cur + 1), { expirationTtl: 3600 });
  return false;
}
