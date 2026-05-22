// CS-10053 — moves realm-level metadata flags out of the legacy
// .realm.json sidecar and into a database table. Two flags move in this
// ticket (showAsCatalog, publishable). The table is intentionally
// open-ended so future fields (hostHome / interactHome from CS-10055,
// realmUserId, etc.) can land as additional columns without re-doing
// the schema design.
//
// Why a new table rather than columns on realm_registry:
//   - These are mutable per-realm settings, not realm identity.
//   - realm_registry has kind-conditional CHECK constraints; piling
//     mutable columns on top would muddy that contract.
//   - Decoupling lets a missing/late registry row not block metadata
//     reads or writes (and vice versa).
//
// Default privileges from 1751981407344_setup-grafana-db-user.js
// already grant SELECT on every public-schema table to readonly_role,
// so this table is automatically visible to grafana / claude DB users
// without an explicit GRANT here.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('realm_metadata', {
    // Canonical realm URL (matching realm_registry.url shape — varchar
    // with trailing slash). PRIMARY KEY enforces one row per realm.
    // Intentionally not a foreign key to realm_registry: source and
    // published rows are managed independently in that table, and we
    // don't want metadata writes to block on registry-row presence.
    url: {
      type: 'varchar',
      primaryKey: true,
    },
    // When false, the realm is hidden from /_catalog-realms listings.
    // NULL means "no preference set" — the catalog handler treats null
    // and true the same way (visible).
    show_as_catalog: {
      type: 'boolean',
    },
    // Whether the realm can be published. Seeded true at createRealm,
    // flipped to false on the published-realm row when its source is
    // published. NULL means no row was ever set (treated as
    // not-publishable by handle-publish-realm).
    publishable: {
      type: 'boolean',
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('realm_metadata');
};
