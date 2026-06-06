# Cloudflare — настройка и деплой

Операционный runbook gotemailbot. **Секретов здесь нет и быть не должно** (токены идут только через env / `wrangler secret`).

## Аккаунт и домены

| Параметр | Значение |
|---|---|
| CF-аккаунт | отдельный аккаунт проекта; доступ wrangler — через выделенный API-токен (`CLOUDFLARE_API_TOKEN`), не через интерактивный логин |
| Account ID | `d36a36cd1d5b17048d3b20a4c32aa7c7` (не секрет; прописан в `wrangler.jsonc`) |
| Git/GitHub | **investblog** (отдельно от CF) |
| Главный домен (не-RU) | `mailbot.click` |
| RU-домен | `emailbot.ru` |
| Worker | `gotemailbot` |
| Бот | `@gotemailbot` |

## Ресурсы и биндинги

| Биндинг | Тип | Имя | Назначение |
|---|---|---|---|
| `DB` | D1 | `gotemail` | адреса + юзеры |
| `RL` | KV | `RL` | rate-limit + denylist |
| — | Cron | `0 * * * *` | чистка протухших адресов |
| `R2` | R2 | *(фаза 2)* | сырой MIME |

После создания вписать `database_id` (D1) и `id` (KV) в `wrangler.jsonc`.

## API-токен: скоупы

Создавать через CF Dashboard → My Profile → API Tokens → Create Custom Token. Передавать wrangler как env `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`), **не в файлы**.

**Account-level** (аккаунт investblog):
- Workers Scripts — **Edit** (деплой, секреты, Cron)
- Workers KV Storage — **Edit**
- D1 — **Edit**
- Email Routing Addresses — **Edit**
- Account Settings — **Read** (whoami)
- Workers Tail — Read *(опц., для `wrangler tail`)*

**Zone-level** (зоны `mailbot.click`, `emailbot.ru`):
- Email Routing Rules — **Edit**
- DNS — **Edit** (включение Routing пишет MX/TXT)
- Zone — **Read**

Cron и секреты отдельных скоупов не требуют (входят в Workers Scripts: Edit). Workers Routes: Edit нужен только для кастом-доменных маршрутов (для `*.workers.dev` — нет). В Account/Zone Resources выбирать **конкретный** аккаунт и **конкретные** зоны.

Проверка токена:
```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
# ожидаем: "This API Token is valid and active"
```

## Секреты Worker

Ставятся через `wrangler secret put` (значения — из `.dev.vars`, который в `.gitignore`):

| Секрет | Назначение |
|---|---|
| `TG_TOKEN` | токен бота `@gotemailbot` |
| `TG_SECRET` | проверка вебхука (`secret_token` Telegram) |
| `INGEST_SECRET` | Bearer для `POST /ingest` (план Б) |

## Деплой (по шагам)

```bash
npm install
export CLOUDFLARE_API_TOKEN=...            # из дашборда, в env а не в файл
export CLOUDFLARE_ACCOUNT_ID=d36a36cd1d5b17048d3b20a4c32aa7c7

# ресурсы
wrangler d1 create gotemail                # → database_id в wrangler.jsonc
wrangler kv namespace create RL            # → id в wrangler.jsonc
npm run db:init                            # schema.sql на remote

# секреты
wrangler secret put TG_TOKEN               # значение из .dev.vars
wrangler secret put TG_SECRET              # любой длинный рандом
wrangler secret put INGEST_SECRET          # (опц.) для плана Б

# деплой
wrangler deploy

# вебхук бота с проверкой секрета:
curl "https://api.telegram.org/bot<TG_TOKEN>/setWebhook" \
  -d url="https://gotemailbot.<sub>.workers.dev/webhook" \
  -d secret_token="<TG_SECRET>"
```

## Email Routing (только через дашборд/API)

В `wrangler.jsonc` inbound-правил нет. Для **каждого** домена из `DOMAINS`:

1. Зона → **Email** → включить **Email Routing** (CF пропишет MX/TXT/SPF).
2. **Routes** → **Catch-all address** → Action: **Send to a Worker** → `gotemailbot`.
3. Дождаться валидации MX (статус Active).

## План Б (если CF свернёт routing на зоне)

`fetch()` принимает сырой MIME на `POST /ingest?to=&from=` с `Authorization: Bearer $INGEST_SECRET`.
Любой внешний MX (Yandex 360, postfix на VPS) форвардит письма сюда — `email()` и `/ingest` делят один конвейер `ingest()`, код не меняется. Достаточно увести MX-записи зоны на внешний релей и настроить форвард на эндпоинт Worker.

## Локальная разработка

```bash
npm run db:init:local
# .dev.vars уже содержит TG_TOKEN (в .gitignore)
wrangler dev
```

## Диагностика

- `wrangler tail` — живые логи Worker (нужен Workers Tail: Read).
- Письмо не дошло → проверить: MX зоны Active? Catch-all → Worker? адрес не протух (`expires_at`)? не сработал rate-limit (`550`)?
- Вебхук молчит → `getWebhookInfo`, проверить совпадение `secret_token`.
