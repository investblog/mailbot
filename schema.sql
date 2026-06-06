-- gotemailbot — схема D1 (owner-oriented).
--
-- Архитектура: email-core не привязан к Telegram. Адресами владеет OWNER.
-- Telegram-бот — первый клиент (owner.kind='telegram', external_id=chat_id).
-- Будущий browser extension — второй клиент (kind='extension'/'account'), без переписывания ядра.

CREATE TABLE IF NOT EXISTS owners (
  id           TEXT PRIMARY KEY,    -- opaque, kind-specific (telegram: "tg:<chat_id>")
  kind         TEXT NOT NULL,       -- telegram | extension | account
  external_id  TEXT,                -- chat_id для telegram; device/account id в будущем
  locale       TEXT,                -- для выбора домена (telegram: language_code)
  -- телеметрия владельца (для промо/аналитики)
  sessions     INTEGER DEFAULT 1,   -- возвратность
  boxes_total  INTEGER DEFAULT 0,   -- адресов создано
  otp_caught   INTEGER DEFAULT 0,   -- кодов поймано
  last_promo   INTEGER,             -- unix seconds последнего промо
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (kind, external_id)
);

-- Адрес = (localpart, domain): мультидомен, поэтому ключ составной.
CREATE TABLE IF NOT EXISTS boxes (
  localpart   TEXT NOT NULL,        -- x7k2p9a1 (алфавит без 0/o/1/l/i)
  domain      TEXT NOT NULL,        -- mailbot.click (+ запасные домены позже)
  owner_id    TEXT NOT NULL,        -- → owners.id
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,     -- now + TTL; продление двигает вперёд
  PRIMARY KEY (localpart, domain)
);
CREATE INDEX IF NOT EXISTS idx_boxes_owner ON boxes(owner_id);
CREATE INDEX IF NOT EXISTS idx_boxes_exp   ON boxes(expires_at);
