// Конфиг расширения. API на workers.dev (CORS=* на сервере). Кастом-домен api.mailbot.click — позже.
export const API_BASE = 'https://gotemailbot.gotemailbot.workers.dev';
export const BOT_URL = 'https://t.me/gotemailbot';

export const POLL_OPEN_MS = 2500; // частый поллинг пока popup открыт (ожидание кода)
export const POLL_ALARM_NAME = 'inbox-poll';
export const POLL_ALARM_MIN = 1; // фоновый alarm (минимум MV3)

export const STORAGE = {
  secret: 'mb_device_secret', // device-token (секрет, только local)
  settings: 'mb_settings',
  cursor: 'mb_cursor', // курсор прочитанного для фонового поллинга
  seen: 'mb_seen', // id, по которым уже была нотификация
} as const;
