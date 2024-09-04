CREATE TABLE IF NOT EXISTS indexed_cards (
  card_url TEXT NOT NULL,
  realm_version INTEGER NOT NULL,
  realm_url TEXT NOT NULL,
  -- WARNING SQLite doesn't actually have a JSON type. Rather JSON just falls
  -- back to TEXT which can be recognized as JSON via SQLite JSON functions as
  -- part of queries
  pristine_doc JSON,
  search_doc JSON,
  error_doc JSON,
  deps JSON,
  types JSON,
  embedded_html TEXT,
  isolated_html TEXT,
  indexed_at INTEGER,
  -- WARNING SQLite doesn't have a BOOLEAN type, but it does recognize TRUE and
  -- FALSE. These values will be returned as 1 and 0 in SQLite result sets
  is_deleted BOOLEAN,
  PRIMARY KEY (card_url, realm_version)
);

CREATE TABLE IF NOT EXISTS realm_versions (
  realm_url TEXT NOT NULL PRIMARY KEY,
  current_version INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS realm_version_idx ON indexed_cards (realm_version);
CREATE INDEX IF NOT EXISTS realm_url_idx ON indexed_cards (realm_url);
CREATE INDEX IF NOT EXISTS current_version_idx ON realm_versions (current_version);
