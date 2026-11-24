import type { PgAdapter } from '@cardstack/postgres';
import {
  param,
  query,
  type DBAdapter,
  type Expression,
} from '@cardstack/runtime-common';
import type { LogLineIndexHost } from '@cardstack/runtime-common/log-line-index';
import {
  logSearchResponse,
  type LogQuery,
} from '@cardstack/runtime-common/log-query';

// Shared by the log query tests: a log index host over files held in memory,
// a log query's answer as the wire gives it, and a row count of a log table.

export type Row = Record<string, any>;

// A host whose files are the entries of `files`, read as they are when read.
export function memoryLogHost(
  dbAdapter: PgAdapter,
  realmURL: string,
  files: Map<string, string>,
): LogLineIndexHost {
  return {
    dbAdapter,
    realmURL,
    query: (e: Expression) => query(dbAdapter, e) as any,
    readLogFile: async (url) =>
      files.has(url) ? { content: files.get(url)! } : undefined,
  };
}

// The status and the first error's code and message; a throw is the crash a
// 500 would be.
export async function logAnswer(
  adapter: DBAdapter,
  realmURL: string,
  body: Row,
  opts: Parameters<typeof logSearchResponse>[3] = {},
) {
  try {
    let { status, body: answer } = await logSearchResponse(
      adapter,
      realmURL,
      body as LogQuery,
      opts,
    );
    let error = (answer as Row)?.errors?.[0];
    return {
      status,
      body: answer as Row,
      code: error?.code as string | undefined,
      message: String(error?.message ?? ''),
      crash: undefined as string | undefined,
    };
  } catch (e: any) {
    return {
      status: 500,
      body: undefined as Row | undefined,
      code: undefined as string | undefined,
      message: '',
      crash: `${e?.name}: ${e?.message}`,
    };
  }
}

// How many rows of `table` hold `value` in `column`.
export async function countRows(
  dbAdapter: PgAdapter,
  table: string,
  column: 'url' | 'realm_url',
  value: string,
): Promise<number> {
  let [row] = (await query(dbAdapter, [
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} =`,
    param(value),
  ] as Expression)) as { n: unknown }[];
  return Number(row.n);
}
