import type {
  ArrayAst,
  BinaryAst,
  BreakAst,
  DefAst,
  ExpressionAst,
  FilterAst,
  ForeachAst,
  FormatAst,
  IfAst,
  IndexAst,
  IteratorAst,
  LabelAst,
  ObjectAst,
  ProgAst,
  ReduceAst,
  SliceAst,
  StrAst,
  TryAst,
  UnaryAst,
  VarAst,
  VarDeclarationAst,
} from '../../jqtools/parser/AST.js';
import {
  parseNativeJq,
  type NativeDialectOptions,
} from '../bridge/native.js';
import type { ReadableSyntaxWarning } from '../compiler/readable-syntax.js';
import { classifyBxlProfileFunction } from '../profiles/function-safety.js';

export type BxlProfile =
  | 'compute'
  | 'policy'
  | 'predicate'
  | 'derive';

export type BxlAttachment =
  | 'formula'
  | 'constraint'
  | 'visibleWhen'
  | 'queryTransform'
  | 'readAccess'
  | 'fieldAccess'
  | 'fieldTransform'
  | 'writeAccess'
  | 'unknown';

export interface BxlAstOptions extends NativeDialectOptions {
  profile?: BxlProfile;
  attachment?: BxlAttachment;
}

export interface NativeParsedForBxlAst {
  ast: ProgAst;
  source: string;
  compiledSource: string;
  readableWarnings: ReadableSyntaxWarning[];
}

export interface BxlAstProgram {
  type: 'program';
  source: string;
  canonicalSource: string;
  warnings: ReadableSyntaxWarning[];
  body: BxlAstNode | null;
  profile?: BxlProfile;
  attachment?: BxlAttachment;
  profileIssues: BxlProfileIssue[];
}

export type BxlAstNode =
  | BxlLiteralNode
  | BxlPathNode
  | BxlContextPathNode
  | BxlVariableNode
  | BxlCallNode
  | BxlBinaryNode
  | BxlUnaryNode
  | BxlIfNode
  | BxlArrayNode
  | BxlObjectNode
  | BxlIndexNode
  | BxlSliceNode
  | BxlIteratorNode
  | BxlDefNode
  | BxlTryNode
  | BxlReduceNode
  | BxlForeachNode
  | BxlBindingNode
  | BxlLabelNode
  | BxlBreakNode
  | BxlFormatNode
  | BxlRecursiveDescentNode;

export type BxlLiteralNode =
  | { type: 'literal'; value: string; valueType: 'string'; interpolated?: false }
  | { type: 'literal'; value: number; valueType: 'number' }
  | { type: 'literal'; value: boolean; valueType: 'boolean' }
  | { type: 'literal'; value: null; valueType: 'null' }
  | {
      type: 'literal';
      valueType: 'interpolated-string';
      parts: (string | BxlAstNode)[];
    };

export type BxlPathRoot = 'current';

export type BxlContextRoot =
  | '@User'
  | '@Env'
  | '$new'
  | '$old'
  | 'Record'
  | (string & {});

export type BxlPathPart =
  | { type: 'field'; key: string }
  | { type: 'index'; value: number }
  | { type: 'dynamic-index'; expr: BxlAstNode }
  | { type: 'iterator' }
  | { type: 'slice'; from?: BxlAstNode; to?: BxlAstNode };

export interface BxlPathNode {
  type: 'path';
  root: BxlPathRoot;
  parts: BxlPathPart[];
}

export interface BxlContextPathNode {
  type: 'contextPath';
  root: BxlContextRoot;
  parts: BxlPathPart[];
}

export interface BxlVariableNode {
  type: 'variable';
  name: string;
}

export interface BxlCallNode {
  type: 'call';
  name: string;
  arity: number;
  args: BxlAstNode[];
}

export interface BxlBinaryNode {
  type: 'binary';
  operator: string;
  left: BxlAstNode;
  right: BxlAstNode;
}

export interface BxlUnaryNode {
  type: 'unary';
  operator: string;
  expr: BxlAstNode;
}

export interface BxlIfNode {
  type: 'if';
  cond: BxlAstNode;
  then: BxlAstNode;
  elifs: { cond: BxlAstNode; then: BxlAstNode }[];
  else?: BxlAstNode;
}

export interface BxlArrayNode {
  type: 'array';
  expr?: BxlAstNode;
}

export interface BxlObjectNode {
  type: 'object';
  entries: Array<
    | { key: string; value?: never }
    | { key: string | BxlAstNode; value: BxlAstNode }
  >;
}

export interface BxlIndexNode {
  type: 'index';
  expr: BxlAstNode;
  index: string | BxlAstNode;
}

export interface BxlSliceNode {
  type: 'slice';
  expr: BxlAstNode;
  from?: BxlAstNode;
  to?: BxlAstNode;
}

export interface BxlIteratorNode {
  type: 'iterator';
  expr: BxlAstNode;
}

export interface BxlDefNode {
  type: 'def';
  name: string;
  args: { type: 'var' | 'filter'; name: string }[];
  body: BxlAstNode;
  next?: BxlAstNode;
}

export interface BxlTryNode {
  type: 'try';
  short: boolean;
  body: BxlAstNode;
  catch?: BxlAstNode;
}

export interface BxlReduceNode {
  type: 'reduce';
  expr: BxlAstNode;
  variable: string;
  init: BxlAstNode;
  update: BxlAstNode;
}

export interface BxlForeachNode {
  type: 'foreach';
  expr: BxlAstNode;
  variable: string;
  init: BxlAstNode;
  update: BxlAstNode;
  extract?: BxlAstNode;
}

export interface BxlBindingNode {
  type: 'binding';
  expr: BxlAstNode;
  names: string[];
  next: BxlAstNode;
}

export interface BxlLabelNode {
  type: 'label';
  value: string;
  next: BxlAstNode;
}

export interface BxlBreakNode {
  type: 'break';
  value: string;
}

export interface BxlFormatNode {
  type: 'format';
  name: string;
}

export interface BxlRecursiveDescentNode {
  type: 'recursiveDescent';
}

export interface BxlProfileIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  nodeType?: string;
}

export interface BxlProfileValidationOptions {
  profile: BxlProfile;
  attachment?: BxlAttachment;
}

const ASSIGNMENT_OPERATORS = new Set([
  '=',
  '|=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '//=',
]);

export function parseBxlAst(
  source: string,
  options: BxlAstOptions = {},
): BxlAstProgram {
  const parsed = parseNativeJq(source, options);
  return bxlAstProgramFromNativeParsed(parsed, options);
}

export function bxlAstProgramFromNativeParsed(
  parsed: NativeParsedForBxlAst,
  options: BxlAstOptions = {},
): BxlAstProgram {
  const program: BxlAstProgram = {
    type: 'program',
    source: parsed.source,
    canonicalSource: parsed.compiledSource,
    warnings: parsed.readableWarnings,
    body: parsed.ast.expr ? fromJqExpression(parsed.ast.expr) : null,
    profile: options.profile,
    attachment: options.attachment,
    profileIssues: [],
  };

  if (options.profile) {
    program.profileIssues = validateBxlAst(program, {
      profile: options.profile,
      attachment: options.attachment,
    });
  }

  return program;
}

export function validateBxlAst(
  program: BxlAstProgram | BxlAstNode,
  options: BxlProfileValidationOptions,
): BxlProfileIssue[] {
  const issues: BxlProfileIssue[] = [];
  const root = program.type === 'program' ? program.body : program;
  if (!root) {
    return issues;
  }

  visitBxlAstWithParent(root, undefined, (node, parent) => {
    if (options.profile !== 'compute') {
      validateSandboxProfileNode(node, options.profile, issues);
    }

    if (options.profile === 'policy') {
      validatePolicyNode(node, issues);
    }

    if (options.profile === 'predicate') {
      validatePredicateNode(node, parent, issues);
    }

    if (options.profile === 'derive') {
      validateDeriveNode(node, parent, issues);
    }
  });

  return issues;
}

export function assertValidBxlProfile(
  program: BxlAstProgram | BxlAstNode,
  options: BxlProfileValidationOptions,
): void {
  const issues = validateBxlAst(program, options).filter(
    (issue) => issue.severity === 'error',
  );
  if (issues.length > 0) {
    throw new Error(
      issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'),
    );
  }
}

export function visitBxlAst(
  node: BxlAstNode,
  visitor: (node: BxlAstNode) => void,
): void {
  visitor(node);
  for (const child of childNodes(node)) {
    visitBxlAst(child, visitor);
  }
}

function visitBxlAstWithParent(
  node: BxlAstNode,
  parent: BxlAstNode | undefined,
  visitor: (node: BxlAstNode, parent: BxlAstNode | undefined) => void,
): void {
  visitor(node, parent);
  for (const child of childNodes(node)) {
    visitBxlAstWithParent(child, node, visitor);
  }
}

function validateSandboxProfileNode(
  node: BxlAstNode,
  profile: BxlProfile,
  issues: BxlProfileIssue[],
) {
  if (node.type === 'def') {
    issues.push({
      code: `${profile}-def-banned`,
      severity: 'error',
      message: `${profileMessagePrefix(profile)} does not allow user-defined helpers.`,
      nodeType: node.type,
    });
  }

  // `reduce` and `foreach` are banned in `policy` and `predicate` because
  // those profiles must reduce to bounded request-time decisions / portable
  // query predicates — folds with arbitrary bodies fall outside that
  // contract. `derive` allows them: the actual derivation hazards
  // (non-determinism, env coupling, volatile calls) are addressed by
  // their own bans, and a deterministic fold over a record-local array is
  // structurally identical to library aggregates like `add`, `min/0`, and
  // `max/0` (which are themselves reduces under the hood). Termination is
  // bounded by the BXL runtime budget.
  if (
    (node.type === 'reduce' || node.type === 'foreach') &&
    profile !== 'derive'
  ) {
    issues.push({
      code: `${profile}-loop-banned`,
      severity: 'error',
      message: `${profileMessagePrefix(profile)} does not allow explicit reduce/foreach loops.`,
      nodeType: node.type,
    });
  }

  if (node.type === 'recursiveDescent') {
    issues.push({
      code: `${profile}-recursive-descent-banned`,
      severity: 'error',
      message: `${profileMessagePrefix(profile)} does not allow recursive descent.`,
      nodeType: node.type,
    });
  }

  if (node.type === 'binary' && ASSIGNMENT_OPERATORS.has(node.operator)) {
    issues.push({
      code: `${profile}-assignment-banned`,
      severity: 'error',
      message: `${profileMessagePrefix(profile)} does not allow jq assignment operator ${node.operator}.`,
      nodeType: node.type,
    });
  }

  if (node.type === 'try' && !(profile === 'derive' && node.short)) {
    issues.push({
      code: `${profile}-try-banned`,
      severity: 'error',
      message: `${profileMessagePrefix(profile)} does not allow jq try/catch error masking.`,
      nodeType: node.type,
    });
  }

  if (node.type === 'label' || node.type === 'break') {
    issues.push({
      code: `${profile}-control-flow-banned`,
      severity: 'error',
      message: `${profileMessagePrefix(profile)} does not allow jq label/break control flow.`,
      nodeType: node.type,
    });
  }

  if (node.type === 'format') {
    issues.push({
      code: `${profile}-format-banned`,
      severity: 'error',
      message: `${profileMessagePrefix(profile)} does not allow jq format filters.`,
      nodeType: node.type,
    });
  }
}

function validatePolicyNode(node: BxlAstNode, issues: BxlProfileIssue[]) {
  if (node.type !== 'call') {
    return;
  }

  const decision = classifyBxlProfileFunction('policy', node.name);
  if (decision.safety === 'deny') {
    issues.push({
      code: decision.category === 'aggregate'
        ? 'policy-aggregate-banned'
        : 'policy-call-banned',
      severity: 'error',
      message: `Profile.policy is for bounded request-time authorization decisions and does not allow call ${node.name}${decision.message ? `: ${decision.message}` : ''}.`,
      nodeType: node.type,
    });
  }
}

function validatePredicateNode(
  node: BxlAstNode,
  parent: BxlAstNode | undefined,
  issues: BxlProfileIssue[],
) {
  if (node.type === 'binding') {
    issues.push({
      code: 'predicate-binding-banned',
      severity: 'error',
      message: 'Profile.predicate must compile to a query-time boolean predicate and cannot use local jq bindings.',
      nodeType: node.type,
    });
  }

  if (node.type === 'variable') {
    issues.push({
      code: 'predicate-variable-banned',
      severity: 'error',
      message: 'Profile.predicate must compile to a query-time boolean predicate and cannot use free jq variables.',
      nodeType: node.type,
    });
  }

  if (
    node.type === 'contextPath' &&
    (node.root === '$new' || node.root === '$old')
  ) {
    issues.push({
      code: 'predicate-state-context-banned',
      severity: 'error',
      message: `Profile.predicate must compile to a query-time boolean predicate and cannot use mutation state ${node.root}.`,
      nodeType: node.type,
    });
  }

  if (isDynamicPathNode(node)) {
    issues.push({
      code: 'predicate-dynamic-path-banned',
      severity: 'error',
      message: 'Profile.predicate must compile to a query-time boolean predicate and cannot use iterator, slice, or dynamic-index paths.',
      nodeType: node.type,
    });
  }

  if (
    node.type === 'call' &&
    classifyBxlProfileFunction('predicate', node.name).safety !== 'allow'
  ) {
    issues.push({
      code: 'predicate-call-banned',
      severity: 'error',
      message: `Profile.predicate must compile to a query-time boolean predicate and cannot use call ${node.name}.`,
      nodeType: node.type,
    });
  }

  if (
    node.type === 'binary' &&
    node.operator === ',' &&
    isArrayComma(parent)
  ) {
    return;
  }

  if (
    node.type === 'binary' &&
    node.operator === '|' &&
    isPredicatePipe(node)
  ) {
    return;
  }

  if (node.type === 'binary' && !isPredicateOperator(node.operator)) {
    issues.push({
      code: 'predicate-operator-banned',
      severity: 'error',
      message: `Profile.predicate must compile to a query-time boolean predicate and cannot use operator ${node.operator}.`,
      nodeType: node.type,
    });
  }
}

function validateDeriveNode(
  node: BxlAstNode,
  _parent: BxlAstNode | undefined,
  issues: BxlProfileIssue[],
) {
  if (node.type === 'contextPath') {
    issues.push({
      code: 'derive-context-banned',
      severity: 'error',
      message: `Profile.derive is for deterministic write/index-time computation and cannot use request or environment context ${node.root}.`,
      nodeType: node.type,
    });
  }

  if (node.type === 'call') {
    const decision = classifyBxlProfileFunction('derive', node.name);
    if (decision.safety === 'deny') {
      issues.push({
        code: 'derive-call-banned',
        severity: 'error',
        message: `Profile.derive is for deterministic write/index-time computation and cannot use call ${node.name}${decision.message ? `: ${decision.message}` : ''}.`,
        nodeType: node.type,
      });
    }
  }
}

function isArrayComma(parent: BxlAstNode | undefined): boolean {
  return parent?.type === 'array' ||
    (parent?.type === 'binary' && parent.operator === ',');
}

function isPredicatePipe(node: BxlBinaryNode): boolean {
  return (
    node.right.type === 'call' &&
    (
      (['IN', 'overlaps'].includes(node.right.name) &&
        node.right.args.length === 1) ||
      (node.right.name === 'not' && node.right.args.length === 0)
    )
  );
}

function profileMessagePrefix(profile: BxlProfile): string {
  switch (profile) {
    case 'compute':
      return 'Profile.compute';
    case 'policy':
      return 'Profile.policy is for bounded request-time authorization decisions and';
    case 'predicate':
      return 'Profile.predicate must compile to a query-time boolean predicate and';
    case 'derive':
      return 'Profile.derive is for deterministic write/index-time computation and';
  }
}

function isPredicateOperator(operator: string): boolean {
  return [
    '+',
    '-',
    '*',
    '/',
    '%',
    'and',
    'or',
    '==',
    '!=',
    '<',
    '<=',
    '>',
    '>=',
    '//',
  ].includes(operator);
}

function isDynamicPathNode(node: BxlAstNode): boolean {
  return (
    (node.type === 'path' || node.type === 'contextPath') &&
    node.parts.some((part) =>
      part.type === 'iterator' ||
      part.type === 'slice' ||
      part.type === 'dynamic-index'
    )
  );
}

function fromJqExpression(node: ExpressionAst): BxlAstNode {
  const path = pathFromJq(node);
  if (path) {
    return path;
  }

  switch (node.type) {
    case 'str':
      return fromJqString(node);
    case 'num':
      return { type: 'literal', value: node.value, valueType: 'number' };
    case 'bool':
      return { type: 'literal', value: node.value, valueType: 'boolean' };
    case 'null':
      return { type: 'literal', value: null, valueType: 'null' };
    case 'filter':
      return fromJqFilter(node);
    case 'binary':
      return fromJqBinary(node);
    case 'unary':
      return fromJqUnary(node);
    case 'if':
      return fromJqIf(node);
    case 'array':
      return fromJqArray(node);
    case 'object':
      return fromJqObject(node);
    case 'def':
      return fromJqDef(node);
    case 'try':
      return fromJqTry(node);
    case 'reduce':
      return fromJqReduce(node);
    case 'foreach':
      return fromJqForeach(node);
    case 'varDeclaration':
      return fromJqVarDeclaration(node);
    case 'label':
      return fromJqLabel(node);
    case 'break':
      return fromJqBreak(node);
    case 'format':
      return fromJqFormat(node);
    case 'recursiveDescent':
      return { type: 'recursiveDescent' };
    case 'var':
      return { type: 'variable', name: node.name };
    case 'identity':
      return { type: 'path', root: 'current', parts: [] };
    case 'index':
      return {
        type: 'index',
        expr: fromJqExpression(node.expr),
        index:
          typeof node.index === 'string'
            ? node.index
            : fromJqExpression(node.index),
      };
    case 'slice':
      return {
        type: 'slice',
        expr: fromJqExpression(node.expr),
        from: node.from ? fromJqExpression(node.from) : undefined,
        to: node.to ? fromJqExpression(node.to) : undefined,
      };
    case 'iterator':
      return {
        type: 'iterator',
        expr: fromJqExpression(node.expr),
      };
  }
}

function fromJqString(node: StrAst): BxlLiteralNode {
  if (node.interpolated) {
    return {
      type: 'literal',
      valueType: 'interpolated-string',
      parts: node.parts.map((part) =>
        typeof part === 'string' ? part : fromJqExpression(part),
      ),
    };
  }

  return {
    type: 'literal',
    value: node.value,
    valueType: 'string',
    interpolated: false,
  };
}

function fromJqFilter(node: FilterAst): BxlCallNode {
  const { name, arity } = splitFilterName(node.name);
  return {
    type: 'call',
    name,
    arity,
    args: node.args.map(fromJqExpression),
  };
}

function fromJqBinary(node: BinaryAst): BxlBinaryNode {
  return {
    type: 'binary',
    operator: node.operator,
    left: fromJqExpression(node.left),
    right: fromJqExpression(node.right),
  };
}

function fromJqUnary(node: UnaryAst): BxlUnaryNode {
  return {
    type: 'unary',
    operator: node.operator,
    expr: fromJqExpression(node.expr),
  };
}

function fromJqIf(node: IfAst): BxlIfNode {
  return {
    type: 'if',
    cond: fromJqExpression(node.cond),
    then: fromJqExpression(node.then),
    elifs: (node.elifs ?? []).map((branch) => ({
      cond: fromJqExpression(branch.cond),
      then: fromJqExpression(branch.then),
    })),
    else: node.else ? fromJqExpression(node.else) : undefined,
  };
}

function fromJqArray(node: ArrayAst): BxlArrayNode {
  return {
    type: 'array',
    expr: node.expr ? fromJqExpression(node.expr) : undefined,
  };
}

function fromJqObject(node: ObjectAst): BxlObjectNode {
  return {
    type: 'object',
    entries: node.entries.map((entry) => {
      if (entry.value !== undefined) {
        return {
          key: typeof entry.key === 'string' ? entry.key : fromJqExpression(entry.key),
          value: fromJqExpression(entry.value),
        };
      }
      return { key: entry.key };
    }),
  };
}

function fromJqDef(node: DefAst): BxlDefNode {
  return {
    type: 'def',
    name: node.name,
    args: node.args.map((arg) => ({
      type: arg.type === 'filterArg' ? 'filter' : 'var',
      name: arg.name,
    })),
    body: fromJqExpression(node.body),
    next: node.next ? fromJqExpression(node.next) : undefined,
  };
}

function fromJqTry(node: TryAst): BxlTryNode {
  return {
    type: 'try',
    short: node.short,
    body: fromJqExpression(node.body),
    catch: node.catch ? fromJqExpression(node.catch) : undefined,
  };
}

function fromJqReduce(node: ReduceAst): BxlReduceNode {
  return {
    type: 'reduce',
    expr: fromJqExpression(node.expr),
    variable: node.var,
    init: fromJqExpression(node.init),
    update: fromJqExpression(node.update),
  };
}

function fromJqForeach(node: ForeachAst): BxlForeachNode {
  return {
    type: 'foreach',
    expr: fromJqExpression(node.expr),
    variable: node.var,
    init: fromJqExpression(node.init),
    update: fromJqExpression(node.update),
    extract: node.extract ? fromJqExpression(node.extract) : undefined,
  };
}

function fromJqVarDeclaration(node: VarDeclarationAst): BxlBindingNode {
  return {
    type: 'binding',
    expr: fromJqExpression(node.expr),
    names: node.destructuring.flatMap(destructuringNames),
    next: fromJqExpression(node.next),
  };
}

function fromJqLabel(node: LabelAst): BxlLabelNode {
  return {
    type: 'label',
    value: node.value,
    next: fromJqExpression(node.next),
  };
}

function fromJqBreak(node: BreakAst): BxlBreakNode {
  return {
    type: 'break',
    value: node.value,
  };
}

function fromJqFormat(node: FormatAst): BxlFormatNode {
  return {
    type: 'format',
    name: node.name,
  };
}

function pathFromJq(node: ExpressionAst): BxlPathNode | BxlContextPathNode | undefined {
  const parts: BxlPathPart[] = [];
  let current: ExpressionAst = node;

  while (true) {
    if (current.type === 'index') {
      parts.unshift(indexPart(current));
      current = current.expr;
      continue;
    }

    if (current.type === 'iterator') {
      parts.unshift({ type: 'iterator' });
      current = current.expr;
      continue;
    }

    if (current.type === 'slice') {
      parts.unshift({
        type: 'slice',
        from: current.from ? fromJqExpression(current.from) : undefined,
        to: current.to ? fromJqExpression(current.to) : undefined,
      });
      current = current.expr;
      continue;
    }

    break;
  }

  if (current.type === 'identity') {
    return {
      type: 'path',
      root: 'current',
      parts,
    };
  }

  if (current.type === 'var') {
    if (isContextRoot(current.name)) {
      return {
        type: 'contextPath',
        root: current.name,
        parts,
      };
    }

    if (parts.length === 0) {
      return undefined;
    }
  }

  if (current.type === 'format' && isContextRoot(current.name)) {
    return {
      type: 'contextPath',
      root: current.name,
      parts,
    };
  }

  if (current.type === 'filter') {
    const { name, arity } = splitFilterName(current.name);
    if (arity === 0 && isContextRoot(name)) {
      return {
        type: 'contextPath',
        root: name,
        parts,
      };
    }
  }

  return undefined;
}

function indexPart(node: IndexAst): BxlPathPart {
  if (typeof node.index === 'string') {
    return { type: 'field', key: node.index };
  }

  if (node.index.type === 'num') {
    return { type: 'index', value: node.index.value };
  }

  return {
    type: 'dynamic-index',
    expr: fromJqExpression(node.index),
  };
}

function isContextRoot(value: string): value is BxlContextRoot {
  return (
    value === '@User' ||
    value === '@Env' ||
    value === '$new' ||
    value === '$old' ||
    value === 'Record'
  );
}

function splitFilterName(name: string): { name: string; arity: number } {
  const slash = name.lastIndexOf('/');
  if (slash === -1) {
    return { name, arity: 0 };
  }
  return {
    name: name.slice(0, slash),
    arity: Number(name.slice(slash + 1)),
  };
}

function destructuringNames(
  destructuring: VarDeclarationAst['destructuring'][number],
): string[] {
  if (destructuring.type === 'var') {
    return [destructuring.name];
  }

  if (destructuring.type === 'arrayDestructuring') {
    return destructuring.destructuring.flatMap(destructuringNames);
  }

  return destructuring.entries.flatMap((entry) => {
    if (entry.destructuring !== undefined) {
      return destructuringNames(entry.destructuring);
    }
    return entry.key.type === 'var' ? [entry.key.name] : [];
  });
}

function childNodes(node: BxlAstNode): BxlAstNode[] {
  switch (node.type) {
    case 'literal':
      return node.valueType === 'interpolated-string'
        ? node.parts.filter((part): part is BxlAstNode => typeof part !== 'string')
        : [];
    case 'path':
    case 'contextPath':
      return node.parts.flatMap(pathPartChildren);
    case 'variable':
    case 'format':
    case 'break':
    case 'recursiveDescent':
      return [];
    case 'call':
      return node.args;
    case 'binary':
      return [node.left, node.right];
    case 'unary':
      return [node.expr];
    case 'if':
      return [
        node.cond,
        node.then,
        ...node.elifs.flatMap((branch) => [branch.cond, branch.then]),
        ...(node.else ? [node.else] : []),
      ];
    case 'array':
      return node.expr ? [node.expr] : [];
    case 'object':
      return node.entries.flatMap((entry) => {
        if (entry.value === undefined) {
          return [];
        }
        const children: BxlAstNode[] = [
          ...(typeof entry.key === 'string' ? [] : [entry.key]),
          entry.value,
        ];
        return children;
      });
    case 'index':
      return [
        node.expr,
        ...(typeof node.index === 'string' ? [] : [node.index]),
      ];
    case 'slice':
      return [
        node.expr,
        ...(node.from ? [node.from] : []),
        ...(node.to ? [node.to] : []),
      ];
    case 'iterator':
      return [node.expr];
    case 'def':
      return [node.body, ...(node.next ? [node.next] : [])];
    case 'try':
      return [node.body, ...(node.catch ? [node.catch] : [])];
    case 'reduce':
      return [node.expr, node.init, node.update];
    case 'foreach':
      return [
        node.expr,
        node.init,
        node.update,
        ...(node.extract ? [node.extract] : []),
      ];
    case 'binding':
      return [node.expr, node.next];
    case 'label':
      return [node.next];
  }
}

function pathPartChildren(part: BxlPathPart): BxlAstNode[] {
  switch (part.type) {
    case 'dynamic-index':
      return [part.expr];
    case 'slice':
      return [
        ...(part.from ? [part.from] : []),
        ...(part.to ? [part.to] : []),
      ];
    default:
      return [];
  }
}

export type { ProgAst as NativeJqAst };
