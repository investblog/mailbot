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

-- Входящие письма для клиентов, которые показывают их сами (расширение).
-- Telegram-бот сюда НЕ пишет (он доставляет в чат и ничего не хранит).
-- Только нормализованный текст (без raw MIME). TTL = жизнь адреса, чистка по Cron.
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,     -- random hex
  owner_id    TEXT NOT NULL,        -- → owners.id (ext:<hash>)
  localpart   TEXT NOT NULL,
  domain      TEXT NOT NULL,
  from_addr   TEXT,
  subject     TEXT,
  otp         TEXT,
  payload     TEXT,                 -- JSON: { v, body, tokens, links, attachments }
  created_at_ms INTEGER NOT NULL,   -- unix ms (курсор для polling)
  expires_at  INTEGER NOT NULL      -- = box.expires_at (unix seconds)
);
-- Курсор polling = (created_at_ms, id): монотонно, не теряет письма с одинаковым ms.
CREATE INDEX IF NOT EXISTS idx_messages_owner ON messages(owner_id, created_at_ms, id);
CREATE INDEX IF NOT EXISTS idx_messages_exp   ON messages(expires_at);
