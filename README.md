# MailBot

Disposable email, inside Telegram. Press `/start`, get an address, paste it anywhere — every message lands in your chat with the **OTP code on the first line**. Addresses live 24h and expire on their own. Edge-first, nothing stored.

[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Telegram](https://img.shields.io/badge/Telegram-%40gotemailbot-2CA5E0?logo=telegram&logoColor=white)](https://t.me/gotemailbot)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

**Try it:** [@gotemailbot](https://t.me/gotemailbot) · [mailbot.click](https://mailbot.click) (EN) · [emailbot.ru](https://emailbot.ru) (RU)

## Features

- **OTP on the first line** — smart scoring extracts the verification code and puts it first; tap to copy
- **24-hour addresses** — each address expires on its own; create a new one anytime
- **Nothing stored** — mail is parsed at the edge and forwarded to your chat, not kept on our side
- **Email normalization** — strips forwarded headers, invisible junk, logo links; renders `Label <url>` as clickable Telegram links
- **Bilingual** — RU/EN by Telegram locale (UI + email labels)
- **Abuse protection** — per-address and per-user rate limits, sender denylist, size guard
- **Edge-first** — runs entirely on Cloudflare (Email Routing + Workers + D1 + KV), no backend

## How it works

```
email → MX → Cloudflare Email Routing (catch-all) → Worker.email()
      → abuse checks → resolve (localpart, domain) → owner
      → parse MIME → normalize → extract OTP → deliver to Telegram

/start → Worker.fetch() webhook → create address → reply
Cron   → Worker.scheduled() → purge expired addresses
```

The core (`email-core`) is client-agnostic and tied to an **owner** abstraction, not to a Telegram chat — so a future browser-extension client can be added without rewriting the core. See [SPEC.md](SPEC.md) §13.

## Project layout

```
src/            email-core + Telegram client + extension API (Cloudflare Worker)
  index.js        router: email() / fetch() (/webhook, /ingest, /api/*) / scheduled()
  ingest.js       pipeline: parse → normalize → deliver
  normalize.js    body cleanup + link tokenization
  otp.js          scoring OTP extractor
  boxes.js        addresses (gen/collision/limits/provision)
  owners.js       owners + telemetry
  messages.js     stored inbox events (for extension client, TTL)
  delivery.js     deliver(owner, msg) seam — telegram | extension/account
  api.js          /api/* for the browser extension (device-token auth)
  render.js       Telegram message builder
  strings.js      i18n (ru/en)
test/           node:test suites
landing/        Vite MPA landing (Cloudflare Pages), RU + EN
extension/      browser extension (WXT, Chrome/Edge + Firefox) — popup inbox
schema.sql      D1 schema (owners + boxes + messages)
SPEC.md         technical specification
cloudflare.md   infrastructure & deploy runbook
```

## Clients

Two clients sit on one client-agnostic **email-core** (owner abstraction + `deliver(owner,msg)` seam):

- **Telegram bot** ([@gotemailbot](https://t.me/gotemailbot)) — delivers to chat, **stores nothing**.
- **Browser extension** (`extension/`, WXT) — popup inbox with OTP detection. Anonymous device-token auth; incoming events are stored server-side in D1 (text only, 24h TTL) so the extension can display them. Polls the `/api/*` endpoints.

## Development

```bash
git clone https://github.com/investblog/mailbot.git
cd mailbot

# Worker (email-core + bot)
npm install
npm test          # node --test (otp/normalize/render/ratelimit/boxes/delivery/strings)
npm run lint      # ESLint
npm run check     # lint + test + wrangler dry-run

# Landing (RU + EN)
cd landing
npm install
npm run build     # EN at /, RU at /ru/
npm run build:ru  # RU at root (for emailbot.ru)
```

Deploy and infrastructure details (D1/KV, Email Routing, secrets, scopes): [cloudflare.md](cloudflare.md).

## Tech stack

- **Cloudflare Workers** — `email()` + `fetch()` + `scheduled()`, `nodejs_compat`
- **D1** (SQLite) — owners + addresses · **KV** — rate-limit/denylist · **Cron** — cleanup
- **[PostalMime](https://github.com/postalsys/postal-mime)** — MIME parsing · `HTMLRewriter` — HTML→text
- **Landing:** Vite + vanilla TS, design system from [301-ui](https://301.st), Cloudflare Pages
- Telegram Bot API over plain `fetch()` — no SMTP, no external services

## Privacy

**Telegram bot:** emails are **not stored** — parsed at Cloudflare's edge and delivered to your chat, where they live with you.

**Browser extension:** since it must display the inbox itself, incoming emails are stored server-side (Cloudflare D1) as **normalized text only** (no raw MIME, no attachments), with a **24h TTL** matching the address lifetime, then auto-purged. Auth is an anonymous device-token (no account, no email/password); the server keeps only its hash.

Either way, addresses are temporary by design and expire after 24h — a throwaway address for catching one-time codes, not for important mail.

## License

[MIT](LICENSE)

---

Built by [301.st](https://301.st) with [Claude](https://claude.ai)
