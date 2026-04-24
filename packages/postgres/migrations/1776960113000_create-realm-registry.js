exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('realm_registry', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    // Canonical URL of the realm (e.g., https://app.boxel.com/user/my-realm/). Realms
    // are addressed by URL everywhere in the code; this is the primary lookup key, and
    // a UNIQUE index enforces one row per URL.
    url: {
      type: 'varchar',
      notNull: true,
    },
    // Classifies how the realm is stored and what operations are allowed:
    //   'source'    — user-created source realm; on disk at
    //                 <realmsRootPath>/<owner>/<endpoint>/.
    //   'published' — published snapshot of a source realm; on disk at
    //                 <realmsRootPath>/<PUBLISHED_DIRECTORY_NAME>/<uuid>/.
    //   'bootstrap' — CLI-seeded well-known realm (base, catalog, etc.); mutation
    //                 handlers reject operations targeting these rows.
    // A CHECK constraint enforces the enum.
    kind: {
      type: 'varchar',
      notNull: true,
    },
    // Identifier used to compose the on-disk path; meaning depends on `kind`:
    //   source:    "<owner>/<endpoint>" segment under realmsRootPath
    //   published: UUID of the published directory (matches published_realms.id while
    //              the legacy table exists)
    //   bootstrap: absolute path supplied via the --path CLI arg (these realms live
    //              outside realmsRootPath)
    disk_id: {
      type: 'varchar',
      notNull: true,
    },
    // Matrix username that owns this realm. Used for permission checks in mutation
    // handlers. Bootstrap rows use the sentinel 'system' since they have no real owner.
    owner_username: {
      type: 'varchar',
      notNull: true,
    },
    // For kind='published': the URL of the source realm it was published from (soft
    // foreign key to another row's `url`; intentionally not an FK so that source and
    // published rows can be manipulated independently during migration).
    // For kind='source' or 'bootstrap': always NULL.
    // Enforced by realm_registry_source_url_by_kind.
    source_url: {
      type: 'varchar',
    },
    // Milliseconds since epoch of the most recent publish. Populated for
    // kind='published'; always NULL otherwise (enforced by
    // realm_registry_last_published_by_kind). May still be NULL for a kind='published'
    // row during transitional states (e.g., a row inserted before its first publish
    // completes), so the constraint only enforces the "NULL for non-published" half.
    last_published_at: {
      type: 'bigint',
    },
    // Mount policy:
    //   true  — reconciler mounts this realm eagerly at boot and on NOTIFY upsert, on
    //           every realm-server instance. Pinned rows are also exempt from future
    //           idle eviction.
    //   false — mount-on-demand on first request via ensureMounted().
    // Bootstrap rows are seeded with pinned=true; source and published rows default to
    // pinned=false. A partial index exists for WHERE pinned = true to make the
    // reconciler's boot-time "mount the pinned set" query cheap.
    pinned: {
      type: 'boolean',
      notNull: true,
      default: false,
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

  pgm.addConstraint('realm_registry', 'realm_registry_kind_check', {
    check: "kind in ('source','published','bootstrap')",
  });
  pgm.addConstraint('realm_registry', 'realm_registry_source_url_by_kind', {
    check:
      "(kind = 'published' AND source_url IS NOT NULL) OR (kind <> 'published' AND source_url IS NULL)",
  });
  pgm.addConstraint('realm_registry', 'realm_registry_last_published_by_kind', {
    check: "kind = 'published' OR last_published_at IS NULL",
  });

  pgm.createIndex('realm_registry', ['url'], {
    unique: true,
    name: 'realm_registry_url_uniq',
  });
  pgm.createIndex('realm_registry', ['source_url']);
  pgm.createIndex('realm_registry', ['kind']);
  pgm.createIndex('realm_registry', ['pinned'], {
    where: 'pinned = true',
    name: 'realm_registry_pinned_idx',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('realm_registry', ['pinned'], {
    name: 'realm_registry_pinned_idx',
  });
  pgm.dropIndex('realm_registry', ['kind']);
  pgm.dropIndex('realm_registry', ['source_url']);
  pgm.dropIndex('realm_registry', ['url'], {
    name: 'realm_registry_url_uniq',
  });
  pgm.dropConstraint(
    'realm_registry',
    'realm_registry_last_published_by_kind',
  );
  pgm.dropConstraint('realm_registry', 'realm_registry_source_url_by_kind');
  pgm.dropConstraint('realm_registry', 'realm_registry_kind_check');
  pgm.dropTable('realm_registry');
};
