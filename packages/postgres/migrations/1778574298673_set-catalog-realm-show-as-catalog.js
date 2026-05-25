// The /catalog realm's .realm.json never had showAsCatalog, so the
// CS-10053 backfill never seeded show_as_catalog for it. PR #4712
// tightened the catalog-realms handler to require show_as_catalog = true
// (opt-in), so the catalog realm stopped appearing in /_catalog-realms.
// This migration backfills the correct value for all environments.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO realm_metadata (url, show_as_catalog)
    SELECT rup.realm_url, true
    FROM realm_user_permissions rup
    WHERE rup.username = '*' AND rup.read = true AND rup.realm_url LIKE '%/catalog/'
    ON CONFLICT (url) DO UPDATE SET show_as_catalog = true
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE realm_metadata SET show_as_catalog = NULL
    WHERE url IN (
      SELECT realm_url FROM realm_user_permissions
      WHERE username = '*' AND read = true AND realm_url LIKE '%/catalog/'
    )
  `);
};
