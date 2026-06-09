// Локализация UI расширения: ru/en по navigator.language.
type Dict = Record<string, string>;

const EN: Dict = {
  title: 'MailBot',
  tagline: 'Disposable email with OTP',
  current: 'Your address',
  copy: 'Copy',
  copied: 'Copied',
  new: 'New address',
  extend: 'Extend',
  delete: 'Delete',
  inbox: 'Inbox',
  empty: 'No mail yet. Paste your address into a signup form — the code lands here.',
  waiting: 'Waiting for mail…',
  otp: 'code',
  open_tg: 'Also in Telegram',
  expires_in: 'expires in {h}h',
  error: 'Connection error. Retrying…',
  toggleTheme: 'Toggle theme',
  pin: 'Open in side panel',
  collapse: 'Collapse panel',
  github: 'Source on GitHub',
  close: 'Close',
  craftedAt: 'Crafted at',
  sponsorTitle: 'Sponsored by 301.st',
  rateUs: 'Rate us',
  'welcome.lead': 'Disposable email with OTP, right in your browser.',
  'welcome.s1': 'Click the MailBot icon to get a disposable address.',
  'welcome.s2': 'Paste it into any signup or login form.',
  'welcome.s3': 'The email — and the OTP code — appear in the panel.',
  'welcome.open': 'Open the panel',
  'welcome.pinHint': 'Click the MailBot icon in the toolbar to open it.',
  'welcome.tg': 'Also available in Telegram',
};

const RU: Dict = {
  title: 'MailBot',
  tagline: 'Одноразовая почта с OTP',
  current: 'Твой адрес',
  copy: 'Копировать',
  copied: 'Скопировано',
  new: 'Новый адрес',
  extend: 'Продлить',
  delete: 'Удалить',
  inbox: 'Входящие',
  empty: 'Писем пока нет. Вставь адрес в форму регистрации — код прилетит сюда.',
  waiting: 'Ждём письмо…',
  otp: 'код',
  open_tg: 'Ещё в Telegram',
  expires_in: 'протухнет через {h}ч',
  error: 'Ошибка связи. Повтор…',
  toggleTheme: 'Сменить тему',
  pin: 'Открыть в боковой панели',
  collapse: 'Свернуть панель',
  github: 'Исходники на GitHub',
  close: 'Закрыть',
  craftedAt: 'Сделано в',
  sponsorTitle: 'При поддержке 301.st',
  rateUs: 'Оценить',
  'welcome.lead': 'Одноразовая почта с OTP — прямо в браузере.',
  'welcome.s1': 'Нажми иконку MailBot, чтобы получить одноразовый адрес.',
  'welcome.s2': 'Вставь его в любую форму регистрации или входа.',
  'welcome.s3': 'Письмо — и OTP-код — появятся в панели.',
  'welcome.open': 'Открыть панель',
  'welcome.pinHint': 'Нажми иконку MailBot на панели инструментов, чтобы открыть.',
  'welcome.tg': 'Также доступно в Telegram',
};

export function lang(): 'ru' | 'en' {
  return (navigator.language || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

const dict = (): Dict => (lang() === 'ru' ? RU : EN);

export function t(key: string, vars?: Record<string, string | number>): string {
  let v = dict()[key] ?? key;
  if (vars) v = v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
  return v;
}

export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const k = el.getAttribute('data-i18n');
    if (k) el.textContent = t(k);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const k = el.getAttribute('data-i18n-title');
    if (k) { el.title = t(k); el.setAttribute('aria-label', t(k)); }
  });
}
