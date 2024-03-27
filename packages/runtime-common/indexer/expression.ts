import * as JSONTypes from 'json-typescript';
import isPlainObject from 'lodash/isPlainObject';

export type Expression = (string | Param)[];

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

export function addExplicitParens(expression: Expression): Expression;
export function addExplicitParens(expression: unknown[]): unknown[] {
  if (expression.length === 0) {
    return expression;
  } else {
    return ['(', ...expression, ')'];
  }
}

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

export function every(expressions: Expression[]): Expression;
export function every(expressions: unknown[][]): unknown {
  if (expressions.length === 0) {
    return ['true']; // this is "SQL true", not javascript true
  }
  return expressions
    .map((expression) => addExplicitParens(expression as Expression))
    .reduce((accum, expression: Expression) => [
      ...accum,
      'AND',
      ...expression,
    ]);
}

export function any(expressions: Expression[]): Expression;
export function any(expressions: unknown[][]): unknown {
  if (expressions.length === 0) {
    return ['false']; // this is "SQL false", not javascript false
  }
  return expressions
    .map((expression) => addExplicitParens(expression as Expression))
    .reduce((accum, expression: Expression) => [...accum, 'OR', ...expression]);
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
      {
        kind: 'param' as const,
        // TODO: SQLite requires JSON be referenced in a stringified
        // manner--need to confirm if postgres is ok with this
        param: opts?.jsonFields?.includes(col) ? JSON.stringify(val) : val,
      },
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
