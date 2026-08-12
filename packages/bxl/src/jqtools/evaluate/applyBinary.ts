import {
  AlternativeOperator,
  AssignmentOperator,
  BinaryOperator,
  BooleanBinaryOperator,
  NormalBinaryOperator,
} from '../parser/AST.js';
import {
  createItem,
  deepClone,
  deepMerge,
  generatePaths,
  generateValues,
  isTrue,
  Item,
  ItemIterator,
  relativizePath,
  repeatString,
  Type,
  typeOf,
  typesEqual,
  typesMatch,
  typesMatchCommutative,
} from './utils/utils.js';
import { compare } from './compare.js';
import { JqEvaluateError } from '../errors.js';
import { setPath } from './utils/setPath.js';
import { combineIterators, nestedIterators } from './utils/nestedIterators.js';
import { getPath } from './utils/getPath.js';
import {
  BinaryOperatorType,
  isBinaryOperatorType,
} from './utils/binaryOperator.js';
import { checkRuntimeBudget } from './runtimeState.js';

function cannotApplyOperatorToError(op: BinaryOperator, left: any, right: any) {
  return new JqEvaluateError(
    `Operator ${op} cannot be applied to ${typeOf(left)} and ${typeOf(right)}`
  );
}

function cannotApplyOperator(op: BinaryOperator) {
  return new JqEvaluateError(`applyBinary: Cannot apply operator '${op}'`);
}

// Excel-style numeric coercion for arithmetic operators.
// Returns [leftNum, rightNum] if both can be coerced, or null if not.
function coerceToNumbers(left: any, right: any): [number, number] | null {
  const l = coerceOne(left);
  const r = coerceOne(right);
  if (l !== null && r !== null) return [l, r];
  return null;
}

function coerceOne(val: any): number | null {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (val === null || val === undefined) return 0;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'string' && val !== '' && !Number.isNaN(Number(val))) return parseFloat(val);
  return null;
}

// bxl-null-tolerant arithmetic: null/undefined → propagate null on -,*,/,%; identity on +
export function applyNormalBinaryOperator(
  op: NormalBinaryOperator,
  left: any,
  right: any
): any {
  if (op === '/' || op === '*' || op === '-' || op === '%') {
    if (left == null || right == null) {
      return null;
    }
  }
  switch (op) {
    case '==':
      return compare(left, right) === 0;
    case '!=':
      return compare(left, right) !== 0;
    case '<':
      return compare(left, right) < 0;
    case '>':
      return compare(left, right) > 0;
    case '<=':
      return compare(left, right) <= 0;
    case '>=':
      return compare(left, right) >= 0;
    case '+':
      if (left == null && right == null) {
        return null;
      }
      if (left == null) return right;
      if (right == null) return left;

      if (!typesEqual(left, right)) {
        // Excel-style coercion: try numeric arithmetic before failing
        const nums = coerceToNumbers(left, right);
        if (nums) return nums[0] + nums[1];
        throw cannotApplyOperatorToError(op, left, right);
      }
      switch (typeOf(left)) {
        case Type.string:
        case Type.number:
          return left + right;
        case Type.array:
          return [...left, ...right];
        case Type.object:
          return { ...left, ...right };
        default:
          throw cannotApplyOperatorToError(op, left, right);
      }
    case '-':
      if (!typesEqual(left, right)) {
        // Excel-style coercion: try numeric subtraction before failing
        const nums = coerceToNumbers(left, right);
        if (nums) return nums[0] - nums[1];
        throw cannotApplyOperatorToError(op, left, right);
      }
      switch (typeOf(left)) {
        case Type.number:
          return left - right;
        case Type.array:
          // Set subtraction
          return left.filter(
            (leftItem: any) =>
              !right.some(
                (rightItem: any) => compare(leftItem, rightItem) === 0
              )
          );
        default:
          throw cannotApplyOperatorToError(op, left, right);
      }
    case '*':
      if (typesMatch(left, right, Type.number)) {
        return left * right;
      } else if (typesMatchCommutative(left, right, Type.string, Type.number)) {
        const str = typeOf(left) === Type.string ? left : right;
        const num = typeOf(left) === Type.number ? left : right;
        return repeatString(str, num);
      } else if (typesMatch(left, right, Type.object)) {
        return deepMerge(left, right);
      }
      {
        // Excel-style coercion: try numeric multiplication before failing
        const nums = coerceToNumbers(left, right);
        if (nums) return nums[0] * nums[1];
      }
      throw cannotApplyOperatorToError(op, left, right);
    case '/':
      if (typesMatch(left, right, Type.number)) {
        if (right === 0) return null;
        return left / right;
      } else if (typesMatch(left, right, Type.string)) {
        return left.split(right);
      }
      {
        // Excel-style coercion: try numeric division before failing
        const nums = coerceToNumbers(left, right);
        if (nums) {
          if (nums[1] === 0) return null;
          return nums[0] / nums[1];
        }
      }
      throw cannotApplyOperatorToError(op, left, right);
    case '%':
      if (typesMatch(left, right, Type.number)) {
        if (Math.floor(right) === 0) return null;
        return Math.floor(left) % Math.floor(right);
      }
      {
        // Excel-style coercion: try numeric modulo before failing
        const nums = coerceToNumbers(left, right);
        if (nums) {
          if (Math.floor(nums[1]) === 0) return null;
          return Math.floor(nums[0]) % Math.floor(nums[1]);
        }
      }
      throw cannotApplyOperatorToError(op, left, right);
    default:
      throw cannotApplyOperator(op);
  }
}

export function* evaluateSimpleAssignment(
  inputItem: Item,
  left: ItemIterator,
  right: ItemIterator
): ItemIterator {
  for (const [value, pathIterator] of nestedIterators(
    generateValues(right),
    generatePaths(left)
  )) {
    checkRuntimeBudget();
    let out = inputItem.value;
    for (const path of pathIterator) {
      checkRuntimeBudget();
      out = setPath(out, relativizePath(path, inputItem.path), deepClone(value));
    }
    yield createItem(out);
  }
}

export function* evaluateArithmeticUpdateAssignment(
  op: AssignmentOperator,
  inputItem: Item,
  left: ItemIterator,
  right: ItemIterator
): ItemIterator {
  for (const [value, pathIterator] of nestedIterators(
    generateValues(right),
    generatePaths(left)
  )) {
    checkRuntimeBudget();
    let out = inputItem.value;
    for (const path of pathIterator) {
      checkRuntimeBudget();
      const relativePath = relativizePath(path, inputItem.path);
      // Remove the '=' sign from the original arithmetic update-assignment operator
      const subOp: NormalBinaryOperator | AlternativeOperator = op.slice(
        0,
        -1
      ) as any;
      const originalValue = getPath(out, relativePath);

      out = setPath(
        out,
        relativePath,
        isBinaryOperatorType(subOp, BinaryOperatorType.alternative)
          ? applyAlternativeOperator(originalValue, value)
          : applyNormalBinaryOperator(subOp, originalValue, value)
      );
    }
    yield createItem(out);
  }
}

export function* evaluateBooleanOperator(
  op: BooleanBinaryOperator,
  left: ItemIterator,
  right: ItemIterator
): ItemIterator {
  if (op !== 'and' && op !== 'or') {
    throw new JqEvaluateError(
      `evaluateBooleanOperator: Unexpected operator '${op}'`
    );
  }

  let first = true;
  const memorizedRightItems: Item[] = [];
  for (const leftItem of left) {
    checkRuntimeBudget();
    const rightItems = first ? right : memorizedRightItems;
    if (op === 'and' && !isTrue(leftItem.value)) {
      yield createItem(false);
      continue;
    } else if (op === 'or' && isTrue(leftItem.value)) {
      yield createItem(true);
      continue;
    }

    for (const rightItem of rightItems) {
      checkRuntimeBudget();
      if (first) memorizedRightItems.push(rightItem);
      yield createItem(isTrue(rightItem.value));
    }
    first = false;
  }
}

export function* evaluateNormalBinaryOperator(
  op: NormalBinaryOperator,
  left: ItemIterator,
  right: ItemIterator
): ItemIterator {
  for (const [rightItem, leftItem] of combineIterators(right, left)) {
    checkRuntimeBudget();
    yield createItem(
      applyNormalBinaryOperator(op, leftItem.value, rightItem.value)
    );
  }
}

function applyAlternativeOperator(left: any, right: any) {
  return isTrue(left) ? left : right;
}

export function* evaluateAlternativeOperator(
  left: ItemIterator,
  right: ItemIterator
): ItemIterator {
  let hasResults = false;
  for (const leftItem of left) {
    checkRuntimeBudget();
    if (isTrue(leftItem.value)) {
      yield leftItem;
      hasResults = true;
    }
  }

  if (!hasResults) {
    yield* right;
  }
}
