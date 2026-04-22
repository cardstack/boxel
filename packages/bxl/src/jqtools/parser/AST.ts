export interface ProgAst {
  type: 'root';
  expr?: ExpressionAst;
}

export type ArgAst = VarArgAst | FilterArgAst;

export type ExpressionAst = BinaryAst | AtomAst;

export type AtomAst =
  | DefAst
  | IdentityAst
  | NumAst
  | StrAst
  | BoolAst
  | NullAst
  | FormatAst
  | FilterAst
  | IfAst
  | TryAst
  | ReduceAst
  | VarAst
  | VarDeclarationAst
  | ForeachAst
  | LabelAst
  | BreakAst
  | UnaryAst
  | IndexAst
  | SliceAst
  | IteratorAst
  | ArrayAst
  | ObjectAst
  | RecursiveDescentAst;

export interface DefAst {
  type: 'def';
  name: string;
  args: ArgAst[];
  body: ExpressionAst;
  next?: ExpressionAst;
}

export interface FilterArgAst {
  type: 'filterArg';
  name: string;
}

export interface VarArgAst {
  type: 'varArg';
  name: string;
}

export interface IdentityAst {
  type: 'identity';
}

export interface NumAst {
  type: 'num';
  value: number;
}

export type StrAst = SimpleStrAst | InterpolatedStrAst;

export interface SimpleStrAst {
  type: 'str';
  interpolated: false;
  value: string;
  format?: FormatAst;
}

export interface InterpolatedStrAst {
  type: 'str';
  interpolated: true;
  parts: (string | ExpressionAst)[];
  format?: FormatAst;
}

export interface BoolAst {
  type: 'bool';
  value: boolean;
}

export interface NullAst {
  type: 'null';
  value: null;
}

export interface FormatAst {
  type: 'format';
  name: string;
}

export interface FilterAst {
  type: 'filter';
  name: string;
  args: ExpressionAst[];
}

export interface IfAst {
  type: 'if';
  cond: ExpressionAst;
  then: ExpressionAst;
  elifs?: { cond: ExpressionAst; then: ExpressionAst }[];
  else?: ExpressionAst;
}

export interface TryAst {
  type: 'try';
  body: ExpressionAst;
  short: boolean;
  catch?: ExpressionAst;
}

export interface LabelAst {
  type: 'label';
  value: string;
  next: ExpressionAst;
}

export interface BreakAst {
  type: 'break';
  value: string;
}

export interface ReduceAst {
  type: 'reduce';
  expr: ExpressionAst;
  var: string;
  init: ExpressionAst;
  update: ExpressionAst;
}

export interface ForeachAst {
  type: 'foreach';
  expr: ExpressionAst;
  var: string;
  init: ExpressionAst;
  update: ExpressionAst;
  extract?: ExpressionAst;
}

export type NormalBinaryOperator =
  | '=='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | '+'
  | '-'
  | '*'
  | '/'
  | '%';
export type AssignmentOperator =
  | '='
  | '|='
  | '+='
  | '-='
  | '*='
  | '/='
  | '%='
  | '//=';
export type BooleanBinaryOperator = 'or' | 'and';
export type PipeOperator = '|';
export type CommaOperator = ',';
export type AlternativeOperator = '//';
export type DestructuringAlternativeOperator = '?//';
export type BinaryOperator =
  | NormalBinaryOperator
  | AssignmentOperator
  | BooleanBinaryOperator
  | PipeOperator
  | CommaOperator
  | AlternativeOperator
  | DestructuringAlternativeOperator;

export interface BinaryAst {
  type: 'binary';
  operator: BinaryOperator;
  left: ExpressionAst;
  right: ExpressionAst;
}

export type UnaryOperator = '-';

export interface UnaryAst {
  type: 'unary';
  operator: UnaryOperator;
  expr: ExpressionAst;
}

export interface IndexAst {
  type: 'index';
  expr: ExpressionAst;
  index: string | ExpressionAst;
}

export interface SliceAst {
  type: 'slice';
  expr: ExpressionAst;
  from?: ExpressionAst;
  to?: ExpressionAst;
}

export interface IteratorAst {
  type: 'iterator';
  expr: ExpressionAst;
}

export interface ArrayAst {
  type: 'array';
  expr?: ExpressionAst;
}

export type ObjectEntryAst =
  | { key: string; value?: never }
  | { key: ExpressionAst | string; value: ExpressionAst };
export interface ObjectAst {
  type: 'object';
  entries: ObjectEntryAst[];
}

export interface VarAst {
  type: 'var';
  name: string;
}

export interface VarDeclarationAst {
  type: 'varDeclaration';
  expr: ExpressionAst;
  destructuring: DestructuringAst[];
  next: ExpressionAst;
}

export type DestructuringAst =
  | VarAst
  | ArrayDestructuringAst
  | ObjectDestructuringAst;

export interface ArrayDestructuringAst {
  type: 'arrayDestructuring';
  destructuring: DestructuringAst[];
}

export type ObjectDestructuringEntryAst =
  | { key: VarAst; destructuring?: never }
  | { key: ExpressionAst | string; destructuring: DestructuringAst };

export interface ObjectDestructuringAst {
  type: 'objectDestructuring';
  entries: ObjectDestructuringEntryAst[];
}

export interface RecursiveDescentAst {
  type: 'recursiveDescent';
}
