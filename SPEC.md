# ТЗ (финальное): gotemailbot

> Каноничное тех-задание. Заменяет черновик `gotemailbot-tz.md` (оставлен как история обсуждения). Отражает решения, принятые в ходе разработки, и фактическую реализацию в `src/`.

Одноразовая почта в Telegram. Юзер жмёт `/start`, получает адрес, всё пришедшее на него прилетает в чат. Пойманный OTP-код выделяется первой строкой. Адрес живёт сутки и протухает сам.

- **Бот:** `@gotemailbot` («Temp Mail — Disposable Email & OTP»)
- **Домены:** `mailbot.click` (главный, не-RU) · `emailbot.ru` (RU-локаль)
- **Аккаунт:** investblog (git + Cloudflare). Детали инфраструктуры — `cloudflare.md`.
- **Принцип:** edge-first, zero-backend. Всё живёт на Cloudflare. Письма на MVP не хранятся — улетают в чат юзера и лежат там.

---

## 1. Стек (только Cloudflare)

| Ресурс | Роль |
|---|---|
| **Email Routing** (catch-all) | Приём входящей почты на доменах, проброс в Worker |
| **Workers** | Ядро: `email()` приём + `fetch()` вебхук/ingest + `scheduled()` чистка |
| **D1** | Маппинг (localpart, domain) → chat_id, профили юзеров, телеметрия |
| **KV** | Счётчики rate-limit (TTL-ключи), denylist отправителей |
| **Cron Triggers** | Физическая чистка протухших адресов раз в час |
| **R2** | *(только фаза 2, Mini App)* хранение сырого MIME |

Внешних сервисов нет: ни SMTP, ни БД, ни платёжек. Telegram Bot API дёргается обычным `fetch()`.

---

## 2. Поток данных

```
письмо → MX домена → Email Routing (catch-all)
       → Worker.email() → парс MIME (PostalMime) → извлечь OTP + тело
       → D1: resolve (localpart, domain) → chat_id
       → Telegram sendMessage (код первой строкой)

/start → Worker.fetch() /webhook → выбрать домен по локали → сгенерить localpart
       → D1 insert → ответить юзеру адресом

план Б → Worker.fetch() /ingest (сырой MIME от своего MX) → тот же конвейер ingest()

Cron (hourly) → Worker.scheduled() → D1 DELETE expires_at <= now
```

---

## 3. Компоненты Worker

Один Worker (`src/index.js`), входы:

- **`email(message, env, ctx)`** — приём из CF Email Routing. Резолв `message.to` → `(localpart, domain)` → D1. Нет адреса / протух / не наш домен → `setReject('550 …')`. Есть → общий конвейер `ingest()`.
- **`fetch(request, env, ctx)`** — два маршрута:
  - `POST /webhook` — вебхук Telegram (защита через `secret_token`). Команды `/start`, `/help`, `/new`, кнопки. Промо-логика.
  - `POST /ingest?to=&from=` — источник-агностичный приём сырого MIME от внешнего MX-релея (защита `Authorization: Bearer`). Делит конвейер `ingest()` с `email()`. Это зашитый **план Б** на случай отключения CF Email Routing.
- **`scheduled(event, env, ctx)`** — Cron. Физическое удаление протухших строк из D1 (логически мертвы по `expires_at`).

---

## 4. Модель данных (D1)

**Почему D1, а не KV:** на горячем флоу (`/start` → вставка адреса → OTP через 10–20 сек) KV с eventual consistency может вернуть `null` (запись в одном colo, чтение в другом) — письмо теряется. D1 strongly consistent.

**Ключ адреса составной** `(localpart, domain)` — из-за мультидомена: `x7k2p9a1@mailbot.click` и `x7k2p9a1@emailbot.ru` — разные адреса.

```sql
CREATE TABLE boxes (
  localpart   TEXT NOT NULL,        -- x7k2p9a1
  domain      TEXT NOT NULL,        -- mailbot.click | emailbot.ru
  chat_id     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,     -- now + 24h; продление двигает вперёд
  PRIMARY KEY (localpart, domain)
);
CREATE INDEX idx_boxes_chat ON boxes(chat_id);
CREATE INDEX idx_boxes_exp  ON boxes(expires_at);

CREATE TABLE users (
  chat_id      INTEGER PRIMARY KEY,
  locale       TEXT,                -- language_code из TG, для выбора домена
  sessions     INTEGER DEFAULT 1,   -- возвратность
  boxes_total  INTEGER DEFAULT 0,   -- адресов создано
  otp_caught   INTEGER DEFAULT 0,   -- кодов поймано
  last_promo   INTEGER,             -- дата последнего промо
  created_at   INTEGER NOT NULL
);
```

TTL логический (`expires_at > now` в запросе на приём), физическая чистка отдельно Cron'ом: протухание мгновенное, удаление не блокирует горячий путь.

---

## 5. Ключевые модули

### 5.1 Генерация адреса (`src/boxes.js`)
- Алфавит `23456789abcdefghjkmnpqrstuvwxyz` — **31 символ без неоднозначных** (`0/o`, `1/l/i`).
- Длина **8** → 31⁸ ≈ 8.5·10¹¹. Перебор живых адресов (снятие чужих OTP) нереалистичен.
- При `/start`/`/new` — **проверка коллизии** с живым адресом, до 5 ретраев; протухшая строка с тем же ключом удаляется и место переиспользуется.
- Источник энтропии — `crypto.getRandomValues`.

### 5.2 OTP-экстрактор (`src/otp.js`)
Не «первое число», а **скоринг кандидатов**:
- вес по близости к ключевым словам (`code|verif|otp|код|подтвержд|…`, EN+RU);
- вес по позиции (субджект и начало тела весят больше);
- бонус за формат `\d{6}`, провайдерские паттерны (`G-123456`, сгруппированные `12 34 56`);
- анти-паттерны режут годы / время / суммы / телефоны (в т.ч. `+КОД страны`).
- Порог `score >= 4` — ниже **код не показываем** (лучше тишина, чем неверный код).
- Покрыт тестами (телефон/сумма/год/время корректно отсекаются).

### 5.3 HTML → текст (`src/html.js`)
Никакой конвертации в TG-HTML (теги почти не пересекаются → вечные `400`). Логика:
1. Сначала `email.text` (plain-часть `multipart/alternative`).
2. HTML только если text-части нет → стрипаем нативным `HTMLRewriter` (zero-dep), текст + ссылки отдельным блоком. Сырой URL plain Telegram сам делает кликабельным.

### 5.4 Отправка в TG (`src/telegram.js`, `src/index.js`)
- Код первой строкой: `🔑 <b>{otp}</b>` + дубль `<code>{otp}</code>` (тап = копирование).
- Тело письма **escape'ить** (`& < >`) перед вставкой.
- `parse_mode: 'HTML'` безопасен: теги ставим сами (код без спецсимволов), тело экранируем.
- Резать тело до ~3400 символов (лимит TG 4096).
- Вложения на MVP — строкой `📎 имя_файла`, сам файл дропаем.
- Превью ссылок отключено (`link_preview_options.is_disabled`).

---

## 6. Бот: команды и UX (`src/bot.js`)

- `/start` — upsert юзера (+session, locale), выбор домена по локали. Если активный адрес есть — показать его, не плодить; иначе создать.
- `/new` (кнопка «Новый адрес») — новый localpart, с учётом лимита активных.
- `/help` — что это, TTL, приватность, «не для важной почты».
- Кнопки: `Новый адрес` · `Продлить` · `Помощь`.
- Тон **сухой, инженерный**, без пафоса — аудитория техническая.

---

## 7. Монетизация: кросс-промо 301.st (`src/promo.js`)

Не Stars (комиссия/холд/низкий спрос), не рекламные сети (банят disposable-email). Вместо этого — свой оффер своей же аудитории: вебмастерский трафик на OTP = прямая ЦА для TDS/редиректов 301.st.

Правила показа (`maybePromo()`):
- **Право** = возвратность (`sessions >= 2`) **И** успех (`otp_caught >= 1`).
- **Что** = «вебмастер» (`boxes_total >= 3` или `otp_caught >= 3`) → оффер; обычный физик → тишина.
- **Частота** = не чаще раза в 30 дней (`last_promo`).
- **Момент** = отдельным сообщением **после** пойманного кода.
- **Атрибуция** = `301.st/?utm_source=gotemailbot&utm_campaign=otp_heavy&cid={chat_id}`.

> `301.st` — только цель промо в коде, не аккаунт проекта.

---

## 8. Защита от абьюза

- **Rate-limit на адрес** (KV-счётчик TTL): `RL_PER_HOUR` писем/час, выше — `550`.
- **Denylist отправителей** (KV-ключ `deny:{from}`).
- **Неизвестный/протухший адрес / не наш домен** → `550`, не молчаливый дроп (чище для репутации).
- **Лимит активных адресов** на chat_id (`MAX_ACTIVE_BOXES`, дефолт 2): при создании сверх лимита сносятся самые старые.

---

## 9. Конфиг (`src/config.js`, `wrangler.jsonc`)

Vars (с дефолтами, переопределяются на деплое):

| Var | Дефолт | Смысл |
|---|---|---|
| `DOMAINS` | `mailbot.click,emailbot.ru` | домены приёма; первый не-`.ru` = главный |
| `BOX_TTL_HOURS` | `24` | время жизни адреса |
| `MAX_ACTIVE_BOXES` | `2` | лимит активных адресов на юзера |
| `RL_PER_HOUR` | `30` | rate-limit писем на адрес в час |
| `PROMO_BASE` | `https://301.st/` | база промо-ссылки |

Выбор домена: RU-локаль (`language_code` ~ `ru*`) → первый `.ru`, иначе первый не-`.ru`.

Секреты (через `wrangler secret`, **не в репо**): `TG_TOKEN`, `TG_SECRET` (защита вебхука), `INGEST_SECRET` (план Б). Подробности деплоя — `cloudflare.md`.

---

## 10. Известные ограничения и риски

- **Email Routing** — только приём, отправка закрыта (нам не нужна).
- **ToS Email Routing** — фича под «свой домен»; публичный приём чужой почты в серой зоне. При потоке abuse-репортов CF может отключить routing на зоне. **Риск принят осознанно**; митигация — план Б (`/ingest` + внешний MX, напр. Yandex 360 / postfix).
- **`.ru` + ПДн** — публичный приём чужой почты на `.ru` = расширенная поверхность. На MVP «ничего не храним» — это и есть отличие от классических temp-mail. Фаза 2 (хранение) требует отдельной юридической проработки.
- **Размер письма** — до 25 MiB. **IP reputation** — shared inbound CF иногда отдаёт `451`. **Workers Free** — 50 сабреквестов/вызов (нужно 1–2).

---

## 11. Roadmap

**MVP (фаза 1, реализуется):** Email Routing + Worker (`email`/`fetch`/`scheduled`) + D1 + KV + OTP-экстрактор + текстовая доставка + бот + промо + мультидомен + план Б через `/ingest`. Письма не хранятся.

**Фаза 2 (Mini App):** webview для полного рендера HTML + вложений. Хранение MIME в R2 + метаданные в D1, TTL обязателен. Рендер только в `<iframe sandbox>` без `allow-scripts`/`allow-same-origin`, через DOMPurify, remote-картинки заблокированы (трекинг/деанон), показ через прокси на Worker. `initData` валидировать на сервере (HMAC, Web Crypto). Премиум-слой (вложения, история, vanity), rewarded-механика.

**Вне scope MVP:** отправка почты, хранение писем, Mini App, платежи, мультиязычный OTP за пределами EN/RU.
