// The host URLs a realm is served at (ADR 033). A host URL is a host and a
// path prefix; a request whose URL falls under one is routed to the realm it
// names before any other lookup. A realm may have many host URLs, and exactly
// one of them is canonical.
//
// Each row names its realm by `realm_registry.id`, not by URL, so a host URL
// survives anything that changes the realm's URL, and deleting the realm
// deletes its host URLs.
//
// `host` is the URL's lowercased host, with its port when it isn't the
// default one. `path_prefix` starts and ends with `/`; a host URL at the root
// of its host has the prefix `/`. `kind` records how the address was given out:
// a Boxel Space path (`boxel-space`), a claimed site name (`site-name`), or a
// custom domain from the deployment's overrides (`custom-domain`).
//
// The database holds at most one canonical host URL per realm. Keeping at least
// one while a realm has any is the writer's job, in the same transaction as the
// change that would leave none.
//
// Server-only, and excluded from the SQLite schema dump.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS realm_host_urls (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      realm_id uuid NOT NULL REFERENCES realm_registry (id) ON DELETE CASCADE,
      kind text NOT NULL,
      host text NOT NULL,
      path_prefix text NOT NULL DEFAULT '/',
      is_canonical boolean NOT NULL DEFAULT false,
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT realm_host_urls_kind_check
        CHECK (kind IN ('boxel-space', 'site-name', 'custom-domain')),
      CONSTRAINT realm_host_urls_host_check
        CHECK (host <> '' AND host = lower(host)),
      CONSTRAINT realm_host_urls_path_prefix_check
        CHECK (path_prefix LIKE '/%' AND path_prefix LIKE '%/')
    )
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS realm_host_urls_host_path_prefix_idx
      ON realm_host_urls (host, path_prefix)
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS realm_host_urls_one_canonical_idx
      ON realm_host_urls (realm_id) WHERE is_canonical
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS realm_host_urls_realm_id_idx
      ON realm_host_urls (realm_id)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS realm_host_urls`);
};
