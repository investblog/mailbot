-- gotemailbot — схема D1.
-- Адрес = (localpart, domain): мультидомен, поэтому ключ составной.

CREATE TABLE IF NOT EXISTS boxes (
  localpart   TEXT NOT NULL,        -- x7k2p9a1 (алфавит без 0/o/1/l/i)
  domain      TEXT NOT NULL,        -- emailbot.ru | emailbot.io
  chat_id     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,     -- unix seconds
  expires_at  INTEGER NOT NULL,     -- now + TTL; продление двигает вперёд
  PRIMARY KEY (localpart, domain)
);
CREATE INDEX IF NOT EXISTS idx_boxes_chat ON boxes(chat_id);
CREATE INDEX IF NOT EXISTS idx_boxes_exp  ON boxes(expires_at);

CREATE TABLE IF NOT EXISTS users (
  chat_id      INTEGER PRIMARY KEY,
  locale       TEXT,                -- language_code из TG, для выбора домена
  sessions     INTEGER DEFAULT 1,   -- возвратность
  boxes_total  INTEGER DEFAULT 0,   -- адресов создано всего
  otp_caught   INTEGER DEFAULT 0,   -- кодов поймано
  last_promo   INTEGER,             -- unix seconds последнего показа промо
  created_at   INTEGER NOT NULL
);
