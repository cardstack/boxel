import { waitForPromise } from '@ember/test-waiters';

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
  readonly kind = 'sqlite';
  private _sqlite: typeof SQLiteWorker | undefined;
  private _dbId: string | undefined;
  private primaryKeys = new Map<string, string>();
  private tables: string[] = [];
  private snapshotCounter = 0;
  private snapshotInfos = new Map<string, { filename: string; dbId: string }>();
  #isClosed = false;
  private started = this.#startClient();

  // TODO: one difference that I'm seeing is that it looks like "json_each" is
  // actually similar to "json_each_text" in postgres. i think we might need to
  // transform the SQL we run to deal with this difference.-

  constructor(private schemaSQL?: string) {
    // This is for testing purposes so that we can debug the DB
    (globalThis as any).__dbAdapter = this;
  }

  get isClosed() {
    return this.#isClosed;
  }

  async #startClient() {
    this.assertNotClosed();
    let ready = new Deferred<typeof SQLiteWorker>();
    const promisedWorker = sqlite3Worker1Promiser({
      onready: () => ready.fulfill(promisedWorker),
    });
    this._sqlite = await waitForPromise(ready.promise, 'sqlite startup');

    await this.#openDatabase(':memory:', true);
  }

  async execute(sql: string, opts?: ExecuteOptions) {
    this.assertNotClosed();
    await this.started;
    return await this.internalExecute(sql, opts);
  }

  private async internalExecute(sql: string, opts?: ExecuteOptions) {
    sql = this.adjustSQL(sql);
    return await this.query(sql, opts);
  }

  async close() {
    this.assertNotClosed();
    await this.started;
    await this.sqlite('close', { dbId: this.dbId });
    this.#isClosed = true;
  }

  async reset() {
    this.assertNotClosed();
    await this.started;
    for (let table of this.tables) {
      await this.execute(`DELETE FROM ${table};`);
    }
  }

  async getColumnNames(tableName: string): Promise<string[]> {
    await this.started;
    let result = await this.execute('SELECT name FROM pragma_table_info($1);', {
      bind: [tableName],
    });

    return result.map((row) => row.name) as string[];
  }

  private get sqlite(): typeof SQLiteWorker {
    const worker = this._sqlite;
    if (!worker) {
      throw new Error(
        `could not get sqlite worker--has createClient() been run?`,
      );
    }
    return (async (...args: Parameters<typeof SQLiteWorker>) => {
      return await waitForPromise(worker(...args), 'sqlite running');
    }) as typeof SQLiteWorker;
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
                  case 'VARCHAR': {
                    let value = row[index];
                    rowObject[col] =
                      // respect DB NULL values
                      value === null ? value : String(row[index]);
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

  async exportSnapshot(): Promise<string> {
    this.assertNotClosed();
    await this.started;
    let alias = `snapshot_${++this.snapshotCounter}`;
    let filename = `file:${alias}?mode=memory&cache=shared`;
    let response = await this.sqlite('open', {
      filename,
    });
    this.snapshotInfos.set(alias, { filename, dbId: response.dbId });
    await this.sqlite('exec', {
      dbId: this.dbId,
      sql: `ATTACH DATABASE '${filename}' AS ${alias};`,
    });
    let schemaEntries = (await this.internalExecute(
      `SELECT name, sql
       FROM sqlite_schema
       WHERE type = 'table'
         AND sql IS NOT NULL
         AND name NOT LIKE 'sqlite_%'
       ORDER BY name;`,
    )) as { name: string; sql: string }[];
    for (let entry of schemaEntries) {
      let rewritten = this.#rewriteSchemaSql(entry.sql, alias);
      await this.sqlite('exec', { dbId: this.dbId, sql: rewritten });
      await this.sqlite('exec', {
        dbId: this.dbId,
        sql: `DELETE FROM ${alias}.${this.#quoteIdentifier(entry.name)};`,
      });
      await this.sqlite('exec', {
        dbId: this.dbId,
        sql: `INSERT INTO ${alias}.${this.#quoteIdentifier(entry.name)}
              SELECT * FROM main.${this.#quoteIdentifier(entry.name)};`,
      });
    }
    return alias;
  }

  async deleteSnapshot(snapshotName: string) {
    this.assertNotClosed();
    await this.started;
    let snapshotInfo = this.snapshotInfos.get(snapshotName);
    if (!snapshotInfo) {
      throw new Error(`Unknown snapshot database '${snapshotName}'`);
    }
    await this.sqlite('exec', {
      dbId: this.dbId,
      sql: `DETACH DATABASE ${snapshotName};`,
    });
    this.snapshotInfos.delete(snapshotName);
  }

  async importSnapshot(snapshotName: string) {
    this.assertNotClosed();
    await this.started;
    let snapshotInfo = this.snapshotInfos.get(snapshotName);
    if (!snapshotInfo) {
      throw new Error(`Unknown snapshot database '${snapshotName}'`);
    }
    let attached = (await this.internalExecute(
      `SELECT name FROM pragma_database_list WHERE name = '${snapshotName}'`,
    )) as { name: string }[];
    if (!attached.length) {
      await this.sqlite('exec', {
        dbId: this.dbId,
        sql: `ATTACH DATABASE '${snapshotInfo.filename}' AS ${snapshotName};`,
      });
    }
    let tables = (await this.internalExecute(
      `SELECT name
       FROM ${snapshotName}.sqlite_schema
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%';`,
    )) as { name: string }[];
    let statements: string[] = [];
    for (let { name } of tables) {
      statements.push(`DELETE FROM main.${this.#quoteIdentifier(name)};`);
      statements.push(
        `INSERT INTO main.${this.#quoteIdentifier(name)}
         SELECT * FROM ${snapshotName}.${this.#quoteIdentifier(name)};`,
      );
    }
    await this.sqlite('exec', { dbId: this.dbId, sql: statements.join('\n') });
  }

  private async #openDatabase(filename: string, initializeSchema = true) {
    // It is possible to write to the local
    // filesystem via Origin Private Filesystem, but it requires _very_
    // restrictive response headers that would cause our host app to break
    // so we always stick to in-memory files to keep behavior deterministic.
    let response = await this.sqlite('open', {
      filename,
    });
    const { dbId } = response;
    this._dbId = dbId;

    if (initializeSchema && this.schemaSQL) {
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

    await this.#loadSchemaMetadata();
  }

  private async #loadSchemaMetadata() {
    let tables = (await this.internalExecute(
      `SELECT name FROM pragma_table_list WHERE schema = 'main' AND name != 'sqlite_schema'`,
    )) as { name: string }[];
    this.tables = tables.map((r) => r.name);
    let pks = (await this.internalExecute(
      `
        SELECT m.name AS table_name,
        GROUP_CONCAT(p.name, ', ') AS primary_keys
        FROM sqlite_master AS m
        JOIN pragma_table_info(m.name) AS p ON m.type = 'table'
        WHERE p.pk > 0
        GROUP BY m.name;
        `,
    )) as { table_name: string; primary_keys: string }[];
    this.primaryKeys.clear();
    for (let { table_name, primary_keys } of pks) {
      this.primaryKeys.set(table_name, primary_keys);
    }
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
      .replace(/\(case jsonb_typeof(\([^)]*\)) when 'array' .+ end\)/, '$1')
      .replace(/ANY_VALUE\(([^)]*)\)/g, '$1')
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
      .replace(/array_to_json\(/g, 'json(');
  }

  private assertNotClosed() {
    if (this.isClosed) {
      throw new Error(
        `Cannot perform operation, the db connection has been closed`,
      );
    }
  }

  #quoteIdentifier(identifier: string) {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  #rewriteSchemaSql(sql: string, schema: string) {
    return sql.replace(
      /^(CREATE\s+(?:TEMP\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+/i,
      (match) => `${match} ${schema}.`,
    );
  }
}

function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}
