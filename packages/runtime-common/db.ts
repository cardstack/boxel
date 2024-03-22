import { type PgPrimitive } from './index';

export interface DBAdapter {
  // DB implementations perform DB connection and migration in this method.
  // DBAdapter implementations can take in DB specific config in their
  // constructors (username, password, etc)
  startClient: () => Promise<void>;
  execute: (
    sql: string,
    bind?: PgPrimitive[],
  ) => Promise<Record<string, PgPrimitive>[]>;
  close: () => Promise<void>;
}
