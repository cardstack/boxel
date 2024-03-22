import {
  sqlite3Worker1Promiser,
  type SQLiteWorker,
} from '@sqlite.org/sqlite-wasm';

import {
  type DBAdapter,
  type PgPrimitive,
  Deferred,
} from '@cardstack/runtime-common';

export default class SQLiteAdapter implements DBAdapter {
  private _sqlite: typeof SQLiteWorker | undefined;
  private _dbId: string | undefined;

  constructor(private schemaSQL?: string) {}

  async startClient() {
    let ready = new Deferred<typeof SQLiteWorker>();
    const promisedWorker = sqlite3Worker1Promiser({
      onready: () => ready.fulfill(promisedWorker),
    });
    this._sqlite = await ready.promise;

    let response = await this.sqlite('open', {
      // It is possible to write to the local
      // filesystem via Origin Private Filesystem, but it requires _very_
      // restrictive response headers that would cause our host app to break
      //     "Cross-Origin-Embedder-Policy: require-corp"
      //     "Cross-Origin-Opener-Policy: same-origin"
      // https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/

      // Otherwise, local storage and session storage are off limits to the
      // worker (they are available in the synchronous interface), so only
      // ephemeral memory storage is available
      filename: ':memory:',
    });
    const { dbId } = response;
    this._dbId = dbId;

    if (this.schemaSQL) {
      try {
        await this.sqlite('exec', {
          dbId: this.dbId,
          sql: this.schemaSQL,
        });
      } catch (e: any) {
        console.error(
          `Error executing SQL: ${e.result.message}\n${this.schemaSQL}`,
          e,
        );
        throw e;
      }
    }
  }

  async execute(sql: string, bind?: PgPrimitive[]) {
    return await this.query(sql, bind);
  }

  async close() {
    await this.sqlite('close', { dbId: this.dbId });
  }

  private get sqlite() {
    if (!this._sqlite) {
      throw new Error(
        `could not get sqlite worker--has createClient() been run?`,
      );
    }
    return this._sqlite;
  }

  private get dbId() {
    if (!this._dbId) {
      throw new Error(
        `could not obtain db identifier--has createClient() been run?`,
      );
    }
    return this._dbId;
  }

  private async query(sql: string, bind?: any[]) {
    let results: Record<string, PgPrimitive>[] = [];
    try {
      await this.sqlite('exec', {
        dbId: this.dbId,
        sql,
        bind,
        // Nested execs are not possible with this async interface--we can't call
        // into the exec in this callback due to the way we communicate to the
        // worker thread via postMessage. if we need nesting do it all in the SQL
        callback: ({ columnNames, row }) => {
          let rowObject: Record<string, any> = {};
          // row === undefined indicates that the end of the result set has been reached
          if (row) {
            for (let [index, col] of columnNames.entries()) {
              rowObject[col] = row[index];
            }
            results.push(rowObject);
          }
        },
      });
    } catch (e: any) {
      console.error(
        `Error executing SQL ${e.result.message}:\n${sql}${
          bind ? ' with bindings: ' + JSON.stringify(bind) : ''
        }`,
        e,
      );
      throw e;
    }

    return results;
  }
}
