// The host's SQLite adapter (packages/host/app/lib/sqlite-adapter.ts), in
// Node: the same `kind`, the same SQL rewrite and the same result coercion,
// over `node:sqlite` instead of the browser's sqlite-wasm worker. Only what
// the query engine uses is here.
import { readdirSync, readFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';

import type {
  DBAdapter,
  ExecuteOptions,
  PgPrimitive,
} from '@cardstack/runtime-common';

const SCHEMA_DIR = new URL('../../host/config/schema/', import.meta.url);

export function latestSchema(): string {
  let latest = readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('_schema.sql'))
    .sort()
    .at(-1)!;
  return readFileSync(new URL(latest, SCHEMA_DIR), 'utf8');
}

// sqlite-wasm binds an array by parameter index, and SQLite numbers `$1`-style
// parameters in the order each name first appears in the statement.
function bindByIndex(sql: string, bind: unknown[]): Record<string, unknown> {
  let names: string[] = [];
  for (let [name] of sql.matchAll(/\$\d+/g)) {
    if (!names.includes(name)) names.push(name);
  }
  return Object.fromEntries(
    names.map((name, i) => {
      let value = bind[i];
      // sqlite-wasm binds a boolean as 1 or 0
      return [name, typeof value === 'boolean' ? Number(value) : value];
    }),
  );
}

// The host adapter's `adjustSQL`, which turns the engine's Postgres spelling
// into SQLite's. `REWRITES_START` to `REWRITES_END` is the host's text,
// character for character; `assertRewritesMatchHost` holds it so.
function adjustSQL(sql: string): string {
  return (
    sql
      .split('ANY_VALUE(')
      .reduce((acc, segment, index) => {
        if (index === 0) return segment;
        let depth = 1;
        let close = 0;
        for (; close < segment.length && depth > 0; close++) {
          if (segment[close] === '(') depth++;
          else if (segment[close] === ')') depth--;
        }
        return acc + segment.slice(0, close - 1) + segment.slice(close);
      }, '')
      // REWRITES_START
      .replace(/CROSS JOIN LATERAL/g, 'CROSS JOIN')
      .replace(/ILIKE/g, 'LIKE') // sqlite LIKE is case insensitive
      .replace(/jsonb_array_elements_text\(/g, 'json_each(')
      .replace(/jsonb_tree\(/g, 'json_tree(')
      .replace(/([^\s]+\s[^\s]+)_array_element/g, (match, group) => {
        if (group.startsWith('as ')) {
          return match;
        }
        return `${match}.value`;
      })
      .replace(/\.text_value/g, '.value')
      .replace(/\.jsonb_value/g, '.value')
      .replace(/= 'null'::jsonb/g, 'IS NULL')
      .replace(/COLLATE "POSIX"/g, '')
      .replace(/array_agg\(/g, 'json_group_array(')
      .replace(/array_to_json\(/g, 'json(')
    // REWRITES_END
  );
}

const HOST_ADAPTER = new URL(
  '../../host/app/lib/sqlite-adapter.ts',
  import.meta.url,
);

export function assertRewritesMatchHost() {
  let rewrites = (source: string, from: string, to: string) => {
    let start = source.indexOf(from);
    let end = source.indexOf(to, start);
    return source
      .slice(start, end + to.length)
      .split('\n')
      .map((line) => line.trim())
      .join('\n');
  };
  let first = ".replace(/CROSS JOIN LATERAL/g, 'CROSS JOIN')";
  let last = ".replace(/array_to_json\\(/g, 'json(')";
  let host = rewrites(readFileSync(HOST_ADAPTER, 'utf8'), first, last);
  let ours = rewrites(
    readFileSync(new URL(import.meta.url), 'utf8'),
    first,
    last,
  );
  if (host !== ours) {
    throw new Error(
      `the host's SQLite rewrites have changed; copy them into ${import.meta.url}:\n${host}`,
    );
  }
}

export class NodeSQLiteAdapter implements Partial<DBAdapter> {
  readonly kind = 'sqlite' as const;
  isClosed = false;
  #db = new DatabaseSync(':memory:');

  constructor(schemaSQL = latestSchema()) {
    this.#db.exec(schemaSQL);
  }

  async execute(sql: string, opts?: ExecuteOptions) {
    sql = adjustSQL(sql);
    let statement = this.#db.prepare(sql);
    let rows = (
      opts?.bind?.length
        ? statement.all(bindByIndex(sql, opts.bind as unknown[]) as any)
        : statement.all()
    ) as Record<string, PgPrimitive>[];
    return rows.map((row) => {
      let out: Record<string, any> = {};
      for (let [col, value] of Object.entries(row)) {
        switch (opts?.coerceTypes?.[col]) {
          case 'JSON':
            out[col] = JSON.parse(value as string);
            break;
          case 'BOOLEAN':
            out[col] = value === null ? value : Boolean(value);
            break;
          case 'VARCHAR':
            out[col] = value === null ? value : String(value);
            break;
          default:
            out[col] = value;
        }
      }
      return out;
    });
  }

  async close() {
    this.#db.close();
    this.isClosed = true;
  }

  async getColumnNames(tableName: string) {
    let rows = await this.execute('SELECT name FROM pragma_table_info($1)', {
      bind: [tableName],
    });
    return rows.map((row) => row.name as string);
  }

  async notify() {}

  async withTransaction<T>(fn: (q: any) => Promise<T>): Promise<T> {
    return await fn(undefined);
  }

  async withWriteLock<T>(_realm: string, fn: (q: any) => Promise<T>) {
    return await fn(undefined);
  }

  async withFileWriteLocks<T>(
    _realm: string,
    _paths: readonly string[],
    fn: (release: () => void) => Promise<T>,
  ) {
    return await fn(() => {});
  }

  async withUserCostLock<T>(_user: string, fn: () => Promise<T>) {
    return await fn();
  }
}
