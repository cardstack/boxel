// Text written into SQL as a literal, where a bind parameter cannot go: the
// SQL a formula compiles to (BXL's score profile returns SQL text), a column
// the engine joins into its select list as text, a function call rendered
// into a FROM clause, DDL. Every such literal is made here, so the quoting
// rules live in one place and are tested once
// (realm-server/tests/sql-literal-test.ts). Prefer a bound parameter
// (`param(…)`) wherever the query builder takes one.
//
// No imports: the query grammar, its lowering, the formula compiler's
// callers and the vector store all use it.

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

// One element of a Postgres array literal (`{a,b}`), double-quoted with its
// quotes and backslashes escaped, as the array parser reads them: a bare
// `null` element would be SQL NULL, and a name may hold a comma or a brace.
// Not yet a SQL literal: `sqlTextArrayLiteral` makes one.
export function arrayElement(name: string): string {
  return `"${name.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

// A path of keys as a Postgres `text[]` literal, for `#>` and `#>>`.
export function sqlTextArrayLiteral(parts: readonly string[]): string {
  return `${sqlTextLiteral(`{${parts.map(arrayElement).join(',')}}`)}::text[]`;
}

// A path of keys as a SQL/JSON path (`$."a"."b"[*]`): each key a JSON string
// (so a quote, a backslash or a control character in it is escaped as JSON
// escapes it, which the jsonpath grammar reads), and a key written `name[]`
// steps into every element of that list.
export function jsonPathOfKeys(segments: readonly string[]): string {
  return (
    '$' +
    segments
      .map((x) =>
        x.endsWith('[]')
          ? `.${JSON.stringify(x.slice(0, -2))}[*]`
          : `.${JSON.stringify(x)}`,
      )
      .join('')
  );
}

// The same path as a SQL literal of type jsonpath.
export function sqlJsonPathLiteral(segments: readonly string[]): string {
  return `${sqlTextLiteral(jsonPathOfKeys(segments))}::jsonpath`;
}
