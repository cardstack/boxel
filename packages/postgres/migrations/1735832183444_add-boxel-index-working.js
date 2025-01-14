exports.up = (pgm) => {
  pgm.createTable('boxel_index_working', {
    url: { type: 'varchar', notNull: true },
    file_alias: { type: 'varchar', notNull: true },
    type: { type: 'varchar', notNull: true },
    realm_version: { type: 'integer', notNull: true },
    realm_url: { type: 'varchar', notNull: true },
    pristine_doc: 'jsonb',
    search_doc: 'jsonb',
    error_doc: 'jsonb',
    deps: 'jsonb',
    types: 'jsonb',
    icon_html: 'varchar',
    isolated_html: 'varchar',
    indexed_at: 'bigint',
    is_deleted: 'boolean',
    source: 'varchar',
    transpiled_code: 'varchar',
    last_modified: 'bigint',
    embedded_html: 'jsonb',
    atom_html: 'varchar',
    fitted_html: 'jsonb',
    display_names: 'jsonb',
    resource_created_at: 'bigint',
  });
  pgm.sql('ALTER TABLE boxel_index_working SET UNLOGGED');
  pgm.addConstraint('boxel_index_working', 'boxel_index_working_pkey', {
    primaryKey: ['url', 'realm_url'],
  });
  pgm.createIndex('boxel_index_working', ['realm_version']);
  pgm.createIndex('boxel_index_working', ['realm_url']);
  pgm.createIndex('boxel_index_working', ['file_alias']);
  pgm.createIndex('boxel_index_working', ['resource_created_at']);
  pgm.createIndex('boxel_index_working', ['last_modified']);
  pgm.createIndex('boxel_index_working', 'type');
  pgm.createIndex('boxel_index_working', ['url', 'realm_version']);
  pgm.createIndex('boxel_index_working', 'deps', { method: 'gin' });
  pgm.createIndex('boxel_index_working', 'types', { method: 'gin' });
  pgm.createIndex('boxel_index_working', 'fitted_html', { method: 'gin' });
  pgm.createIndex('boxel_index_working', 'embedded_html', { method: 'gin' });
  pgm.createIndex('boxel_index_working', 'search_doc', { method: 'gin' });

  pgm.sql('delete from boxel_index');
  pgm.sql('delete from realm_versions;');
  pgm.sql('delete from job_reservations');
  pgm.sql('delete from jobs');

  pgm.dropConstraint('boxel_index', 'boxel_index_pkey');
  pgm.addConstraint('boxel_index', 'boxel_index_pkey', {
    primaryKey: ['url', 'realm_url'],
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('boxel_index_working', ['realm_version']);
  pgm.dropIndex('boxel_index_working', ['realm_url']);
  pgm.dropIndex('boxel_index_working', ['file_alias']);
  pgm.dropIndex('boxel_index_working', ['resource_created_at']);
  pgm.dropIndex('boxel_index_working', ['last_modified']);
  pgm.dropIndex('boxel_index_working', 'type');
  pgm.dropIndex('boxel_index_working', ['url', 'realm_version']);
  pgm.dropIndex('boxel_index_working', 'deps');
  pgm.dropIndex('boxel_index_working', 'types');
  pgm.dropIndex('boxel_index_working', 'fitted_html');
  pgm.dropIndex('boxel_index_working', 'embedded_html');
  pgm.dropIndex('boxel_index_working', 'search_doc');
  pgm.dropTable('boxel_index_working', { cascade: true });

  pgm.dropConstraint('boxel_index', 'boxel_index_pkey');
  pgm.addConstraint('boxel_index', 'boxel_index_pkey', {
    primaryKey: ['url', 'realm_url', 'realm_version'],
  });
};
