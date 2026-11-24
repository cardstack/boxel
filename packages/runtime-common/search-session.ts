import type { DBAdapter } from './db.ts';
import {
  dbAdapterQuerier,
  type Expression,
  type Querier,
} from './expression.ts';

// The settings every search statement runs with, on Postgres. One place for
// them: a search's read snapshot sets them when it opens (PgAdapter
// `withReadSnapshot`), and a search's read that runs outside a snapshot (a
// lookup cached across searches, the typo nominations' own transaction) runs
// through `inSearchSettings`, which sets them for its transaction.
//
// jit: off. Postgres's default JIT-compiles any plan its estimate puts above
// jit_above_cost (100,000), and a search's estimates are inflated by the
// correlated lookups it runs per card: a nested-value match walks each card's
// JSON with a recursive set-returning scan the planner guesses at 800,000 rows
// a card, so a page over a hundred cards is estimated in the millions even
// when it reads a few hundred rows. Raising the threshold tenfold still let
// such pages compile, with inlining and optimization, for 0.3-1.6 s each, and
// a backend that has compiled keeps 70-90 MB of LLVM's memory for the rest of
// its life, which a pool of forty multiplies. Searches here read thousands of
// rows, not the millions where compiling pays, so they never compile.
// PG_SEARCH_JIT=on turns it back on (at the server's own thresholds).
//
// work_mem: Postgres's default 4 MB spills a facet's value counts and a
// window sort over tens of thousands of rows to disk. 8 MB holds them. It is
// per sort or hash node (hash nodes may use twice it), and a search plans a
// handful: with the pool's 40 connections all running one at once, the
// worst case stays near 2.5 GB, inside a 6 GB database host, and most
// searches use a fraction. PG_SEARCH_WORK_MEM_KB overrides it.
export const SEARCH_WORK_MEM_KB = 8 * 1024;

function env(name: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string> } }).process
    ?.env?.[name];
}

export function searchSessionSettings(): { jit: boolean; workMemKb: number } {
  let raw = Number(env('PG_SEARCH_WORK_MEM_KB'));
  return {
    jit: env('PG_SEARCH_JIT') === 'on',
    workMemKb: Number.isInteger(raw) && raw > 0 ? raw : SEARCH_WORK_MEM_KB,
  };
}

// The settings as statements, local to the transaction they run in, so they
// end with it and never reach another caller of the pool. SET, not
// set_config: a SET is never planned, so it never compiles before it takes
// effect. Whole numbers and fixed words this module computed, so they are
// written into the SQL.
export function searchSettingsStatements(): string[] {
  let { jit, workMemKb } = searchSessionSettings();
  return [
    `SET LOCAL jit = ${jit ? 'on' : 'off'}`,
    `SET LOCAL work_mem = ${workMemKb}`,
  ];
}

// Run `fn`'s statements in a transaction that carries the search settings.
// On SQLite, which has none, `fn` runs on the adapter as it is.
export async function inSearchSettings<T>(
  dbAdapter: DBAdapter,
  fn: (q: Querier) => Promise<T>,
): Promise<T> {
  if (dbAdapter.kind !== 'pg') {
    return await fn(dbAdapterQuerier(dbAdapter));
  }
  return await dbAdapter.withTransaction(async (q) => {
    for (let statement of searchSettingsStatements()) {
      await q([statement]);
    }
    return await fn(q);
  });
}

// One search statement outside a read snapshot.
export async function searchRead(dbAdapter: DBAdapter, expression: Expression) {
  return await inSearchSettings(dbAdapter, (q) => q(expression));
}
