/* eslint-env node */
import { Client } from 'pg';

import migrationNameFixes from './migration-name-fixes.js';

type MigrationNameFixes = {
  migrationRenames: Array<[string, string]>;
  buildUpdateMigrationSql: (mapping: Array<[string, string]>) => string;
};

const { migrationRenames, buildUpdateMigrationSql } =
  migrationNameFixes as MigrationNameFixes;

async function main() {
  // One-time repair to keep renamed migrations from rerunning; remove after all
  // environments have applied the fix and are using the corrected filenames.
  if (!migrationRenames.length) {
    return;
  }

  const client = new Client();
  await client.connect();

  try {
    const { rows } = await client.query(
      'SELECT to_regclass($1) AS table_name',
      ['migrations'],
    );

    if (!rows[0]?.table_name) {
      return;
    }

    await client.query(buildUpdateMigrationSql(migrationRenames));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
