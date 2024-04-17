import * as JSONTypes from 'json-typescript';
import isPlainObject from 'lodash/isPlainObject';
import stringify from 'safe-stable-stringify';
import flattenDeep from 'lodash/flattenDeep';

import { CodeRef } from '../index';

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
  path: string;
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

export function tableValuedEach(column: string, path: string): TableValuedEach {
  return {
    kind: 'table-valued-each',
    column,
    path,
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
  errorHint: string,
): FieldQuery {
  return {
    type,
    path,
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

export function fieldArity(
  type: CodeRef,
  path: string,
  value: CardExpression,
  errorHint: string,
): FieldArity {
  return {
    type,
    path,
    value,
    errorHint,
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
