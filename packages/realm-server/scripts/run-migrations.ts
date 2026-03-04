// Run database migrations and exit. Used to ensure the schema is ready
// before user registration in environment mode.

import { PgAdapter } from '@cardstack/postgres';

async function main() {
  let adapter = new PgAdapter({ autoMigrate: true, migrationLogging: false });
  // close() internally awaits the migration promise before shutting down the pool
  await adapter.close();
  console.log('Migrations complete.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
