export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS boxel_index (
  url TEXT NOT NULL,
  file_alias TEXT NOT NULL,
  type TEXT NOT NULL,
  generation INTEGER NOT NULL,
  realm_url TEXT NOT NULL,
  pristine_doc TEXT,
  search_doc TEXT,
  error_doc TEXT,
  deps TEXT DEFAULT '[]',
  types TEXT,
  indexed_at INTEGER,
  is_deleted INTEGER DEFAULT 0,
  last_modified INTEGER,
  display_names TEXT,
  resource_created_at INTEGER,
  icon_html TEXT,
  has_error INTEGER DEFAULT 0 NOT NULL,
  last_known_good_deps TEXT,
  diagnostics TEXT,
  PRIMARY KEY (url, realm_url, type)
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  body TEXT NOT NULL,
  card_url TEXT,
  created_at INTEGER NOT NULL,
  sync_state TEXT NOT NULL DEFAULT 'local',
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE TABLE IF NOT EXISTS sync_manifest (
  realm_url TEXT PRIMARY KEY,
  files_json TEXT NOT NULL,
  remote_mtimes_json TEXT NOT NULL
);
`;

const REALM_URL = 'https://local.boxel/preview/';

function cardTitle(attributes, fileAlias) {
  const first = attributes.firstName || attributes.title || '';
  const last = attributes.lastName || '';
  const name = `${first} ${last}`.trim();
  if (name) return name;
  return fileAlias.replace(/\.json$/, '');
}

function fileAliasFromPath(relativePath) {
  return relativePath.replace(/\.json$/, '');
}

function instanceUrl(relativePath) {
  return new URL(relativePath.replace(/\.json$/, ''), REALM_URL).href;
}

export class LiteIndexer {
  constructor(db, realmUrl = REALM_URL) {
    this.db = db;
    this.realmUrl = realmUrl;
    this.generation = 1;
  }

  /**
   * Walk a realm filesystem and upsert JSON:API card instances into
   * boxel_index. Modules and other non-card files are stored as type='file'
   * rows so the index still knows they exist.
   */
  indexFilesystem(fs) {
    this.generation += 1;
    const seen = new Set();

    for (const relativePath of fs.list()) {
      if (relativePath.startsWith('.') || relativePath.includes('/.')) {
        continue;
      }
      const stat = fs.stat(relativePath);
      const content = fs.read(relativePath);
      seen.add(relativePath);

      if (relativePath.endsWith('.json')) {
        this.#indexCard(relativePath, content, stat);
      } else {
        this.#indexFile(relativePath, content, stat);
      }
    }

    const existing = this.db.all(
      `SELECT file_alias FROM boxel_index WHERE realm_url = ? AND is_deleted = 0`,
      [this.realmUrl],
    );
    for (const row of existing) {
      const asJson = `${row.file_alias}.json`;
      const asFile = row.file_alias;
      if (!seen.has(asJson) && !seen.has(asFile) && !seen.has(row.file_alias)) {
        this.db.run(
          `UPDATE boxel_index SET is_deleted = 1, indexed_at = ? WHERE file_alias = ? AND realm_url = ?`,
          [Date.now(), row.file_alias, this.realmUrl],
        );
      }
    }

    return this.stats();
  }

  #indexCard(relativePath, content, stat) {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      this.#writeError(relativePath, 'invalid JSON', stat);
      return;
    }
    const resource = parsed?.data;
    if (!resource || resource.type !== 'card') {
      this.#indexFile(relativePath, content, stat);
      return;
    }

    const attributes = resource.attributes ?? {};
    const adoptsFrom = resource.meta?.adoptsFrom ?? { module: '', name: '' };
    const alias = fileAliasFromPath(relativePath);
    const url = resource.id || instanceUrl(relativePath);
    const title = cardTitle(attributes, alias);
    const searchDoc = {
      title,
      _cardTitle: title,
      ...attributes,
    };
    const types = [
      `${adoptsFrom.module ?? ''}/${adoptsFrom.name ?? 'CardDef'}`,
    ];

    this.db.run(
      `INSERT INTO boxel_index (
         url, file_alias, type, generation, realm_url,
         pristine_doc, search_doc, deps, types, indexed_at,
         is_deleted, last_modified, display_names, resource_created_at,
         has_error
       ) VALUES (?, ?, 'instance', ?, ?, ?, ?, '[]', ?, ?, 0, ?, ?, ?, 0)
       ON CONFLICT(url, realm_url, type) DO UPDATE SET
         file_alias = excluded.file_alias,
         generation = excluded.generation,
         pristine_doc = excluded.pristine_doc,
         search_doc = excluded.search_doc,
         types = excluded.types,
         indexed_at = excluded.indexed_at,
         is_deleted = 0,
         last_modified = excluded.last_modified,
         display_names = excluded.display_names,
         has_error = 0,
         error_doc = NULL`,
      [
        url,
        alias,
        this.generation,
        this.realmUrl,
        JSON.stringify(resource),
        JSON.stringify(searchDoc),
        JSON.stringify(types),
        Date.now(),
        stat?.mtimeMs ?? Date.now(),
        JSON.stringify([title]),
        stat?.mtimeMs ?? Date.now(),
      ],
    );
  }

  #indexFile(relativePath, _content, stat) {
    const url = new URL(relativePath, this.realmUrl).href;
    this.db.run(
      `INSERT INTO boxel_index (
         url, file_alias, type, generation, realm_url,
         indexed_at, is_deleted, last_modified, has_error
       ) VALUES (?, ?, 'file', ?, ?, ?, 0, ?, 0)
       ON CONFLICT(url, realm_url, type) DO UPDATE SET
         generation = excluded.generation,
         indexed_at = excluded.indexed_at,
         is_deleted = 0,
         last_modified = excluded.last_modified`,
      [
        url,
        relativePath,
        this.generation,
        this.realmUrl,
        Date.now(),
        stat?.mtimeMs ?? Date.now(),
      ],
    );
  }

  #writeError(relativePath, message, stat) {
    const url = new URL(relativePath, this.realmUrl).href;
    this.db.run(
      `INSERT INTO boxel_index (
         url, file_alias, type, generation, realm_url,
         error_doc, indexed_at, is_deleted, last_modified, has_error
       ) VALUES (?, ?, 'file', ?, ?, ?, ?, 0, ?, 1)
       ON CONFLICT(url, realm_url, type) DO UPDATE SET
         error_doc = excluded.error_doc,
         has_error = 1,
         indexed_at = excluded.indexed_at`,
      [
        url,
        relativePath,
        this.generation,
        this.realmUrl,
        JSON.stringify({ message }),
        Date.now(),
        stat?.mtimeMs ?? Date.now(),
      ],
    );
  }

  search(queryText = '') {
    const q = queryText.trim();
    if (!q) {
      return this.db.all(
        `SELECT url, file_alias, types, search_doc, pristine_doc, indexed_at
         FROM boxel_index
         WHERE type = 'instance' AND is_deleted = 0 AND realm_url = ?
         ORDER BY json_extract(search_doc, '$.title') COLLATE NOCASE`,
        [this.realmUrl],
      );
    }
    const like = `%${q}%`;
    return this.db.all(
      `SELECT url, file_alias, types, search_doc, pristine_doc, indexed_at
       FROM boxel_index
       WHERE type = 'instance'
         AND is_deleted = 0
         AND realm_url = ?
         AND (
           file_alias LIKE ? COLLATE NOCASE
           OR json_extract(search_doc, '$.title') LIKE ? COLLATE NOCASE
           OR json_extract(search_doc, '$.firstName') LIKE ? COLLATE NOCASE
           OR json_extract(search_doc, '$.lastName') LIKE ? COLLATE NOCASE
         )
       ORDER BY json_extract(search_doc, '$.title') COLLATE NOCASE`,
      [this.realmUrl, like, like, like, like],
    );
  }

  getByAlias(alias) {
    return this.db.get(
      `SELECT url, file_alias, types, search_doc, pristine_doc, indexed_at
       FROM boxel_index
       WHERE file_alias = ? AND realm_url = ? AND is_deleted = 0
       LIMIT 1`,
      [alias, this.realmUrl],
    );
  }

  stats() {
    const instances = this.db.get(
      `SELECT COUNT(*) AS n FROM boxel_index WHERE type = 'instance' AND is_deleted = 0 AND realm_url = ?`,
      [this.realmUrl],
    );
    const files = this.db.get(
      `SELECT COUNT(*) AS n FROM boxel_index WHERE type = 'file' AND is_deleted = 0 AND realm_url = ?`,
      [this.realmUrl],
    );
    return {
      instances: Number(instances?.n ?? 0),
      files: Number(files?.n ?? 0),
      generation: this.generation,
    };
  }
}

export { REALM_URL };
