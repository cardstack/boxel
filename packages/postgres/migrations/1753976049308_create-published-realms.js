/* eslint-disable camelcase */

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

exports.down = (pgm) => {};
