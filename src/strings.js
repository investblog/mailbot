// i18n строк клиента (бот + рендер письма + промо). Язык по owner.locale (Telegram language_code).
// ru-локаль → русский, всё остальное → английский (как лендинг).

export function langOf(locale) {
  return locale && String(locale).toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

const S = {
  ru: {
    btnNew: 'Новый адрес', btnExtend: 'Продлить', btnHelp: 'Помощь',
    rlMsg: 'Слишком часто. Лимит новых адресов исчерпан — попробуй позже.',
    address: 'Адрес: <code>{addr}</code>\nЖивёт ~{h} ч. Всё, что придёт, прилетит прямо в этот чат.\nАктивно до {max} адресов разом — новый сверх лимита отключит самый старый.',
    evicted: '⚠️ Отключён прежний адрес (лимит {max}): {addr} — письма на него больше не дойдут.',
    cmds: 'Команды: /start · /new · /help',
    okNew: 'Готово', okExtend: 'Продлено', limit: 'Лимит',
    noActive: 'Активных адресов нет. /new — создать.',
    help:
      'Одноразовая почта. /new даёт адрес — всё, что на него придёт, прилетит в этот чат, ' +
      'OTP-код выделяется первой строкой.\n\n' +
      'Адрес живёт сутки и протухает сам. Письма нигде не хранятся — только здесь, в чате.\n' +
      'Не для важной почты: адрес временный, при протухании письма на него отбиваются.',
    from: 'от:', noSubject: '(без темы)', links: '🔗 ссылки:', emptyBody: '(пустое тело)',
    promo:
      'Гоняешь OTP пачками — похоже, ты вебмастер.\n' +
      '<a href="{url}">301.st</a> — клоак/TDS под арбитражный трафик.',
  },
  en: {
    btnNew: 'New address', btnExtend: 'Extend', btnHelp: 'Help',
    rlMsg: 'Too often. New-address limit reached — try again later.',
    address: 'Address: <code>{addr}</code>\nLives ~{h}h. Everything sent here lands in this chat.\nUp to {max} addresses at once — a new one past the limit drops the oldest.',
    evicted: '⚠️ Previous address deactivated (limit {max}): {addr} — mail to it won’t arrive anymore.',
    cmds: 'Commands: /start · /new · /help',
    okNew: 'Done', okExtend: 'Extended', limit: 'Limit',
    noActive: 'No active addresses. /new to create one.',
    help:
      'Disposable email. /new gives you an address — everything sent to it lands in this chat, ' +
      'with the OTP code on the first line.\n\n' +
      'The address lives 24h and expires on its own. Emails are not stored anywhere — only here, in the chat.\n' +
      'Not for important mail: the address is temporary; once it expires, mail to it bounces.',
    from: 'from:', noSubject: '(no subject)', links: '🔗 links:', emptyBody: '(empty body)',
    promo:
      "You're catching OTPs in bulk — looks like you're a webmaster.\n" +
      '<a href="{url}">301.st</a> — cloak/TDS for arbitrage traffic.',
  },
};

export function strings(locale) {
  return S[langOf(locale)];
}

export function fmt(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
