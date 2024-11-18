import { type ClientConfig } from 'pg';

export function postgresConfig(defaultConfig: ClientConfig = {}) {
  return Object.assign({}, defaultConfig, {
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || '5435',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || undefined,
    database: process.env.PGDATABASE || 'boxel',
  });
}
