import { type PgPrimitive } from './index';

export interface ExecuteOptions {
  // SQLite has a very limited set of data types. we can coerce the resulting
  // types into values that match pg using this option
  bind?: PgPrimitive[];
  coerceTypes?: { [column: string]: 'BOOLEAN' | 'JSON' };
}

export interface DBAdapter {
  // DB implementations perform DB connection and migration in this method.
  // DBAdapter implementations can take in DB specific config in their
  // constructors (username, password, etc)
  startClient: () => Promise<void>;
  execute: (
    sql: string,
    opts?: ExecuteOptions,
  ) => Promise<Record<string, PgPrimitive>[]>;
  close: () => Promise<void>;
}
