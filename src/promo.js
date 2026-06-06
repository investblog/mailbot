// Кросс-промо 301.st. Вся логика показа здесь.
// Показ — отдельным сообщением ПОСЛЕ пойманного кода (вызывается из email-флоу).

import { now } from './config.js';
import { sendMessage } from './telegram.js';

const PROMO_COOLDOWN = 30 * 24 * 3600; // не чаще раза в 30 дней

export async function maybePromo(env, cfg, chatId, user) {
  if (!user) return;

  // Право показать = возвратность И был успех (момент доверия).
  if (!(user.sessions >= 2 && user.otp_caught >= 1)) return;

  // Частота.
  if (user.last_promo && now() - user.last_promo < PROMO_COOLDOWN) return;

  // Что показать = по поведению. Только «вебмастер», иначе тишина.
  const isWebmaster = user.boxes_total >= 3 || user.otp_caught >= 3;
  if (!isWebmaster) return;

  const url = `${cfg.promoBase}?utm_source=gotemailbot&utm_campaign=otp_heavy&cid=${chatId}`;
  await sendMessage(
    env,
    chatId,
    `Гоняешь OTP пачками — похоже, ты вебмастер.\n` +
      `301.st: клоак/TDS под арбитражный трафик.\n${url}`,
    { link_preview_options: { is_disabled: true } }
  );

  await env.DB.prepare('UPDATE users SET last_promo = ? WHERE chat_id = ?')
    .bind(now(), chatId).run();
}
