import * as JSONTypes from 'json-typescript';
import isPlainObject from 'lodash/isPlainObject';
import stringify from 'safe-stable-stringify';
import flattenDeep from 'lodash/flattenDeep';

import { type CodeRef, type DBAdapter, type TypeCoercion } from './index';

export type Expression = (string | Param | TableValuedEach | TableValuedTree)[];

export type PgPrimitive =
  | number
  | string
  | boolean
  | JSONTypes.Object
  | JSONTypes.Arr
  | null;

export interface Param {
  param: PgPrimitive;
  kind: 'param';
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

export interface TableValuedEach {
  kind: 'table-valued-each';
  column: string;
}

export interface TableValuedTree {
  kind: 'table-valued-tree';
  column: string;
  path: string;
  treeColumn: string;
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
  | TableValuedEach
  | TableValuedTree
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

export function param(value: PgPrimitive): Param {
  return { param: value, kind: 'param' };
}

export function isParam(expression: any): expression is Param {
  return isPlainObject(expression) && 'param' in expression;
}

export function tableValuedEach(column: string): TableValuedEach {
  return {
    kind: 'table-valued-each',
    column,
  };
}

export function tableValuedTree(
  column: string,
  path: string,
  treeColumn: string,
): TableValuedTree {
  return {
    kind: 'table-valued-tree',
    column,
    path,
    treeColumn,
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
    Object.entries(values).map(([col, val]) => [
      col,
      // TODO: SQLite requires JSON be referenced in a stringified
      // manner--need to confirm if postgres is ok with this

      // TODO probably we should insert using the json() or jsonb() function in
      // SQLite, need to check for compatibility in postgres for this function
      param(opts?.jsonFields?.includes(col) ? stringify(val) : val),
    ]),
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

export const tableValuedFunctionsPlaceholder = '__TABLE_VALUED_FUNCTIONS__';

export async function query(
  dbAdapter: DBAdapter,
  query: Expression,
  coerceTypes?: TypeCoercion,
) {
  let sql = await expressionToSql(query);
  return await dbAdapter.execute(sql.text, {
    coerceTypes,
    bind: sql.values,
  });
}

export function expressionToSql(query: Expression) {
  let values: PgPrimitive[] = [];
  let nonce = 0;
  let tableValuedFunctions = new Map<
    string,
    {
      name: string;
      fn: string;
    }
  >();
  let text = query
    .map((element) => {
      if (isParam(element)) {
        values.push(element.param);
        return `$${values.length}`;
      } else if (typeof element === 'string') {
        return element;
      } else if (element.kind === 'table-valued-tree') {
        let { column, path, treeColumn } = element;
        let field = trimBrackets(
          path === '$' ? column : path.split('.').pop()!,
        );
        let key = `tree_${column}_${path}`;
        let { name } = tableValuedFunctions.get(key) ?? {};
        if (!name) {
          name = `${field}${nonce++}_tree`;
          let absolutePath = path === '$' ? '$' : `$.${path}`;

          tableValuedFunctions.set(key, {
            name,
            fn: `jsonb_tree(${column}, '${absolutePath}') as ${name}`,
          });
        }
        return `${name}.${treeColumn}`;
      } else if (element.kind === 'table-valued-each') {
        let { column } = element;
        let key = `each_${column}`;
        let { name } = tableValuedFunctions.get(key) ?? {};
        if (!name) {
          name = `${column}${nonce++}_array_element`;

          tableValuedFunctions.set(key, {
            name,
            fn: `jsonb_array_elements_text(${column}) as ${name}`,
          });
        }
        return name;
      } else {
        throw assertNever(element);
      }
    })
    .join(' ');

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
