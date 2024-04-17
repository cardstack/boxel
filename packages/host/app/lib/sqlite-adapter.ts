import {
  sqlite3Worker1Promiser,
  type SQLiteWorker,
} from '@sqlite.org/sqlite-wasm';

import {
  type DBAdapter,
  type PgPrimitive,
  type ExecuteOptions,
  Deferred,
} from '@cardstack/runtime-common';

export default class SQLiteAdapter implements DBAdapter {
  private _sqlite: typeof SQLiteWorker | undefined;
  private _dbId: string | undefined;
  private primaryKeys = new Map<string, string>();

  // TODO: one difference that I'm seeing is that it looks like "json_each" is
  // actually similar to "json_each_text" in postgres. i think we might need to
  // transform the SQL we run to deal with this difference.-

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

      let pks = (await this.execute(
        `
        SELECT m.name AS table_name,
        GROUP_CONCAT(p.name, ', ') AS primary_keys
        FROM sqlite_master AS m
        JOIN pragma_table_info(m.name) AS p ON m.type = 'table'
        WHERE p.pk > 0
        GROUP BY m.name;
        `,
      )) as { table_name: string; primary_keys: string }[];
      for (let { table_name, primary_keys } of pks) {
        this.primaryKeys.set(table_name, primary_keys);
      }
    }
  }

  async execute(sql: string, opts?: ExecuteOptions) {
    return await this.query(this.adjustSQL(sql), opts);
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

  private async query(sql: string, opts?: ExecuteOptions) {
    let results: Record<string, PgPrimitive>[] = [];
    try {
      await this.sqlite('exec', {
        dbId: this.dbId,
        sql,
        bind: opts?.bind,
        // Nested execs are not possible with this async interface--we can't call
        // into the exec in this callback due to the way we communicate to the
        // worker thread via postMessage. if we need nesting do it all in the SQL
        callback: ({ columnNames, row }) => {
          let rowObject: Record<string, any> = {};
          // row === undefined indicates that the end of the result set has been reached
          if (row) {
            for (let [index, col] of columnNames.entries()) {
              let coerceAs = opts?.coerceTypes?.[col];
              if (coerceAs) {
                switch (coerceAs) {
                  case 'JSON': {
                    rowObject[col] = JSON.parse(row[index]);
                    break;
                  }
                  case 'BOOLEAN': {
                    let value = row[index];
                    rowObject[col] =
                      // respect DB NULL values
                      value === null ? value : Boolean(row[index]);
                    break;
                  }
                  default:
                    assertNever(coerceAs);
                }
              } else {
                rowObject[col] = row[index];
              }
            }
            results.push(rowObject);
          }
        },
      });
    } catch (e: any) {
      console.error(
        `Error executing SQL ${e.result.message}:\n${sql}${
          opts?.bind ? ' with bindings: ' + JSON.stringify(opts?.bind) : ''
        }`,
        e,
      );
      throw e;
    }

    return results;
  }

  private adjustSQL(sql: string): string {
    return sql
      .replace(/ON CONFLICT ON CONSTRAINT (\w*)\b/, (_, constraint) => {
        let tableName = constraint.replace(/_pkey$/, '');
        let pkColumns = this.primaryKeys.get(tableName);
        if (!pkColumns) {
          throw new Error(
            `could not determine primary key columns for constraint '${constraint}'`,
          );
        }
        return `ON CONFLICT (${pkColumns})`;
      })
      .replace(/ANY_VALUE\(([^)]*)\)/g, '$1')
      .replace(/CROSS JOIN LATERAL/g, 'CROSS JOIN')
      .replace(/jsonb_array_each\(/g, 'json_each(')
      .replace(/jsonb_tree\(/g, 'json_tree(')
      .replace(/\.text_value/g, '.value')
      .replace(/\.jsonb_value/g, '.value')
      .replace(/= 'null'::jsonb/g, 'IS NULL')
      .replace(/COLLATE "POSIX"/g, '');
  }
}

function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}
