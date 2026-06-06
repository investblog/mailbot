# gotemailbot

Одноразовая почта в Telegram. `/start` → адрес `*@mailbot.click` (для RU-локали — `*@emailbot.ru`), всё пришедшее прилетает в чат, OTP первой строкой. Адрес живёт сутки. Edge-first, всё на Cloudflare.

**Доки:** [`SPEC.md`](SPEC.md) — финальное тех-задание · [`cloudflare.md`](cloudflare.md) — инфраструктура и деплой.

## Структура

```
src/
  index.js     три входа: email() / fetch() / scheduled() + ingest()
  bot.js       вебхук: /start /new /help + кнопки
  boxes.js     адреса (генерация/коллизии/лимиты) + users
  otp.js       скоринговый OTP-экстрактор (порог >= 4)
  html.js      HTML→текст через HTMLRewriter
  telegram.js  TG Bot API + escape
  ratelimit.js общие abuse-проверки (denylist, rate-limit на адрес и /new)
  promo.js     кросс-промо 301.st
  config.js    конфиг из env, выбор домена по локали
test/
  otp.test.mjs acceptance-контракт OTP (npm test)
schema.sql     D1: boxes (PK localpart+domain), users
wrangler.jsonc конфиг Worker
```

Тесты: `npm test` (node --test, без зависимостей).

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
