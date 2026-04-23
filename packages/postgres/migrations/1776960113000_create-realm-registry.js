exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('realm_registry', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    url: {
      type: 'varchar',
      notNull: true,
    },
    kind: {
      type: 'varchar',
      notNull: true,
    },
    disk_id: {
      type: 'varchar',
      notNull: true,
    },
    owner_username: {
      type: 'varchar',
      notNull: true,
    },
    source_url: {
      type: 'varchar',
    },
    last_published_at: {
      type: 'bigint',
    },
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
  pgm.dropConstraint('realm_registry', 'realm_registry_kind_check');
  pgm.dropTable('realm_registry');
};
