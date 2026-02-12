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
  // Try to fully restore pre-migration schema. If Postgres rejects the wide
  // primary key/index (54000), keep hash-based schema so redo stays usable.
  pgm.sql(`
    DO $$
    BEGIN
      LOCK TABLE modules IN ACCESS EXCLUSIVE MODE;
      DELETE FROM modules;
      DROP INDEX IF EXISTS modules_resolved_realm_url_file_alias_index;
      ALTER TABLE modules DROP CONSTRAINT IF EXISTS modules_pkey;
      ALTER TABLE modules DROP COLUMN IF EXISTS url_without_css;
      ALTER TABLE modules DROP COLUMN IF EXISTS url_hash;
      ALTER TABLE modules
        ADD CONSTRAINT modules_pkey PRIMARY KEY (url, cache_scope, auth_user_id);
      CREATE INDEX modules_resolved_realm_url_file_alias_index
        ON modules (resolved_realm_url, file_alias);
    EXCEPTION
      WHEN SQLSTATE '54000' THEN
        RAISE NOTICE
          'Skipping full rollback of 1770889690032: index tuple too large. Keeping hash-based modules key/index.';
        DROP INDEX IF EXISTS modules_resolved_realm_url_file_alias_index;
        CREATE INDEX modules_resolved_realm_url_file_alias_index
          ON modules (resolved_realm_url, md5(file_alias));
    END
    $$;
  `);
};
