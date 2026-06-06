# gotemailbot

Одноразовая почта в Telegram. `/start` → адрес `*@mailbot.click`, всё пришедшее прилетает в чат, OTP первой строкой. Адрес живёт сутки. Edge-first, всё на Cloudflare. (Мультидомен в коде есть; старт на одном домене.)

**Доки:** [`SPEC.md`](SPEC.md) — финальное тех-задание · [`cloudflare.md`](cloudflare.md) — инфраструктура и деплой.

## Структура

```
src/  (email-core — client-agnostic)
  index.js     маршрутизатор входов: email() / fetch() / scheduled()
  ingest.js    конвейер письма: parse → нормализация → deliver()
  boxes.js     адреса (генерация/коллизии/лимиты), привязка к owner_id
  owners.js    владельцы (upsert/ensure) + телеметрия
  otp.js       скоринговый OTP-экстрактор (порог >= 4)
  html.js      HTML→текст через HTMLRewriter
  ratelimit.js общие abuse-проверки (denylist, rate-limit на адрес и /new)
  config.js    конфиг из env, выбор домена по локали
src/  (delivery seam)
  delivery.js  deliver(owner, msg) — диспатч по owner.kind
src/  (clients)
  bot.js       Telegram: /start /new /help + кнопки
  telegram.js  TG Bot API + escape + ретрай транзиента
  render.js    сборка TG-сообщения с контролем итоговой длины
  promo.js     кросс-промо 301.st
test/          otp / ratelimit / render / boxes / delivery
  helpers/d1.mjs  D1-шим над node:sqlite
scripts/
  preflight.mjs deploy guard (npm run preflight)
schema.sql     D1: owners + boxes (PK localpart+domain)
wrangler.jsonc конфиг Worker
.github/workflows/ci.yml  npm ci → lint → test → dry-run
```

Проверки: `npm run check` (lint + test + dry-run) · по отдельности `npm test` / `npm run lint`.

## Деплой

```bash
npm install

wrangler d1 create gotemail                 # вставить database_id в wrangler.jsonc
wrangler kv namespace create RL             # вставить id в wrangler.jsonc
npm run db:init                             # применить schema.sql на remote

wrangler secret put TG_TOKEN                # токен бота
wrangler secret put TG_SECRET               # любой секрет для защиты вебхука
wrangler secret put INGEST_SECRET           # (опц.) для HTTP-приёма от своего MX-релея

wrangler deploy

# вебхук бота (с проверкой секрета):
curl "https://api.telegram.org/bot$TG_TOKEN/setWebhook" \
  -d url="https://gotemailbot.<sub>.workers.dev/webhook" \
  -d secret_token="$TG_SECRET"
```

**Email Routing** (только через дашборд/API, в wrangler нет inbound-правил):
домен → Email → включить Routing (пропишет MX/TXT) → Routes → **Catch-all → Send to a Worker → gotemailbot**. Повторить для каждого домена из `DOMAINS`.

## План Б (если CF свернёт routing на зоне)

`fetch()` принимает сырой MIME на `POST /ingest?to=&from=` с `Authorization: Bearer $INGEST_SECRET`.
Любой внешний MX (Yandex 360 для бизнеса, postfix на VPS) может форвардить письма сюда — `email()` и `/ingest` делят один конвейер `ingest()`.

## Локальная разработка

```bash
npm run db:init:local
echo "TG_TOKEN=..." > .dev.vars
wrangler dev
```
