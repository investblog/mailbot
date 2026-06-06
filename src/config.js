// Конфиг, выводимый из env. Всё с дефолтами — Worker поднимается даже с пустыми vars.

export function config(env) {
  const domains = (env.DOMAINS || 'mailbot.click,emailbot.ru')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    domains,
    ttlHours: Number(env.BOX_TTL_HOURS || 24),
    maxActive: Number(env.MAX_ACTIVE_BOXES || 2),
    rlPerHour: Number(env.RL_PER_HOUR || 30),
    promoBase: env.PROMO_BASE || 'https://301.st/',
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

export const now = () => Math.floor(Date.now() / 1000);
