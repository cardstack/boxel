import {
  AlternativeOperator,
  AssignmentOperator,
  BinaryOperator,
  BooleanBinaryOperator,
  CommaOperator,
  DestructuringAlternativeOperator,
  NormalBinaryOperator,
  PipeOperator,
} from '../../parser/AST.js';

export enum BinaryOperatorType {
  normal,
  assignment,
  boolean,
  pipe,
  comma,
  alternative,
  destructuringAlternative,
}

type OperatorTypeMapping<T extends BinaryOperatorType> =
  T extends BinaryOperatorType.normal
    ? NormalBinaryOperator
    : T extends BinaryOperatorType.assignment
    ? AssignmentOperator
    : T extends BinaryOperatorType.boolean
    ? BooleanBinaryOperator
    : T extends BinaryOperatorType.pipe
    ? PipeOperator
    : T extends BinaryOperatorType.comma
    ? CommaOperator
    : T extends BinaryOperatorType.alternative
    ? AlternativeOperator
    : T extends BinaryOperatorType.destructuringAlternative
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
  type: T
): op is OperatorTypeMapping<T> {
  return typeOfBinaryOperator(op) === type;
}
