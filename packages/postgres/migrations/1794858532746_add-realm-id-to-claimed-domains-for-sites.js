// A site-name claim names its realm by `realm_registry.id` (ADR 033 §1.1), so
// the claim stays with the realm when the realm's URL changes.
//
// The backfill matches each claim's `source_realm_url` to a registry row's
// `url`. A claim whose URL matches no registry row names a realm that no
// longer exists under that URL; it keeps a NULL `realm_id`, and its hostname
// stays claimed.
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
    UPDATE claimed_domains_for_sites c
      SET realm_id = r.id
      FROM realm_registry r
      WHERE c.realm_id IS NULL
        AND r.url = c.source_realm_url
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS claimed_domains_for_sites_realm_id_idx
      ON claimed_domains_for_sites (realm_id)
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS claimed_domains_for_sites_realm_id_idx`);
  pgm.sql(
    `ALTER TABLE claimed_domains_for_sites DROP COLUMN IF EXISTS realm_id`,
  );
};
