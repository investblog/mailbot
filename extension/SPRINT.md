# MailBot extension — ночной спринт

Второй клиент email-core. Бэкенд (Part A) уже на проде и протестирован (`/api/*`, device-token,
таблица `messages`). Это — клиент на **WXT** (Chrome/Edge MV3 + Firefox MV2), popup-inbox, polling.

## Что сделано
- **Каркас:** `wxt.config.ts` (permissions `storage/alarms/notifications`, host_permissions только на наш API),
  `tsconfig`, eslint (typescript-eslint без type-checking), `package.json` (dev/build/build:firefox/typecheck/lint/check).
- **shared/** — `api.ts` (Bearer device-token: session/boxes/messages), `device.ts` (32B base64url в `storage.local`),
  `protocol.ts` (типизир. popup↔bg), `i18n.ts` (ru/en по локали), `render.ts` (tokens→безопасный HTML, только http/https),
  `format.ts` (escape), `types.ts`, `constants.ts`.
- **background.ts** — bootstrap сессии (onInstalled/onStartup), alarm `inbox-poll` (1 мин) → новые письма →
  `chrome.notifications` + badge; хаб для popup (GET_STATE/NEW_BOX/EXTEND/DELETE/POLL), сброс непрочитанного при открытии.
- **popup/** — текущий адрес (копир), New/Extend/Delete, список входящих (новые сверху) с подсветкой OTP (тап=копир),
  поллинг каждые 2.5с пока открыт. **welcome/** — онбординг на установку.
- **Дизайн:** бренд-токены (оранжевый `#fe4622`, синий `#355ff5` для TG-действия), light/dark по `prefers-color-scheme`.

## Архитектурные решения (зафиксированы владельцем)
- Доставка — **polling** (открыт popup: 2.5с; фон: alarm 1 мин + нотификации). Web Push — фаза 2.
- Auth — **анонимный device-token** (без регистрации). Bearer = 32B base64url; сервер хранит только sha256-хеш.
- Хранение — на сервере (D1, текст, TTL 24ч). Браузеры — Chrome/Edge/Firefox (Opera пропущен).

## Проверка на утро (ручная — нужен живой браузер)
1. `cd extension && npm install` (если ещё не) → `npm run dev` (Chrome) — WXT откроет браузер с загруженным расширением.
   Либо `npm run build` и загрузить `dist/chrome-mv3` через chrome://extensions → «Загрузить распакованное».
2. Кликнуть иконку MailBot → нажать **New address** → должен появиться адрес `…@mailbot.click`.
3. Отправить письмо с кодом на этот адрес (или через бота: тем же ядром). В открытом popup письмо появится в течение ~2.5с,
   OTP — подсвечен, тап копирует. При закрытом popup — придёт `chrome.notifications` (в течение ~минуты).
4. Проверить **Extend** / **Delete** и переключение языка (сменить язык браузера → ru/en).
5. Firefox: `npm run build:firefox` → `about:debugging` → «Загрузить временное дополнение» → `dist/firefox-mv2/manifest.json`.

## Известные ограничения / TODO (обсудить утром)
- API на `gotemailbot.gotemailbot.workers.dev` (host_permissions). Чище — завести `api.mailbot.click` (Worker route) и заменить.
- Иконки — из лого-маскота (если sharp не поставился — дефолтные; заменить).
- Юнит-тесты расширения не подключены (node strip-types + extensionless-импорты хрупки); верификация = tsc + wxt build + eslint.
  Логика escape/render зеркалит уже протестированный `src/render.js` бэкенда.
- Автозаполнение OTP в активное поле (content-script), аккаунт поверх device-token, rewarded — фаза 3.
