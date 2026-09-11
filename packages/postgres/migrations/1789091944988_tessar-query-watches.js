exports.shorthands = undefined;

exports.up = (pgm) => {
  // Tessar is opt-in. The owner row survives retirement to prevent an older
  // worker from resurrecting watches after a definition change or deletion.
  pgm.createTable('tessar_owners', {
    realm_url: { type: 'varchar', notNull: true, primaryKey: true },
    owner_url: { type: 'varchar', notNull: true, primaryKey: true },
    published_generation: { type: 'bigint', notNull: true },
    input_generation: { type: 'bigint', notNull: true },
    dirty_generation: 'bigint',
    definition_revision: { type: 'varchar', notNull: true },
    retired: { type: 'boolean', notNull: true, default: false },
  });
  pgm.createTable('tessar_query_watches', {
    realm_url: { type: 'varchar', notNull: true, primaryKey: true },
    owner_url: { type: 'varchar', notNull: true, primaryKey: true },
    field_path: { type: 'varchar', notNull: true, primaryKey: true },
    query: { type: 'jsonb', notNull: true },
  });
  // One safe disjunctive set of equality anchors per watch. The empty path is
  // a broad route. These rows are candidates only; the ordinary SQL compiler
  // verifies the saved predicate against both old and new indexed documents.
  pgm.createTable('tessar_query_terms', {
    realm_url: { type: 'varchar', notNull: true, primaryKey: true },
    owner_url: { type: 'varchar', notNull: true, primaryKey: true },
    field_path: { type: 'varchar', notNull: true, primaryKey: true },
    path: { type: 'varchar', notNull: true, primaryKey: true },
    value: { type: 'varchar', notNull: true, primaryKey: true },
  });
  pgm.createIndex('tessar_query_terms', ['realm_url', 'path', 'value']);
  pgm.createIndex('tessar_owners', ['realm_url', 'dirty_generation']);
};

exports.down = (pgm) => {
  pgm.dropTable('tessar_query_terms');
  pgm.dropTable('tessar_query_watches');
  pgm.dropTable('tessar_owners');
};
