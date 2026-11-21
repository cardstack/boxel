// A query's expressions (a sort's `expression`, a window's, a blend
// signal's) are checked in two steps. The query profile's check is light and
// runs wherever a query is read, the browser included. Whether an expression
// compiles to SQL (BXL's score profile, formula-sql.ts) is the server's
// check: the score compiler is server code, so no browser bundle carries it.
//
// A process that runs queries on Postgres provides the compiler
// (`provideExpressionSql`; the Postgres adapter does, @cardstack/postgres).
// The query grammar then checks that an expression compiles where it checks
// the rest of the query (`checkExpressionSql`), and the index query engine
// compiles it to SQL. Where nothing provides it, as in a browser, the grammar
// checks only that the expression parses, refusing a syntax error as the
// compiler does; one the score profile cannot express is refused by the
// server it is sent to, and the browser's SQLite index runs no expression
// (`needs-postgres`).
import { refuse } from './query-refusals.ts';
import {
  queryExpressionIssues,
  readScoreFormula,
} from '@cardstack/bxl/compiler';
import type { exprFieldPaths, exprSortSql } from './formula-sql.ts';

export interface ExpressionSql {
  exprSortSql: typeof exprSortSql;
  exprFieldPaths: typeof exprFieldPaths;
}

let provided: ExpressionSql | undefined;

export function provideExpressionSql(sql: ExpressionSql): void {
  provided = sql;
}

// The expression compiler, where this process has one.
export function expressionSql(): ExpressionSql | undefined {
  return provided;
}

// The expression compiler, for a statement about to run on Postgres.
export function requireExpressionSql(): ExpressionSql {
  if (!provided) {
    throw new Error(
      'no expression compiler: a process that runs queries on Postgres loads @cardstack/postgres, which provides it (runtime-common/query-expression.ts)',
    );
  }
  return provided;
}

// Whether an expression compiles to SQL, refused as `exprSortSql` refuses it
// (`invalid-expression`, "expression: …"): compiled where this process has
// the compiler, and otherwise only parsed.
export function checkExpressionSql(expr: string): void {
  if (provided) {
    provided.exprSortSql(expr);
    return;
  }
  let read = readScoreFormula(expr);
  if ('error' in read) {
    throw refuse('expression-2', undefined, { error: read.error });
  }
}

// An expression inside a query runs under BXL's query profile: spreadsheet
// functions, arithmetic, comparisons and logic, field paths and the names it
// binds itself. A jq pipe, a helper (`def`), an update, a stream, a read of
// the environment or the request, and a module directive are refused with
// `invalid-expression`, naming the construct. Full BXL stays for computed
// fields.
export function assertQueryExpressionProfile(
  member: string,
  expr: unknown,
): void {
  // past the 2,000-character limit the query is refused for its length,
  // without parsing it
  if (typeof expr !== 'string' || expr.length > 2000) return;
  let issues = queryExpressionIssues(expr);
  if (issues.length) {
    let messages = [...new Set(issues.map((issue) => issue.message))];
    throw refuse('refusal-3', undefined, {
      member,
      value1: JSON.stringify(
        expr.length > 120 ? `${expr.slice(0, 120)}…` : expr,
      ),
      value2: messages.join(' '),
    });
  }
}
