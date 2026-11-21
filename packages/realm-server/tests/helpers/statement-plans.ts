import type { PgAdapter } from '@cardstack/postgres';
import {
  expressionToSql,
  type DBAdapter,
  type Querier,
} from '@cardstack/runtime-common';

// The statements a piece of work runs, and what each one reads: for tests
// that hold a search to the rows it may touch, not only to its answer.

export interface CapturedStatement {
  sql: string;
  bind: unknown[];
}

// Every statement `fn` runs on `db`: through `execute`, and through a
// transaction block's querier, on the adapter or on a read snapshot's reader
// (a filter-first page reads its matches in one).
export async function captureStatements(
  db: PgAdapter,
  fn: () => Promise<unknown>,
): Promise<CapturedStatement[]> {
  let statements: CapturedStatement[] = [];
  let record = (sql: string, bind: unknown) =>
    statements.push({ sql, bind: (bind as unknown[] | undefined) ?? [] });
  let spyOnBlock =
    (
      withTransaction: DBAdapter['withTransaction'],
    ): DBAdapter['withTransaction'] =>
    (body, opts) =>
      withTransaction(
        (q: Querier) =>
          body((expression) => {
            let sql = expressionToSql('pg', expression);
            record(sql.text, sql.values);
            return q(expression);
          }),
        opts,
      );
  let execute = db.execute;
  let withTransaction = db.withTransaction;
  let withReadSnapshot = db.withReadSnapshot;
  db.execute = function (this: PgAdapter, ...args) {
    record(args[0], args[1]?.bind);
    return execute.apply(this, args);
  } as PgAdapter['execute'];
  db.withTransaction = spyOnBlock(withTransaction.bind(db));
  db.withReadSnapshot = function (this: PgAdapter, run, opts) {
    return withReadSnapshot.call(
      this,
      (reader) =>
        run(
          Object.assign(Object.create(reader), {
            withTransaction: spyOnBlock(reader.withTransaction.bind(reader)),
          }),
        ),
      opts,
    );
  } as PgAdapter['withReadSnapshot'];
  try {
    await fn();
  } finally {
    db.execute = execute;
    db.withTransaction = withTransaction;
    db.withReadSnapshot = withReadSnapshot;
  }
  return statements;
}

// One scan of a table in a statement's executed plan.
export interface TableScan {
  table: string;
  node: string;
  // rows the scan looked at: the ones it returned and the ones its filter
  // removed, over every loop
  rowsExamined: number;
  // shared buffers the scan touched (hit or read), over every loop
  blocks: number;
}

// The scans of the tables a statement read, from running it under
// `EXPLAIN (ANALYZE, BUFFERS)` with its own parameters. Only a query runs.
export async function tableScans(
  db: PgAdapter,
  statement: CapturedStatement,
): Promise<TableScan[]> {
  let [row] = (await db.execute(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`,
    { bind: statement.bind as never },
  )) as Record<string, unknown>[];
  let plan = (Object.values(row)[0] as { Plan: PlanNode }[])[0].Plan;
  let scans: TableScan[] = [];
  let walk = (node: PlanNode) => {
    if (node['Relation Name']) {
      let loops = Number(node['Actual Loops'] ?? 1);
      scans.push({
        table: node['Relation Name'],
        node: node['Node Type'],
        rowsExamined:
          (Number(node['Actual Rows'] ?? 0) +
            Number(node['Rows Removed by Filter'] ?? 0) +
            Number(node['Rows Removed by Index Recheck'] ?? 0)) *
          loops,
        blocks:
          Number(node['Shared Hit Blocks'] ?? 0) +
          Number(node['Shared Read Blocks'] ?? 0),
      });
    }
    for (let child of node.Plans ?? []) {
      walk(child);
    }
  };
  walk(plan);
  return scans;
}

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  'Rows Removed by Index Recheck'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: PlanNode[];
}

// Whether a captured statement is a read (a query the plan reader may run
// again).
export function isRead(statement: CapturedStatement): boolean {
  return /^\s*(SELECT|WITH)\b/i.test(statement.sql);
}

// `count` rows of another realm in boxel_index and prerendered_html, so the
// tables are the size a planner reads by index rather than by scanning a
// page or two. The rows are deleted cards: no search finds them, and the
// value store, which holds live cards, holds none of them.
export async function seedOtherRealmRows(
  db: PgAdapter,
  count: number,
  realm = 'http://filler-realm/',
): Promise<void> {
  for (let table of ['boxel_index', 'prerendered_html']) {
    await db.execute(
      `INSERT INTO ${table} (url, file_alias, type, generation, realm_url${
        table === 'boxel_index' ? ', types, has_error, is_deleted' : ''
      }) SELECT $1 || 'Filler/f' || n || '.json', $1 || 'Filler/f' || n, 'instance', 1, $1${
        table === 'boxel_index' ? `, '["filler"]'::jsonb, FALSE, TRUE` : ''
      } FROM generate_series(1, ${Number(count)}) AS n`,
      { bind: [realm] },
    );
  }
}
