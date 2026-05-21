import type {
  ExpressionAst,
  NormalBinaryOperator,
} from '../parser/AST.js';
import { JqEvaluateError } from '../errors.js';
import { applyNormalBinaryOperator } from './applyBinary.js';
import { applyFormat } from './applyFormat.js';
import {
  getBareNativeFilter,
  type NativeFilter,
} from './filters/lib/nativeFilter.js';
import { access, isTrue, type PathItem } from './utils/utils.js';

export type CompiledScalarExpression = (input: unknown) => unknown;

const SINGLE_OUTPUT_BARE_NATIVE_FILTERS = new Set([
  'ABS/1',
  'DATE/3',
  'DATEDIF/3',
  'DATEVALUE/1',
  'DAY/1',
  'DAYS360/2',
  'DAYS360/3',
  'MONTH/1',
  'NETWORKDAYS/2',
  'NETWORKDAYS/3',
  'ROUND/1',
  'ROUND/2',
  'ROUNDDOWN/1',
  'ROUNDDOWN/2',
  'ROUNDUP/1',
  'ROUNDUP/2',
  'WEEKNUM/1',
  'WEEKNUM/2',
  'WORKDAY/2',
  'WORKDAY/3',
  'YEAR/1',
  'YEARFRAC/2',
  'YEARFRAC/3',
  'ceil/0',
  'floor/0',
  'length/0',
  'round/0',
  'sort/0',
  'sqrt/0',
  'tostring/0',
]);

function isNormalBinaryOperator(op: string): op is NormalBinaryOperator {
  switch (op) {
    case '==':
    case '!=':
    case '<':
    case '>':
    case '<=':
    case '>=':
    case '+':
    case '-':
    case '*':
    case '/':
    case '%':
      return true;
    default:
      return false;
  }
}

function accessStaticStringPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null) {
      continue;
    }
    if (typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[key] ?? null;
      continue;
    }
    current = access(current, key);
  }
  return current;
}

function compileExcelIf(
  args: ExpressionAst[],
): CompiledScalarExpression | undefined {
  const cond = compileScalarExpression(args[0]);
  const thenExpr = compileScalarExpression(args[1]);
  const elseExpr = args[2] ? compileScalarExpression(args[2]) : () => false;
  if (!cond || !thenExpr || !elseExpr) {
    return undefined;
  }
  return (input) => (isTrue(cond(input)) ? thenExpr(input) : elseExpr(input));
}

function compileExcelIfs(
  args: ExpressionAst[],
): CompiledScalarExpression | undefined {
  if (args.length < 2 || args.length % 2 !== 0) {
    return undefined;
  }
  const pairs: [CompiledScalarExpression, CompiledScalarExpression][] = [];
  for (let i = 0; i < args.length; i += 2) {
    const cond = compileScalarExpression(args[i]);
    const value = compileScalarExpression(args[i + 1]);
    if (!cond || !value) {
      return undefined;
    }
    pairs.push([cond, value]);
  }
  return (input) => {
    for (const [cond, value] of pairs) {
      if (isTrue(cond(input))) {
        return value(input);
      }
    }
    throw new JqEvaluateError('#N/A');
  };
}

function compileBareNativeFilter(
  node: Extract<ExpressionAst, { type: 'filter' }>,
): CompiledScalarExpression | undefined {
  if (!SINGLE_OUTPUT_BARE_NATIVE_FILTERS.has(node.name)) {
    return undefined;
  }
  const resolvedNative = node.resolvedNative;
  if (typeof resolvedNative !== 'function') {
    return undefined;
  }
  const bareFilter = getBareNativeFilter(resolvedNative as NativeFilter);
  if (!bareFilter) {
    return undefined;
  }
  const args: CompiledScalarExpression[] = [];
  for (const arg of node.args) {
    const compiledArg = compileScalarExpression(arg);
    if (!compiledArg) {
      return undefined;
    }
    args.push(compiledArg);
  }
  return (input) => {
    const iterator = bareFilter(
      input,
      ...args.map((compiledArg) => compiledArg(input)),
    );
    const next = iterator.next();
    return next.done ? undefined : next.value;
  };
}

export function compileScalarExpression(
  node: ExpressionAst | undefined,
): CompiledScalarExpression | undefined {
  if (!node) {
    return undefined;
  }

  switch (node.type) {
    case 'identity':
      return (input) => input;
    case 'num':
    case 'bool':
    case 'null':
      return () => node.value;
    case 'str':
      return node.interpolated ? undefined : () => node.value;
    case 'format':
      return (input) => applyFormat(node, input);
    case 'index': {
      if (node.staticPath) {
        const path = node.staticPath;
        return (input) => accessStaticStringPath(input, path);
      }
      const target = compileScalarExpression(node.expr);
      if (!target) return undefined;
      if (typeof node.index === 'string') {
        const key = node.index;
        return (input) => access(target(input), key);
      }
      const index = compileScalarExpression(node.index);
      if (!index) return undefined;
      return (input) => access(target(input), index(input) as PathItem | any[]);
    }
    case 'unary': {
      if (node.operator !== '-') return undefined;
      const expr = compileScalarExpression(node.expr);
      return expr ? (input) => -(expr(input) as number) : undefined;
    }
    case 'filter':
      if (node.name === 'IF/2' || node.name === 'IF/3') {
        return compileExcelIf(node.args);
      }
      if (node.name.startsWith('IFS/')) {
        return compileExcelIfs(node.args);
      }
      return compileBareNativeFilter(node);
    case 'binary': {
      const operator = node.operator;
      if (operator === '|') {
        const left = compileScalarExpression(node.left);
        const right = compileScalarExpression(node.right);
        if (!left || !right) {
          return undefined;
        }
        return (input) => right(left(input));
      }
      if (operator === 'and' || operator === 'or') {
        const left = compileScalarExpression(node.left);
        const right = compileScalarExpression(node.right);
        if (!left || !right) {
          return undefined;
        }
        return operator === 'and'
          ? (input) => (isTrue(left(input)) ? isTrue(right(input)) : false)
          : (input) => (isTrue(left(input)) ? true : isTrue(right(input)));
      }
      if (!isNormalBinaryOperator(operator)) {
        return undefined;
      }
      const left = compileScalarExpression(node.left);
      const right = compileScalarExpression(node.right);
      if (!left || !right) {
        return undefined;
      }
      return (input) =>
        applyNormalBinaryOperator(operator, left(input), right(input));
    }
    default:
      return undefined;
  }
}
