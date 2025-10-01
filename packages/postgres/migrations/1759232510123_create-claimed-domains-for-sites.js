exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('claimed_domains_for_sites', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    hostname: {
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

  pgm.createIndex('claimed_domains_for_sites', ['hostname'], { unique: true });
  pgm.createIndex('claimed_domains_for_sites', ['removed_at']);
};

exports.down = (pgm) => {
  pgm.dropIndex('claimed_domains_for_sites', ['removed_at']);
  pgm.dropIndex('claimed_domains_for_sites', ['hostname']);
  pgm.dropTable('claimed_domains_for_sites');
};
