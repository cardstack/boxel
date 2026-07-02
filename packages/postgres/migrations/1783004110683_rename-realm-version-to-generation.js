// Renames the per-realm "realm version" concept to "generation" throughout the
// index schema. The stamp column `realm_version` (the generation each row was
// written at) becomes `generation` on boxel_index, boxel_index_working, and
// realm_meta. The allocator `realm_versions` table (the per-realm current
// counter) becomes `realm_generations`, with `current_version` → current_generation.
// Column values, indexes, and constraints are preserved — only names change — so
// existing readers behave identically under the new names.

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Stamp column on the index tables + realm_meta.
  pgm.renameColumn('boxel_index', 'realm_version', 'generation');
  pgm.renameColumn('boxel_index_working', 'realm_version', 'generation');
  pgm.renameColumn('realm_meta', 'realm_version', 'generation');

  // The indexes over the stamp column keep pointing at the renamed column, but
  // their names would still read `realm_version`; rename them to match.
  pgm.sql(
    'ALTER INDEX boxel_index_realm_version_index RENAME TO boxel_index_generation_index',
  );
  pgm.sql(
    'ALTER INDEX boxel_index_url_realm_version_index RENAME TO boxel_index_url_generation_index',
  );
  pgm.sql(
    'ALTER INDEX boxel_index_working_realm_version_index RENAME TO boxel_index_working_generation_index',
  );
  pgm.sql(
    'ALTER INDEX boxel_index_working_url_realm_version_index RENAME TO boxel_index_working_url_generation_index',
  );

  // The allocator table.
  pgm.renameTable('realm_versions', 'realm_generations');
  pgm.renameColumn('realm_generations', 'current_version', 'current_generation');
  // RENAME CONSTRAINT renames the backing unique index in lockstep, so the
  // ON CONFLICT ON CONSTRAINT upsert can key on `realm_generations_pkey`.
  pgm.renameConstraint(
    'realm_generations',
    'realm_versions_pkey',
    'realm_generations_pkey',
  );
  pgm.sql(
    'ALTER INDEX realm_versions_current_version_index RENAME TO realm_generations_current_generation_index',
  );
};

exports.down = (pgm) => {
  pgm.sql(
    'ALTER INDEX realm_generations_current_generation_index RENAME TO realm_versions_current_version_index',
  );
  pgm.renameConstraint(
    'realm_generations',
    'realm_generations_pkey',
    'realm_versions_pkey',
  );
  pgm.renameColumn('realm_generations', 'current_generation', 'current_version');
  pgm.renameTable('realm_generations', 'realm_versions');

  pgm.sql(
    'ALTER INDEX boxel_index_working_url_generation_index RENAME TO boxel_index_working_url_realm_version_index',
  );
  pgm.sql(
    'ALTER INDEX boxel_index_working_generation_index RENAME TO boxel_index_working_realm_version_index',
  );
  pgm.sql(
    'ALTER INDEX boxel_index_url_generation_index RENAME TO boxel_index_url_realm_version_index',
  );
  pgm.sql(
    'ALTER INDEX boxel_index_generation_index RENAME TO boxel_index_realm_version_index',
  );

  pgm.renameColumn('realm_meta', 'generation', 'realm_version');
  pgm.renameColumn('boxel_index_working', 'generation', 'realm_version');
  pgm.renameColumn('boxel_index', 'generation', 'realm_version');
};
