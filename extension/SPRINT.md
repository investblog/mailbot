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

---

# Фаза 2 — Web Push (выбрано; Workers Paid куплен 2026-06-09)

**Цель:** мгновенная доставка письма/OTP и в открытом, и в закрытом состоянии; убрать поллинг и минутный алярм.

**Почему Web Push, а не DO/WebSocket:** разбудить уснувший SW умеет ТОЛЬКО push. DO+WebSocket не покрывает закрытое состояние (нет живого SW под сокет), а в открытом push→refresh достаточно. Подтверждено по докам: Push API работает в SW расширения (Chrome MV3 офиц. + Firefox), стандартный VAPID, push будит suspended SW. Payload шифруется E2E (RFC 8291) — FCM/Mozilla код не видят. Paid даёт запас по KV/лимитам и оставляет DO опцией на будущее (мульти-девайс/синк), но транспорт — Web Push.

## Сервер (воркер `gotemailbot`)
- `src/push.js` — порт логики из `W:\Projects\fastweb-cam\workers\push-cdn`: `sendPush(sub, payload)` на Web Crypto (RFC 8291 aes128gcm + RFC 8292 VAPID ES256 JWT), без внешних зависимостей.
- KV namespace `PUSH_SUBS` (новый биндинг в `wrangler.jsonc`): подписки по owner, ключ `push:<oid>:<endpoint-hash>`, значение `{endpoint, keys:{p256dh, auth}}`. TTL не нужен.
- Секрет `VAPID_PRIVATE_KEY`; public — константа (захардкодить в extension `constants.ts`, он публичный). Сгенерировать пару P-256.
- `api.js` (owner-scoped, мутации → под rate-limit): `POST /api/push/subscribe` (тело PushSubscription → сохранить), `POST /api/push/unsubscribe` (по endpoint).
- `delivery.js` `deliverStore`/`deliverExtension`: после записи письма в D1 — достать подписки owner, `ctx.waitUntil(sendPush(...))` с payload `{id, address, subject, from, otp}`. На 404/410 от push-сервиса — удалить протухшую подписку.

## Клиент (`extension/`)
- `background.ts`: после сессии — `pushManager.subscribe({userVisibleOnly:true, applicationServerKey: VAPID_PUBLIC})` → `POST /api/push/subscribe`; обработать `pushsubscriptionchange` (переподписка). Событие `push`: расшифровка → `chrome.notifications.create` (OTP в заголовке) + badge + broadcast runtime-сообщения в открытый попап → мгновенный refresh. **Минутный `alarms`-поллинг убрать** (push заменяет).
- `popup/main.ts`: убрать быстрый/медленный поллинг-цикл. На открытие — один `GET_STATE`; слушать runtime-сообщение от SW → refresh; refresh на `visibilitychange`. Fallback (push не 100%): пока попап ОТКРЫТ — медленный safety-поллинг ~15с.
- `notifications` permission уже в манифесте (в расширениях без промпта).

## Открытые вопросы (решить по ходу)
- **Firefox MV2**: нет service worker (фоновая страница) — push для расширений FF проверить отдельно (`browser.pushManager`/совместимость). Chrome/Edge — основной таргет; для FF возможен фолбэк-поллинг.
- Судьба глубокого закрытого fallback: чистый push vs оставить 5-мин алярм страховкой.

## Проверки
- Сервер: юнит на endpoint-hash/формат payload; ручной `sendPush` на реальную подписку.
- Клиент: tsc+build+lint; ручная — закрытый попап → письмо → нотификация ~мгновенно; открытый → строка без поллинга.
