exports.up = (pgm) => {
  pgm.createTable('indexed_cards', {
    card_url: { type: 'varchar', notNull: true },
    realm_version: { type: 'integer', notNull: true },
    realm_url: { type: 'varchar', notNull: true },
    pristine_doc: 'jsonb',
    search_doc: 'jsonb',
    error_doc: 'jsonb',
    deps: 'jsonb',
    types: 'jsonb',
    embedded_html: 'varchar',
    isolated_html: 'varchar',
    indexed_at: 'integer',
    is_deleted: 'boolean',
  });
  pgm.sql('ALTER TABLE indexed_cards SET UNLOGGED');
  pgm.addConstraint('indexed_cards', 'indexed_cards_pkey', {
    primaryKey: ['card_url', 'realm_version'],
  });
  pgm.createIndex('indexed_cards', ['realm_version']);
  pgm.createIndex('indexed_cards', ['realm_url']);

  pgm.createTable('realm_versions', {
    realm_url: { type: 'varchar', notNull: true },
    current_version: { type: 'integer', notNull: true },
  });

  pgm.sql('ALTER TABLE realm_versions SET UNLOGGED');
  pgm.addConstraint('realm_versions', 'realm_versions_pkey', {
    primaryKey: ['realm_url'],
  });
  pgm.createIndex('realm_versions', ['current_version']);

  pgm.createType('job_statuses', ['unfulfilled', 'resolved', 'rejected']);
  pgm.createTable('jobs', {
    id: 'id', // shorthand for primary key that is an auto incremented id
    category: {
      type: 'varchar',
      notNull: true,
    },
    args: 'jsonb',
    status: {
      type: 'job_statuses',
      default: 'unfulfilled',
      notNull: true,
    },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    finished_at: {
      type: 'timestamp',
    },
    queue: {
      type: 'varchar',
      notNull: true,
    },
    result: 'jsonb',
  });
  pgm.sql('ALTER TABLE jobs SET UNLOGGED');
};
