// Конфиг, выводимый из env. Всё с дефолтами — Worker поднимается даже с пустыми vars.

export function config(env) {
  const domains = (env.DOMAINS || 'mailbot.click')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    domains,
    ttlHours: Number(env.BOX_TTL_HOURS || 24),
    maxActive: Number(env.MAX_ACTIVE_BOXES || 2),
    rlPerHour: Number(env.RL_PER_HOUR || 30),
    newPerHour: Number(env.NEW_PER_HOUR || 5),
    newPerDay: Number(env.NEW_PER_DAY || 20),
    maxRawBytes: Number(env.MAX_RAW_KB || 1024) * 1024, // дефолт 1 MiB; больше — reject до парса
    promoBase: env.PROMO_BASE || 'https://301.st/',
    // Промо Catchall в момент лимита. Дефолт off; в проде включено с 04.09.2026 (wrangler.jsonc).
    catchallPromo: String(env.CATCHALL_PROMO || 'off').toLowerCase() === 'on',
    // Промо ведёт на бота Catchall в Telegram (нативнее сайта для аудитории бота): deep link
    // t.me/<bot>?start=… — атрибуция в параметре start, а не в utm.
    catchallBot: env.CATCHALL_BOT || 'allinmailbot',
  };
}

// Выбор домена под локаль юзера. RU → .ru, остальные → первый не-.ru.
export function pickDomain(domains, locale) {
  if (locale && locale.toLowerCase().startsWith('ru')) {
    const ru = domains.find((d) => d.endsWith('.ru'));
    if (ru) return ru;
  }
  return domains.find((d) => !d.endsWith('.ru')) || domains[0];
}

export const now = () => Math.floor(Date.now() / 1000); // unix seconds (boxes/owners TTL)
export const nowMs = () => Date.now();                  // unix ms (messages cursor для polling)
