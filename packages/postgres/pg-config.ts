import type { ClientConfig } from 'pg';

export function postgresConfig(defaultConfig: ClientConfig = {}) {
  return Object.assign({}, defaultConfig, {
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || '5432',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || undefined,
    database: process.env.PGDATABASE || 'postgres',
  });
}

// The connection settings of the boxel database: the ones the adapter's pool
// connects with, for any other connection that must reach the same database.
export function boxelDatabaseConfig() {
  return postgresConfig({ database: 'boxel' });
}
