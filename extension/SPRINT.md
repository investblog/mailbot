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
- **popup/** — текущий адрес (клик/кнопка копируют, house success-фидбек: иконка→галочка, цвет→success ~1.4с),
  New/Extend/Delete. Входящие — **компактные строки-заголовки** (тема/отправитель/время + маленький OTP-бейдж, тап=копир);
  клик по строке открывает **полное письмо в дровере** (overlay + slide-in, закрытие Esc/overlay/крестик). **welcome/** — онбординг.
- **Дизайн (house standard из redirect-inspector):** дизайн-система `assets/css/theme.css` (токены, `data-theme` dark/light/auto), `shared/theme.ts` (тогл темы, localStorage). Хедер `popup__header` (лого+тайтл слева, тогл темы + pin справа), `popup__body`, `popup__footer`. Бренд: оранжевый `#fe4622`, синий `#355ff5` (TG).
- **Side panel:** один `popup.html?sidepanel=1` служит и popup, и боковой панелью. Chrome/Edge — `side_panel` + кнопка «pin» (открыть панель); Firefox — `sidebar_action`.

## Архитектурные решения (зафиксированы владельцем)
- Доставка — **умный polling** в открытом окне: быстрый 2.5с только в «окне ожидания» 60с (открытие/действие/новое письмо),
  вне окна бэкофф 12с, пауза на скрытой вкладке. Фон: alarm 1 мин + нотификации. **Выбранный путь фазы 2 — Web Push**
  (наработки `W:\Projects\fastweb-cam\workers\push-cdn`: Web Crypto RFC 8291 + VAPID, KV-подписки, без зависимостей).
- Auth — **анонимный device-token** (без регистрации). Bearer = 32B base64url; сервер хранит только sha256-хеш.
- Хранение — на сервере (D1, текст, TTL 24ч). Браузеры — Chrome/Edge/Firefox (WXT, единый `browser` API). Opera исключена (не принимает расширения).
- API — на кастом-домене воркера **`api.mailbot.click`** (Custom Domain, CORS=*).

## Проверка на утро (ручная — нужен живой браузер)
1. `cd extension && npm install` (если ещё не) → `npm run dev` (Chrome) — WXT откроет браузер с загруженным расширением.
   Либо `npm run build` и загрузить `dist/chrome-mv3` через chrome://extensions → «Загрузить распакованное».
2. Кликнуть иконку MailBot → нажать **New address** → должен появиться адрес `…@mailbot.click`.
3. Отправить письмо с кодом на этот адрес (или через бота: тем же ядром). В открытом popup письмо появится в течение ~2.5с,
   OTP — подсвечен, тап копирует. При закрытом popup — придёт `chrome.notifications` (в течение ~минуты).
4. Проверить **Extend** / **Delete** и переключение языка (сменить язык браузера → ru/en).
5. Firefox: `npm run build:firefox` → `about:debugging` → «Загрузить временное дополнение» → `dist/firefox-mv2/manifest.json`.

## Известные ограничения / TODO (обсудить утром)
- API на `api.mailbot.click` (Custom Domain воркера) — готово.
- Иконки — бот-фейс из `icon-source.png`, нарезка `npm run icons` → `src/public/icon/` (WXT копирует public ИЗ `src/public/`, не из корня!).
- Юнит-тесты расширения не подключены (node strip-types + extensionless-импорты хрупки); верификация = tsc + wxt build + eslint.
  Логика escape/render зеркалит уже протестированный `src/render.js` бэкенда.
- Автозаполнение OTP в активное поле (content-script), аккаунт поверх device-token, rewarded — фаза 3.
