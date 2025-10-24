exports.shorthands = undefined;

// A placeholder comment

exports.up = (pgm) => {
  pgm.createTable('claimed_domains_for_sites', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    user_id: {
      type: 'uuid',
      references: 'users(id)',
      notNull: true,
    },
    hostname: {
      type: 'varchar',
      notNull: true,
    },
    source_realm_url: {
      type: 'varchar',
      notNull: true,
    },
    claimed_at: {
      type: 'integer',
      notNull: true,
    },
    removed_at: {
      type: 'integer',
    },
  });

  pgm.createIndex('claimed_domains_for_sites', ['hostname'], {
    unique: true,
    where: 'removed_at IS NULL',
    name: 'claimed_domains_for_sites_hostname_unique_index',
  });
  pgm.createIndex('claimed_domains_for_sites', ['removed_at']);
  pgm.createIndex('claimed_domains_for_sites', ['user_id']);
  pgm.createIndex('claimed_domains_for_sites', ['source_realm_url']);
};

exports.down = (pgm) => {
  pgm.dropIndex('claimed_domains_for_sites', ['removed_at']);
  pgm.dropIndex('claimed_domains_for_sites', ['hostname'], {
    name: 'claimed_domains_for_sites_hostname_unique_index',
  });
  pgm.dropIndex('claimed_domains_for_sites', ['user_id']);
  pgm.dropIndex('claimed_domains_for_sites', ['source_realm_url']);
  pgm.dropTable('claimed_domains_for_sites');
};
