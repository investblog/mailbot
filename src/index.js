// gotemailbot — маршрутизатор входов Worker: email() приём, fetch() вебхук/ingest, scheduled() чистка.
// Бизнес-логика — в email-core (ingest/boxes/owners/...). Здесь только разбор входа и abuse-проверки.

import { config, now } from './config.js';
import { resolveBox } from './boxes.js';
import { handleUpdate } from './bot.js';
import { ingest } from './ingest.js';
import { handleApi } from './api.js';
import { isDenied, addressLimited } from './ratelimit.js';
import { deleteExpiredMessages } from './messages.js';

export default {
  // === Приём почты от Cloudflare Email Routing ===
  // Email Workers НЕ умеют transient/4xx-отказ: setReject — всегда permanent.
  // Транзиент доставки добивается ретраем в транспорте; иначе письмо принимается и дропается.
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
    await ingest(env, cfg, ctx, { localpart, domain, expires_at: box.expires_at, owner: box.owner }, raw, from);
    // Исход доставки не влияет на SMTP-ответ (transient уже отретраен; permanent-bounce был бы хуже потери).
  },

  // === Вебхук Telegram + (план Б) HTTP-приём писем от своего MX-релея ===
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

    // /ingest — ВНУТРЕННИЙ endpoint для MX-релея (план Б), НЕ публичный API.
    // Проходит те же abuse-проверки и порядок, что email().
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
      const sizeHdr = Number(request.headers.get('content-length') || 0);
      if (sizeHdr > cfg.maxRawBytes) return new Response('message too large', { status: 413 });
      if (await isDenied(env, from)) return new Response('sender denied', { status: 550 });
      const box = await resolveBox(env, localpart, domain);
      if (!box) return new Response('no such user', { status: 550 });
      if (await addressLimited(env, cfg, to)) return new Response('rate limited', { status: 550 });
      const raw = new Uint8Array(await request.arrayBuffer());
      if (raw.byteLength > cfg.maxRawBytes) return new Response('message too large', { status: 413 });
      const r = await ingest(env, cfg, ctx, { localpart, domain, expires_at: box.expires_at, owner: box.owner }, raw, from);
      // На релее ретрай возможен: транзиент → 503, иначе принято.
      if (!r.delivered && !r.permanent) return new Response('retry later', { status: 503 });
      return new Response('ok');
    }

    // === Публичный API расширения (анонимный device-token) ===
    if (url.pathname === '/api/' || url.pathname.startsWith('/api/')) {
      return handleApi(request, env, ctx);
    }

    return new Response('gotemailbot', { status: 200 });
  },

  // === Cron: физическое удаление протухших строк (логически они уже мертвы) ===
  async scheduled(event, env, ctx) {
    ctx.waitUntil(env.DB.prepare('DELETE FROM boxes WHERE expires_at <= ?').bind(now()).run());
    ctx.waitUntil(deleteExpiredMessages(env));
  },
};

// --- helpers ---
function splitAddr(addr) {
  const at = addr.lastIndexOf('@');
  if (at < 1) return [null, null];
  return [addr.slice(0, at), addr.slice(at + 1)];
}
