// Text written into SQL as a literal, where a bind parameter cannot go: a
// field path the expression builder renders into a `jsonb_tree(…)` call in
// a FROM clause. The quoting rules live here and are tested once
// (realm-server/tests/sql-literal-test.ts). Prefer a bound parameter
// (`param(…)`) wherever the query builder takes one.
//
// No imports, so any SQL builder can use it.

export type SqlLiteralDialect = 'pg' | 'sqlite';

export class SqlLiteralError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlLiteralError';
  }
}

// A string as a SQL text literal. A quote is doubled. On Postgres a string
// holding a backslash is written as an escape string (`E'…'`) with each
// backslash doubled, so it reads the same whether or not the server has
// `standard_conforming_strings` on (as Postgres's own `quote_literal` does).
// SQLite has no escape strings and reads a backslash as itself. A NUL can't
// be held by a text value in either database, and is refused here rather
// than cutting the literal short in a driver.
export function sqlTextLiteral(
  value: string,
  dialect: SqlLiteralDialect = 'pg',
): string {
  if (typeof value !== 'string') {
    throw new SqlLiteralError(`not text: ${typeof value}`);
  }
  if (value.includes('\0')) {
    throw new SqlLiteralError('a SQL literal cannot hold a NUL character');
  }
  let quoted = value.replace(/'/g, "''");
  if (dialect === 'pg' && value.includes('\\')) {
    return `E'${quoted.replace(/\\/g, '\\\\')}'`;
  }
  return `'${quoted}'`;
}
