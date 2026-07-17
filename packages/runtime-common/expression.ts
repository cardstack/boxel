import type * as JSONTypes from 'json-typescript';
import { isPlainObject } from 'lodash-es';
import stringify from 'safe-stable-stringify';
import { flattenDeep } from 'lodash-es';

import type { CodeRef, DBAdapter, TypeCoercion } from './index.ts';

export type Expression = (
  | string
  | Param
  | TableValuedTree
  | JsonContains
  | TypesContains
  | DBSpecificExpression
)[];

export type PgPrimitive =
  | number
  | string
  | boolean
  | JSONTypes.Object
  | JSONTypes.Arr
  | null;

export interface Param {
  param?: PgPrimitive;
  pg?: PgPrimitive;
  sqlite?: PgPrimitive;
  kind: 'param';
}

// pg/sqlite carries either a raw SQL fragment (scalar) or an inline
// Expression array, which lets adapter-specific branches thread parameters
// through without concatenating user input into SQL text. The scalar type
// deliberately excludes JSON arrays/objects — both to avoid rendering them
// as SQL text (never a valid use case) and to make the Array.isArray()
// branch in expressionToSql() unambiguously mean "inline Expression".
type DBSpecificScalar = string | number | boolean | null;
export interface DBSpecificExpression {
  pg?: DBSpecificScalar | Expression;
  sqlite?: DBSpecificScalar | Expression;
  kind: 'db-specific-expression';
}

export interface FieldQuery {
  type: CodeRef;
  path: string;
  useJsonBValue: boolean;
  errorHint: string;
  kind: 'field-query';
}

export interface FieldValue {
  type: CodeRef;
  path: string;
  value: CardExpression;
  errorHint: string;
  kind: 'field-value';
}

export interface TableValuedTree {
  kind: 'table-valued-tree';
  column: string;
  rootPath: string;
  fieldPath: string;
  treeColumn: string;
}

// Deferred (pass-1 input) node for a non-null `eq` predicate. The first pass
// resolves it against the field schema and decides — based on the leaf field's
// serializer — whether it can become a GIN-servable `JsonContains`. It is the
// `eq` analogue of FieldQuery.
export interface JsonContainsQuery {
  kind: 'json-contains-query';
  path: string;
  type: CodeRef;
  value: CardExpression;
}

// Resolved (pass-2 input) node describing JSON containment of `column` by the
// object formed from `segments` with `value` at the leaf — e.g. segments
// ['customer','id'] => {"customer":{"id": <value>}}. Like TableValuedTree it
// carries no SQL text and no schema dependence; expressionToSql renders it per
// adapter (Postgres `@>`, SQLite `-> / ->>` extraction).
export interface JsonContains {
  kind: 'json-contains';
  column: string;
  segments: string[];
  value: Param;
}

// Self-contained membership test: does the JSON array in `column` contain
// `key`? Rendered per adapter (Postgres `@>`, SQLite `json_each` EXISTS).
// Unlike a `jsonb_array_elements_text` cross join — which fans a row out into
// one row per array element and so gives a type condition exists-one-element
// semantics that miscompose under AND/NOT — this is a single per-row scalar
// predicate, so type conditions compose correctly (a real `NOT` exclusion, an
// AND intersection) and no GROUP BY is needed to recollapse the fan-out.
export interface TypesContains {
  kind: 'types-contains';
  column: string;
  key: string;
}

export interface FieldArity {
  type: CodeRef;
  path: string;
  value: CardExpression;
  pluralValue?: CardExpression;
  usePluralContainer?: boolean;
  errorHint: string;
  kind: 'field-arity';
}

export type CardExpression = (
  | string
  | Param
  | DBSpecificExpression
  | TableValuedTree
  | JsonContains
  | TypesContains
  | JsonContainsQuery
  | FieldQuery
  | FieldValue
  | FieldArity
)[];

export function addExplicitParens(expression: CardExpression): CardExpression;
export function addExplicitParens(expression: Expression): Expression;
export function addExplicitParens(expression: unknown[]): unknown[] {
  if (expression.length === 0) {
    return expression;
  } else {
    return ['(', ...expression, ')'];
  }
}

export function separatedByCommas(
  expressions: CardExpression[],
): CardExpression;
export function separatedByCommas(expressions: Expression[]): Expression;
export function separatedByCommas(expressions: unknown[][]): unknown {
  return expressions.reduce((accum, expression) => {
    if (accum.length > 0) {
      accum.push(',');
    }
    return accum.concat(expression);
  }, []);
}

export function param(value: { pg?: PgPrimitive; sqlite?: PgPrimitive }): Param;
export function param(value: PgPrimitive): Param;
export function param(
  value: PgPrimitive | { pg?: PgPrimitive; sqlite?: PgPrimitive },
): Param {
  if (
    value &&
    typeof value === 'object' &&
    ('pg' in value || 'sqlite' in value)
  ) {
    return {
      ...value,
      kind: 'param',
    };
  }
  return { param: value, kind: 'param' };
}

export function isParam(expression: any): expression is Param {
  return (
    isPlainObject(expression) &&
    'kind' in expression &&
    expression.kind === 'param'
  );
}

export function dbExpression({
  pg,
  sqlite,
}: {
  pg?: DBSpecificScalar | Expression;
  sqlite?: DBSpecificScalar | Expression;
}): DBSpecificExpression {
  return { pg, sqlite, kind: 'db-specific-expression' };
}

export function isDbExpression(
  expression: any,
): expression is DBSpecificExpression {
  return (
    isPlainObject(expression) &&
    'kind' in expression &&
    expression.kind === 'db-specific-expression'
  );
}

export function tableValuedTree(
  column: string,
  rootPath: string,
  fieldPath: string,
  treeColumn: string,
): TableValuedTree {
  return {
    kind: 'table-valued-tree',
    column,
    rootPath,
    fieldPath,
    treeColumn,
  };
}

export function jsonContainsQuery(
  path: string,
  type: CodeRef,
  value: CardExpression,
): JsonContainsQuery {
  return {
    kind: 'json-contains-query',
    path,
    type,
    value,
  };
}

export function typesContains(key: string, column = 'i.types'): TypesContains {
  return {
    kind: 'types-contains',
    column,
    key,
  };
}

export function fieldQuery(
  path: string,
  type: CodeRef,
  useJsonBValue: boolean,
  errorHint: string,
): FieldQuery {
  return {
    type,
    path,
    useJsonBValue,
    errorHint,
    kind: 'field-query',
  };
}

export function fieldValue(
  path: string,
  value: CardExpression,
  type: CodeRef,
  errorHint: string,
): FieldValue {
  return {
    type,
    path,
    value,
    errorHint,
    kind: 'field-value',
  };
}

export function fieldArity({
  type,
  path,
  value,
  usePluralContainer,
  errorHint,
  pluralValue,
}: {
  type: CodeRef;
  path: string;
  value: CardExpression;
  usePluralContainer?: boolean;
  errorHint: string;
  pluralValue?: CardExpression;
}): FieldArity {
  return {
    type,
    path,
    value,
    errorHint,
    usePluralContainer,
    pluralValue,
    kind: 'field-arity',
  };
}

export function every(expressions: CardExpression[]): CardExpression;
export function every(expressions: Expression[]): Expression;
export function every(expressions: unknown[][]): unknown {
  if (expressions.length === 0) {
    return ['true']; // this is "SQL true", not javascript true
  }
  return expressions
    .map((expression) =>
      addExplicitParens(expression as Expression | CardExpression),
    )
    .reduce((accum, expression: Expression | CardExpression) => [
      ...accum,
      'AND',
      ...expression,
    ]);
}

export function any(expressions: CardExpression[]): CardExpression;
export function any(expressions: Expression[]): Expression;
export function any(expressions: unknown[][]): unknown {
  if (expressions.length === 0) {
    return ['false']; // this is "SQL false", not javascript false
  }
  return expressions
    .map((expression) =>
      addExplicitParens(expression as Expression | CardExpression),
    )
    .reduce((accum, expression: Expression | CardExpression) => [
      ...accum,
      'OR',
      ...expression,
    ]);
}

interface Options {
  jsonFields?: string[];
}

export function asExpressions(
  values: Record<string, any>,
  opts?: Options,
): {
  nameExpressions: string[][];
  valueExpressions: Param[][];
} {
  let paramBucket = Object.fromEntries(
    Object.entries(values).map(([col, val]) => {
      if (opts?.jsonFields?.includes(col)) {
        return [col, param(val == null ? null : (stringify(val) ?? null))];
      }
      return [col, param(val ?? null)];
    }),
  );
  let nameExpressions = Object.keys(paramBucket).map((name) => [name]);
  let valueExpressions = Object.keys(paramBucket).map((k) => {
    let v = paramBucket[k];
    if (!Array.isArray(v) && !isParam(v)) {
      throw new Error(
        `values passed to upsert helper must already be expressions. You passed ${v} for ${k}`,
      );
    }
    if (isParam(v)) {
      return [v];
    }
    return v;
  });
  return { nameExpressions, valueExpressions };
}

export function upsert(
  table: string,
  constraint: string,
  nameExpressions: string[][],
  valueExpressions: Expression[],
) {
  let names = flattenDeep(nameExpressions);
  return [
    'INSERT INTO',
    table,
    ...addExplicitParens(separatedByCommas(nameExpressions)),
    'VALUES',
    ...addExplicitParens(separatedByCommas(valueExpressions)),
    'ON CONFLICT ON CONSTRAINT',
    constraint,
    'DO UPDATE SET',
    ...separatedByCommas(names.map((name) => [`${name}=EXCLUDED.${name}`])),
  ] as Expression;
}

export function upsertMultipleRows(
  table: string,
  constraint: string,
  nameExpressions: string[][],
  valueExpressions: Expression[][],
) {
  let names = flattenDeep(nameExpressions);
  return [
    'INSERT INTO',
    table,
    ...addExplicitParens(separatedByCommas(nameExpressions)),
    'VALUES',
    ...separatedByCommas(
      valueExpressions.map((expression) =>
        addExplicitParens(separatedByCommas(expression)),
      ),
    ),
    'ON CONFLICT ON CONSTRAINT',
    constraint,
    'DO UPDATE SET',
    ...separatedByCommas(names.map((name) => [`${name}=EXCLUDED.${name}`])),
  ] as Expression;
}
export function insert(
  table: string,
  nameExpressions: string[][],
  valueExpressions: Expression[],
) {
  return [
    'INSERT INTO',
    table,
    ...addExplicitParens(separatedByCommas(nameExpressions)),
    'VALUES',
    ...addExplicitParens(separatedByCommas(valueExpressions)),
    'RETURNING *',
  ] as Expression;
}

export function update(
  table: string,
  nameExpressions: string[][],
  valueExpressions: Expression[],
) {
  let names = flattenDeep(nameExpressions);
  let values = valueExpressions;
  return [
    'UPDATE',
    table,
    'SET',
    ...separatedByCommas(
      names.map((name, index) => [name, '=', values[index][0]]),
    ),
  ] as Expression;
}

export const tableValuedFunctionsPlaceholder = '__TABLE_VALUED_FUNCTIONS__';

// A connection-pinned query function. PgAdapter.withConnection hands one of
// these to its callback; it executes against a checked-out client so its
// queries share that connection (and therefore the connection's transaction
// state) with whatever else is running inside the same withConnection scope.
//
// CS-10898 plumbs an optional `Querier` through the realm-destruction helpers
// so a transaction wrapper above them can run their DELETEs on a single
// pinned connection. Helpers default to the shared dbAdapter when no Querier
// is provided, which preserves their pre-existing semantics for callers that
// don't need transactional grouping.
export type Querier = (
  expression: Expression,
) => Promise<Record<string, PgPrimitive>[]>;

export async function query(
  dbAdapter: DBAdapter,
  query: Expression,
  coerceTypes?: TypeCoercion,
) {
  let sql = await expressionToSql(dbAdapter.kind, query);
  return await dbAdapter.execute(sql.text, {
    coerceTypes,
    bind: sql.values,
  });
}

// Build a Querier that runs against the shared `dbAdapter` (i.e. checks out a
// fresh pool client per call). Helpers use this as the fallback when no
// pinned Querier is passed in.
export function dbAdapterQuerier(dbAdapter: DBAdapter): Querier {
  return (expression: Expression) =>
    query(dbAdapter, expression) as Promise<Record<string, PgPrimitive>[]>;
}

export function expressionToSql(
  dbAdapterKind: DBAdapter['kind'],
  query: Expression,
) {
  let values: PgPrimitive[] = [];
  let nonce = 0;
  let tableValuedFunctions = new Map<
    string,
    {
      name: string;
      fn: string;
    }
  >();

  let renderElement = (element: Expression[number]): string => {
    if (isDbExpression(element)) {
      let value = element[dbAdapterKind];
      if (Array.isArray(value)) {
        return (value as Expression).map(renderElement).join(' ');
      }
      return (value as DBSpecificScalar | undefined) == null
        ? ''
        : String(value);
    } else if (isParam(element)) {
      let value = element[dbAdapterKind] ?? element.param ?? null;
      values.push(
        value && typeof value === 'object' ? JSON.stringify(value) : value,
      );
      return `$${values.length}`;
    } else if (typeof element === 'string') {
      return element;
    } else if (element.kind === 'table-valued-tree') {
      let { column, rootPath, fieldPath, treeColumn } = element;
      let field = trimBrackets(
        rootPath === '$' ? column : rootPath.split('.').pop()!,
      );
      let key = `tree_${column}_${fieldPath}`;
      let { name } = tableValuedFunctions.get(key) ?? {};
      if (!name) {
        name = `${field}${nonce++}_tree`;
        let absolutePath = rootPath === '$' ? '$' : `$.${rootPath}`;

        tableValuedFunctions.set(key, {
          name,
          fn: `jsonb_tree(${column}, '${absolutePath}') as ${name}`,
        });
      }
      return `${name}.${treeColumn}`;
    } else if (element.kind === 'json-contains') {
      // Render the containment of `column` by {segments: value}. Both branches
      // re-use renderElement so binds are pushed in left-to-right order.
      let { column, segments, value } = element;
      if (dbAdapterKind === 'sqlite') {
        // SQLite has no `@>`; navigate the singular object path: interior
        // segments with `->`, the leaf with `->>`, then compare. (Only string
        // leaves reach here, so `->>` text-equality matches the value.)
        let frag: Expression = [column];
        segments.forEach((segment, i) => {
          frag.push(i === segments.length - 1 ? '->>' : '->', param(segment));
        });
        frag.push('=', value);
        return frag.map(renderElement).join(' ');
      }
      // Postgres: GIN-servable containment, full nested object from the root.
      let nested = segments.reduceRight<JSONTypes.Value>(
        (acc, segment) => ({ [segment]: acc }),
        (value[dbAdapterKind] ?? value.param ?? null) as JSONTypes.Value,
      );
      return [column, '@>', param(nested as JSONTypes.Object), '::jsonb']
        .map(renderElement)
        .join(' ');
    } else if (element.kind === 'types-contains') {
      // Per-row array membership. COALESCE keeps a NULL/absent `types` array a
      // definite FALSE (not SQL NULL) at positive polarity, so an enclosing
      // `NOT (...)` keeps rows whose types never indexed rather than dropping
      // them — the fan-out approach eliminated those rows before WHERE ran.
      let { column, key } = element;
      if (dbAdapterKind === 'sqlite') {
        return [
          'EXISTS (SELECT 1 FROM json_each(COALESCE(',
          column,
          `, '[]')) WHERE value =`,
          param(key),
          ')',
        ]
          .map(renderElement)
          .join(' ');
      }
      // The boxel_index_types_containment_idx GIN indexes (migration
      // 1784272066344) cover this exact expression — Postgres only uses an
      // expression index when the query expression matches it verbatim, so
      // changing the SQL here (e.g. the COALESCE wrapper) un-indexes type
      // filters unless the index expression moves with it.
      return ['COALESCE(', column, `, '[]'::jsonb) @>`, param([key]), '::jsonb']
        .map(renderElement)
        .join(' ');
    } else {
      throw assertNever(element);
    }
  };

  let text = query.map(renderElement).join(' ');

  if (tableValuedFunctions.size > 0) {
    text = replace(
      text,
      tableValuedFunctionsPlaceholder,
      `${[...tableValuedFunctions.values()]
        .map((fn) => `CROSS JOIN LATERAL ${fn.fn}`)
        .join(' ')}`,
    );
  } else {
    text = replace(text, tableValuedFunctionsPlaceholder, '');
  }
  return {
    text,
    values,
  };
}

function trimBrackets(pathTraveled: string) {
  return pathTraveled.replace(/\[\]/g, '');
}

// i'm slicing up the text as opposed to using a 'String.replace()' since
// the ()'s in the SQL query are treated like regex matches when using
// String.replace()
function replace(text: string, placeholder: string, replacement: string) {
  let index = text.indexOf(placeholder);
  if (index === -1) {
    return text;
  }
  return `${text.substring(0, index)}${replacement}${text.substring(
    index + placeholder.length,
  )}`;
}

function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}
