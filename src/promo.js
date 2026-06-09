// Кросс-промо 301.st. Логика показа здесь. Возвращает true, если показ состоялся
// (запись last_promo делает вызывающий — ingest). Показ — отдельным сообщением после кода.

import { now } from './config.js';
import { sendMessage } from './telegram.js';
import { strings, fmt } from './strings.js';

const PROMO_COOLDOWN = 30 * 24 * 3600; // не чаще раза в 30 дней

export async function maybePromo(env, cfg, owner, row) {
  if (!row) return false;
  // Промо-канал MVP — только Telegram (у будущего клиента своя поверхность).
  if (owner.kind !== 'telegram') return false;

  // Право показать = возвратность И был успех (момент доверия).
  if (!(row.sessions >= 2 && row.otp_caught >= 1)) return false;
  // Частота.
  if (row.last_promo && now() - row.last_promo < PROMO_COOLDOWN) return false;
  // Что показать = по поведению. Только «вебмастер», иначе тишина.
  if (!(row.boxes_total >= 3 || row.otp_caught >= 3)) return false;

  // cid = owner.id — сквозная склейка bot → TDS → оплата, future-proof по клиентам.
  // encodeURIComponent: owner.id может содержать символы будущих клиентов, не тащим в query сырьём.
  const cid = encodeURIComponent(owner.id);
  const url = `${cfg.promoBase}?utm_source=gotemailbot&utm_campaign=otp_heavy&cid=${cid}`;
  // Ссылка идёт в HTML-href (parse_mode=HTML) как кликабельный «301.st» — экранируем & разделителей.
  const urlAttr = url.replace(/&/g, '&amp;');
  const s = strings(row.locale || owner.locale);
  const res = await sendMessage(env, owner.external_id, fmt(s.promo, { url: urlAttr }));
  return res.ok;
}
