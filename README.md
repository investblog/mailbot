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
src/            email-core + Telegram client (Cloudflare Worker)
  index.js        router: email() / fetch() / scheduled()
  ingest.js       pipeline: parse → normalize → deliver
  normalize.js    body cleanup + link tokenization
  otp.js          scoring OTP extractor
  boxes.js        addresses (gen/collision/limits)
  owners.js       owners + telemetry
  render.js       Telegram message builder
  delivery.js     deliver(owner, msg) seam
  strings.js      i18n (ru/en)
test/           node:test suites
landing/        Vite MPA landing (Cloudflare Pages), RU + EN
schema.sql      D1 schema (owners + boxes)
SPEC.md         technical specification
cloudflare.md   infrastructure & deploy runbook
```

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

On MVP, emails are **not stored** — they are parsed at Cloudflare's edge and delivered to your Telegram chat, where they live with you. Addresses are temporary by design and expire after 24h. It's a throwaway address for catching one-time codes — not for important mail.

## License

[MIT](LICENSE)

---

Built by [301.st](https://301.st) with [Claude](https://claude.ai)
