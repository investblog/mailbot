// email-core: конвейер обработки письма. Источник-агностичный (CF Email Routing или /ingest),
// клиент-агностичный (доставку делает deliver() по owner.kind).

import PostalMime from 'postal-mime';
import { extractOtp } from './otp.js';
import { htmlToText } from './html.js';
import { deliver } from './delivery.js';
import { incOwner, getOwnerById, setLastPromo } from './owners.js';
import { maybePromo } from './promo.js';

// Возвращает исход доставки { delivered, permanent } (см. delivery.js).
export async function ingest(env, cfg, ctx, owner, raw, from) {
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

  // Нормализованное сообщение — без знания о клиенте.
  const msg = { from, subject, body, links, otp, attachments };
  const outcome = await deliver(env, ctx, owner, msg);

  // Телеметрия + промо — только при успешной доставке, вне горячего пути.
  if (outcome.delivered && otp) {
    ctx.waitUntil(incOwner(env, owner.id, 'otp_caught'));
    ctx.waitUntil((async () => {
      const full = await getOwnerById(env, owner.id);
      const shown = await maybePromo(env, cfg, owner, full);
      if (shown) await setLastPromo(env, owner.id);
    })());
  }
  return outcome;
}
