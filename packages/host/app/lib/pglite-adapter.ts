import { waitForPromise } from '@ember/test-waiters';

import { PGlite } from '@electric-sql/pglite';

import {
  type DBAdapter,
  type PgPrimitive,
  type ExecuteOptions,
} from '@cardstack/runtime-common';

export default class PGLiteAdapter implements DBAdapter {
  readonly kind = 'pg';
  private db: PGlite | undefined;
  private tables: string[] = [];
  #isClosed = false;
  private started: Promise<void>;

  constructor(private schemaSQL?: string) {
    this.started = this.#startClient();
    // This is for testing purposes so that we can debug the DB
    (globalThis as any).__dbAdapter = this;
  }

  get isClosed() {
    return this.#isClosed;
  }

  async #startClient() {
    this.assertNotClosed();
    this.db = await waitForPromise(
      PGlite.create('memory://'),
      'pglite startup',
    );

    if (this.schemaSQL) {
      try {
        await waitForPromise(this.db.exec(this.schemaSQL), 'pglite schema init');
      } catch (e: any) {
        console.error(
          `Error executing PG schema SQL: ${e.message}\n${this.schemaSQL}`,
          e,
        );
        throw e;
      }
    }

    await this.#loadTableNames();
  }

  async execute(
    sql: string,
    opts?: ExecuteOptions,
  ): Promise<Record<string, PgPrimitive>[]> {
    this.assertNotClosed();
    await this.started;
    return await this.#query(sql, opts);
  }

  async close() {
    this.assertNotClosed();
    await this.started;
    await this.pglite.close();
    this.#isClosed = true;
  }

  async reset() {
    this.assertNotClosed();
    await this.started;
    for (let table of this.tables) {
      await this.execute(`DELETE FROM ${table}`);
    }
  }

  async getColumnNames(tableName: string): Promise<string[]> {
    await this.started;
    let result = await this.execute(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
      { bind: [tableName] },
    );
    return result.map((row) => row.column_name) as string[];
  }

  private get pglite(): PGlite {
    if (!this.db) {
      throw new Error(
        `could not get PGlite instance--has startClient() been run?`,
      );
    }
    return this.db;
  }

  async #query(
    sql: string,
    opts?: ExecuteOptions,
  ): Promise<Record<string, PgPrimitive>[]> {
    try {
      // The node-pg wire protocol sends all parameters as text strings.
      // PGLite passes them as native JS types, which causes type mismatches
      // (e.g., `->>` returns text, so `text = true` fails without an implicit
      // cast). Stringify booleans to match node-pg behaviour.
      let bind = opts?.bind?.map((v) =>
        typeof v === 'boolean' ? String(v) : v,
      );
      let result = await waitForPromise(
        this.pglite.query(sql, bind as any[]),
        'pglite query',
      );
      let rows = result.rows as Record<string, PgPrimitive>[];

      // PGLite may return types differently from the node-pg library
      // (e.g., bigint as number instead of string). Apply coerceTypes to
      // normalize the output to match what the rest of the codebase expects.
      if (opts?.coerceTypes && rows.length > 0) {
        return rows.map((row) => {
          let coerced: Record<string, PgPrimitive> = {};
          for (let [col, value] of Object.entries(row)) {
            let coerceAs = opts.coerceTypes?.[col];
            if (coerceAs) {
              switch (coerceAs) {
                case 'VARCHAR':
                  coerced[col] = value === null ? null : String(value);
                  break;
                case 'BOOLEAN':
                  coerced[col] = value === null ? null : Boolean(value);
                  break;
                case 'JSON':
                  // PGLite returns jsonb as already-parsed objects, so no
                  // JSON.parse needed. But if it comes back as a string
                  // (shouldn't happen), parse it.
                  if (typeof value === 'string') {
                    coerced[col] = JSON.parse(value);
                  } else {
                    coerced[col] = value;
                  }
                  break;
                default:
                  coerced[col] = value;
              }
            } else {
              coerced[col] = value;
            }
          }
          return coerced;
        });
      }

      return rows;
    } catch (e: any) {
      console.error(
        `Error executing SQL ${e.message}:\n${sql}${
          opts?.bind ? ' with bindings: ' + JSON.stringify(opts?.bind) : ''
        }`,
        e,
      );
      throw e;
    }
  }

  async #loadTableNames() {
    let result = await this.#query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    this.tables = result.map((r) => r.tablename) as string[];
  }

  // Snapshot support - for now, simple implementations that can be enhanced later
  async exportSnapshot(snapshotName?: string): Promise<string> {
    // For the spike, snapshots are not yet implemented with PGLite.
    // The test framework will fall through to running full setup each time.
    return snapshotName ?? 'noop';
  }

  hasSnapshot(_snapshotName: string): boolean {
    return false;
  }

  async deleteSnapshotsByPrefix(_snapshotNamePrefix: string): Promise<void> {
    // no-op for now
  }

  async deleteSnapshot(_snapshotName: string): Promise<void> {
    // no-op for now
  }

  async importSnapshot(_snapshotName: string): Promise<void> {
    // no-op for now
  }

  private assertNotClosed() {
    if (this.isClosed) {
      throw new Error(
        `Cannot perform operation, the db connection has been closed`,
      );
    }
  }
}
