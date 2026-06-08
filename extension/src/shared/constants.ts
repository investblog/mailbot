// Конфиг расширения. API на кастом-домене воркера (CORS=* на сервере).
export const API_BASE = 'https://api.mailbot.click';
export const BOT_URL = 'https://t.me/gotemailbot';

// Умный поллинг пока popup/панель открыт: быстрый темп только в «окно ожидания»
// (после открытия / действия / нового письма), затем бэкофф; пауза на скрытой вкладке.
export const POLL_FAST_MS = 2500; // ожидание OTP — низкая задержка
export const POLL_SLOW_MS = 12000; // фон открытого окна — экономный темп
export const POLL_ACTIVE_MS = 60000; // длительность «окна ожидания» после триггера
export const POLL_OPEN_MS = POLL_FAST_MS; // backwards-compat alias
export const POLL_ALARM_NAME = 'inbox-poll';
export const POLL_ALARM_MIN = 1; // фоновый alarm (минимум MV3)

export const STORAGE = {
  secret: 'mb_device_secret', // device-token (секрет, только local)
  settings: 'mb_settings',
  cursor: 'mb_cursor', // курсор прочитанного для фонового поллинга
  seen: 'mb_seen', // id, по которым уже была нотификация
} as const;
