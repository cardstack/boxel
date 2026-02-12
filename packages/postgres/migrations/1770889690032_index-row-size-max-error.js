/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.dropConstraint('modules', 'modules_pkey', {
    ifExists: true,
  });
  pgm.sql(`
    ALTER TABLE modules
    ADD COLUMN IF NOT EXISTS url_hash text GENERATED ALWAYS AS (md5(url)) STORED
  `);
  pgm.addConstraint('modules', 'modules_pkey', {
    primaryKey: ['url_hash', 'cache_scope', 'auth_user_id'],
  });

  pgm.sql(`
    ALTER TABLE modules
    ADD COLUMN IF NOT EXISTS url_without_css text GENERATED ALWAYS AS (
      regexp_replace(
        url,
        '\\.(gts|gjs)\\.[A-Za-z0-9_-]+={0,2}\\.glimmer-scoped\\.css$',
        '.\\1'
      )
    ) STORED
  `);

  pgm.sql('DROP INDEX IF EXISTS modules_resolved_realm_url_file_alias_index');
  pgm.sql(`
    CREATE INDEX modules_resolved_realm_url_file_alias_index
    ON modules
    USING hash (file_alias)
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS modules_resolved_realm_url_file_alias_index');
  pgm.sql(`
    CREATE INDEX modules_resolved_realm_url_file_alias_index
    ON modules (resolved_realm_url, file_alias)
  `);

  pgm.dropConstraint('modules', 'modules_pkey', {
    ifExists: true,
  });

  pgm.dropColumn('modules', 'url_without_css', {
    ifExists: true,
  });

  pgm.dropColumn('modules', 'url_hash', {
    ifExists: true,
  });

  pgm.addConstraint('modules', 'modules_pkey', {
    primaryKey: ['url', 'cache_scope', 'auth_user_id'],
  });
};
