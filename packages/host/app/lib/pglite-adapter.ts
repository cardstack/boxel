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
  private snapshots = new Map<string, PGlite>();
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
        await waitForPromise(
          this.db.exec(this.schemaSQL),
          'pglite schema init',
        );
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
    for (let snapshot of this.snapshots.values()) {
      await snapshot.close();
    }
    this.snapshots.clear();
    await this.pglite.close();
    this.#isClosed = true;
  }

  async reset() {
    this.assertNotClosed();
    await this.started;
    // TRUNCATE reclaims storage immediately (unlike DELETE which leaves
    // dead tuples until VACUUM). This keeps memory stable across tests.
    if (this.tables.length > 0) {
      await this.pglite.exec(
        `TRUNCATE ${this.tables.join(', ')} RESTART IDENTITY`,
      );
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
      let result = await waitForPromise(
        this.pglite.query(sql, opts?.bind as any[]),
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

  // --- Snapshot support via PGLite clone() ---
  // Each snapshot is a frozen clone of the PGLite instance. On import we
  // clone the snapshot again (so it can be re-imported multiple times)
  // and swap it in as the active database.

  async exportSnapshot(snapshotName?: string): Promise<string> {
    this.assertNotClosed();
    await this.started;
    let name = snapshotName ?? `snapshot_${this.snapshots.size + 1}`;
    let clone = await waitForPromise(
      (this.pglite as any).clone() as Promise<PGlite>,
      'pglite snapshot export',
    );
    this.snapshots.set(name, clone);
    return name;
  }

  hasSnapshot(snapshotName: string): boolean {
    return this.snapshots.has(snapshotName);
  }

  async importSnapshot(snapshotName: string): Promise<void> {
    this.assertNotClosed();
    await this.started;
    let snapshot = this.snapshots.get(snapshotName);
    if (!snapshot) {
      throw new Error(`Unknown snapshot '${snapshotName}'`);
    }
    // Clone the snapshot so it can be imported again later
    let restored = await waitForPromise(
      (snapshot as any).clone() as Promise<PGlite>,
      'pglite snapshot import',
    );
    // Swap: close the current instance and replace it
    await this.pglite.close();
    this.db = restored;
  }

  async deleteSnapshot(snapshotName: string): Promise<void> {
    let snapshot = this.snapshots.get(snapshotName);
    if (snapshot) {
      await snapshot.close();
      this.snapshots.delete(snapshotName);
    }
  }

  async deleteSnapshotsByPrefix(snapshotNamePrefix: string): Promise<void> {
    for (let name of Array.from(this.snapshots.keys())) {
      if (name.startsWith(snapshotNamePrefix)) {
        await this.deleteSnapshot(name);
      }
    }
  }

  private assertNotClosed() {
    if (this.isClosed) {
      throw new Error(
        `Cannot perform operation, the db connection has been closed`,
      );
    }
  }
}
