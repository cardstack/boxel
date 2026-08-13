import type {
  AlternativeOperator,
  AssignmentOperator,
  BinaryOperator,
  BooleanBinaryOperator,
  CommaOperator,
  DestructuringAlternativeOperator,
  NormalBinaryOperator,
  PipeOperator,
} from '../../parser/AST.ts';

export const BinaryOperatorType = {
  normal: 'normal',
  assignment: 'assignment',
  boolean: 'boolean',
  pipe: 'pipe',
  comma: 'comma',
  alternative: 'alternative',
  destructuringAlternative: 'destructuringAlternative',
} as const;

export type BinaryOperatorType =
  (typeof BinaryOperatorType)[keyof typeof BinaryOperatorType];

type OperatorTypeMapping<T extends BinaryOperatorType> =
  T extends typeof BinaryOperatorType.normal
    ? NormalBinaryOperator
    : T extends typeof BinaryOperatorType.assignment
      ? AssignmentOperator
      : T extends typeof BinaryOperatorType.boolean
        ? BooleanBinaryOperator
        : T extends typeof BinaryOperatorType.pipe
          ? PipeOperator
          : T extends typeof BinaryOperatorType.comma
            ? CommaOperator
            : T extends typeof BinaryOperatorType.alternative
              ? AlternativeOperator
              : T extends typeof BinaryOperatorType.destructuringAlternative
                ? DestructuringAlternativeOperator
                : never;

const operatorMapping: Record<BinaryOperator, BinaryOperatorType> = {
  '|': BinaryOperatorType.pipe,
  ',': BinaryOperatorType.comma,
  '//': BinaryOperatorType.alternative,
  '=': BinaryOperatorType.assignment,
  '|=': BinaryOperatorType.assignment,
  '+=': BinaryOperatorType.assignment,
  '-=': BinaryOperatorType.assignment,
  '*=': BinaryOperatorType.assignment,
  '/=': BinaryOperatorType.assignment,
  '%=': BinaryOperatorType.assignment,
  '//=': BinaryOperatorType.assignment,
  or: BinaryOperatorType.boolean,
  and: BinaryOperatorType.boolean,
  '==': BinaryOperatorType.normal,
  '!=': BinaryOperatorType.normal,
  '<': BinaryOperatorType.normal,
  '>': BinaryOperatorType.normal,
  '<=': BinaryOperatorType.normal,
  '>=': BinaryOperatorType.normal,
  '+': BinaryOperatorType.normal,
  '-': BinaryOperatorType.normal,
  '*': BinaryOperatorType.normal,
  '/': BinaryOperatorType.normal,
  '%': BinaryOperatorType.normal,
  '?//': BinaryOperatorType.destructuringAlternative,
};

export function typeOfBinaryOperator(op: BinaryOperator): BinaryOperatorType {
  return operatorMapping[op];
}

export function isBinaryOperatorType<T extends BinaryOperatorType>(
  op: BinaryOperator,
  type: T,
): op is OperatorTypeMapping<T> {
  return typeOfBinaryOperator(op) === type;
}
