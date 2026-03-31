// Clear the modules cache by deleting all rows from the modules table.
// This is useful when switching branches in local dev, since the cached
// modules can become stale when the underlying source files change.

import '../setup-logger';
import { PgAdapter } from '@cardstack/postgres';

async function main() {
  let adapter = new PgAdapter({ autoMigrate: false });
  try {
    await adapter.execute('DELETE FROM modules');
    console.log('Cleared modules cache.');
  } finally {
    await adapter.close();
  }
}

main().catch((err) => {
  console.error('Failed to clear modules cache:', err);
  process.exit(1);
});
