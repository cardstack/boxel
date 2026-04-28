import type { PgPrimitive } from './index';

export interface TypeCoercion {
  [column: string]: 'BOOLEAN' | 'JSON' | 'VARCHAR';
}

export interface ExecuteOptions {
  bind?: PgPrimitive[];
  coerceTypes?: TypeCoercion;
}

export interface DBAdapter {
  kind: 'pg';
  isClosed: boolean;
  execute: (
    sql: string,
    opts?: ExecuteOptions,
  ) => Promise<Record<string, PgPrimitive>[]>;
  close: () => Promise<void>;
  getColumnNames: (tableName: string) => Promise<string[]>;
}
