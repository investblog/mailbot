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

// Промо Catchall в момент лимита: пользователь только что упёрся в лимит адресов
// (rate-limit на /new или вытеснение старого адреса) — точный момент потребности в «своём
// домене без лимитов». Поверхность — приписка к сообщению о лимите + URL-кнопка на бота
// Catchall в Telegram (@allinmailbot): для аудитории бота это нативнее сайта — один тап, без
// браузера. Ссылка — deep link t.me/<bot>?start=<payload>: Catchall получает payload в /start
// и видит источник и момент показа.
// Флаг cfg.catchallPromo (env CATCHALL_PROMO=on) — выключен до запуска оплаты на catchall.in.
// Частота — раз в сутки на владельца через KV с TTL (колонок в owners не добавляем).
// Fail-closed: сбой KV → не показываем (в отличие от лимитера, здесь тишина безопаснее спама).
// reason ∈ {'rate','evict'} — идёт в start-payload, чтобы видеть, какой момент конвертит.
// Payload: `mb_<reason>_<owner.id>` в алфавите Telegram (A-Za-z0-9_-, ≤ 64) — «tg:42» → «tg_42».
const LIMIT_PROMO_TTL = 24 * 3600;

export async function limitPromo(env, cfg, owner, s, reason) {
  if (!cfg.catchallPromo) return null;
  if (!owner || owner.kind !== 'telegram') return null;
  const key = `promo:limit:${owner.id}`;
  try {
    if ((await env.RL.get(key)) !== null) return null;
    await env.RL.put(key, '1', { expirationTtl: LIMIT_PROMO_TTL });
  } catch {
    return null;
  }
  const cid = String(owner.id).replace(/[^A-Za-z0-9_-]/g, '_');
  const url = `https://t.me/${cfg.catchallBot}?start=${`mb_${reason}_${cid}`.slice(0, 64)}`;
  return { text: s.promoLimit, button: { text: s.btnCatchall, url } };
}
