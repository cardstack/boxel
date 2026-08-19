exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('published_realms', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    owner_username: {
      type: 'varchar',
      notNull: true,
    },
    source_realm_url: {
      type: 'varchar',
      notNull: true,
    },
    published_realm_url: {
      type: 'varchar',
      notNull: true,
    },
    last_published_at: {
      type: 'timestamp',
    },
  });
};

// 1779100257123_drop-published-realms drops this table on UP and
// re-creates it on DOWN, so during a full rollback the table is restored
// by that migration's DOWN and must be removed again here. Without this,
// the reapply UP collides on the leftover relation.
exports.down = (pgm) => {
  pgm.dropTable('published_realms');
};
