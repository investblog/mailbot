// Кросс-промо 301.st. Логика показа здесь. Возвращает true, если показ состоялся
// (запись last_promo делает вызывающий — ingest). Показ — отдельным сообщением после кода.

import { now } from './config.js';
import { sendMessage } from './telegram.js';

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
  const url = `${cfg.promoBase}?utm_source=gotemailbot&utm_campaign=otp_heavy&cid=${owner.id}`;
  const res = await sendMessage(
    env,
    owner.external_id,
    'Гоняешь OTP пачками — похоже, ты вебмастер.\n' +
      `301.st: клоак/TDS под арбитражный трафик.\n${url}`
  );
  return res.ok;
}
