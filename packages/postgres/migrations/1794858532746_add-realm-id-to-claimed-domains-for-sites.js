// A site-name claim names its realm by `realm_registry.id` (ADR 033 §1.1), so
// the claim stays with the realm when the realm's URL changes.
//
// `claimed_domain_realm_url` puts a claim's `source_realm_url` in the form
// `realm_registry.url` uses: no query string or fragment, and a trailing
// slash. The claim endpoint stored the URL as the caller sent it, so a stored
// URL can lack the slash.
//
// The backfill and the trigger both find the realm by that form:
//
// - The backfill fills `realm_id` on existing claims.
// - The trigger fills `realm_id` on a claim written without one. The previous
//   code revision writes only `source_realm_url`, and it keeps serving while
//   a deploy rolls out after this migration has run. The trigger keeps its
//   claims visible to the lookup by id.
//
// A claim whose URL matches no registry row names a realm that no longer
// exists under that URL. It keeps a NULL `realm_id`, and its hostname stays
// claimed.
//
// Deleting a registry row sets its claims' `realm_id` to NULL rather than
// deleting them, so a removed claim's history survives the realm. The realm
// delete handler marks the claims removed before it deletes the row.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE claimed_domains_for_sites
      ADD COLUMN IF NOT EXISTS realm_id uuid
        REFERENCES realm_registry (id) ON DELETE SET NULL
  `);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION claimed_domain_realm_url(url text)
    RETURNS text AS $$
      SELECT CASE
        WHEN base LIKE '%/' THEN base
        ELSE base || '/'
      END
      FROM (SELECT split_part(split_part(url, '#', 1), '?', 1) AS base) s
    $$ LANGUAGE sql IMMUTABLE
  `);
  pgm.sql(`
    UPDATE claimed_domains_for_sites c
      SET realm_id = r.id
      FROM realm_registry r
      WHERE c.realm_id IS NULL
        AND r.url = claimed_domain_realm_url(c.source_realm_url)
  `);
  pgm.sql(`
    CREATE OR REPLACE FUNCTION claimed_domains_for_sites_fill_realm_id()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.realm_id IS NULL THEN
        SELECT id INTO NEW.realm_id
          FROM realm_registry
          WHERE url = claimed_domain_realm_url(NEW.source_realm_url);
      END IF;
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql
  `);
  pgm.sql(`
    DROP TRIGGER IF EXISTS claimed_domains_for_sites_fill_realm_id
      ON claimed_domains_for_sites
  `);
  pgm.sql(`
    CREATE TRIGGER claimed_domains_for_sites_fill_realm_id
      BEFORE INSERT OR UPDATE OF source_realm_url ON claimed_domains_for_sites
      FOR EACH ROW EXECUTE FUNCTION claimed_domains_for_sites_fill_realm_id()
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS claimed_domains_for_sites_realm_id_idx
      ON claimed_domains_for_sites (realm_id)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS claimed_domains_for_sites_realm_id_idx`);
  pgm.sql(`
    DROP TRIGGER IF EXISTS claimed_domains_for_sites_fill_realm_id
      ON claimed_domains_for_sites
  `);
  pgm.sql(`DROP FUNCTION IF EXISTS claimed_domains_for_sites_fill_realm_id()`);
  pgm.sql(
    `ALTER TABLE claimed_domains_for_sites DROP COLUMN IF EXISTS realm_id`,
  );
  pgm.sql(`DROP FUNCTION IF EXISTS claimed_domain_realm_url(text)`);
};
