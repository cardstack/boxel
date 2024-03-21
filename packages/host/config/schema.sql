CREATE TABLE IF NOT EXISTS indexed_cards (
  card_url TEXT NOT NULL
  realm_version INTEGER NOT NULL,
  realm_url TEXT NOT NULL,
  pristine_doc JSON,
  search_doc JSON,
  error_doc JSON,
  deps JSON,
  embedded_html TEXT,
  isolated_html TEXT,
  indexed_at INTEGER,
  is_deleted BOOLEAN,
  PRIMARY KEY (card_url, realm_version)
);

CREATE TABLE IF NOT EXISTS realm_versions (
  realm_url TEXT PRIMARY KEY,
  current_version INTEGER,
);

CREATE INDEX IF NOT EXISTS realm_version_idx ON indexed_cards (realm_version);
CREATE INDEX IF NOT EXISTS deps_type_idx ON indexed_cards (json_type(deps));
CREATE INDEX IF NOT EXISTS deps_each_idx ON indexed_cards (json_each(deps));
