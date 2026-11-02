import { parseNativeJq } from '../bxl/bridge/native.ts';
import { parseBxlAst, visitBxlAst } from '../bxl/ast/index.ts';
import {
  compileReadableSyntax,
  type ReadableSyntaxWarning,
} from '../bxl/compiler/readable-syntax.ts';
import type {
  ExpressionAst,
  FilterAst,
  IndexAst,
} from '../jqtools/parser/AST.ts';
import { Parser } from '../jqtools/parser/Parser.ts';
import type {
  BxlMutationField,
  BxlMutationPath,
  BxlMutationPrepareOptions,
  BxlMutationSchema,
} from './types.ts';
import { BxlMutationError } from './types.ts';

export type MutationAssignmentOperator =
  | '='
  | '|='
  | '+='
  | '-='
  | '*='
  | '/='
  | '%='
  | '//=';

export interface ParsedMutationArgument {
  source: string;
  ast: ExpressionAst;
  canonical: string;
  bulk: boolean;
  explicitIndex: boolean;
  /**
   * The Card paths this argument reads, relative to the value it is evaluated
   * against. A location argument has them too: choosing a write set is a read
   * of the document, and a selector's predicate is as much a read as anything
   * in a value expression.
   */
  readPaths: BxlMutationPath[];
}

export type ParsedMutationStatement =
  | {
      kind: 'assignment';
      statement: number;
      source: string;
      canonical: string;
      operator: MutationAssignmentOperator;
      location: ParsedMutationArgument;
      value: ParsedMutationArgument;
    }
  | {
      kind: 'call';
      statement: number;
      source: string;
      canonical: string;
      name: MutationCallName;
      args: ParsedMutationArgument[];
    };

export type MutationCallName =
  | 'assert'
  | 'replace'
  | 'copy_value_to'
  | 'del'
  | 'prepend'
  | 'append'
  | 'insert_at'
  | 'insert_item_before'
  | 'insert_item_after'
  | 'move_item_before'
  | 'move_item_after'
  | 'move_item_to_start'
  | 'move_item_to_end'
  | 'reorder_by';

/**
 * The argument counts each structural call accepts. `assert` accepts a third
 * argument, an option record; every other call has one fixed arity. Keep this
 * in step with `MutationCallName` and `LOCATION_ARGUMENTS`.
 */
const CALL_ARITIES: Record<MutationCallName, readonly number[]> = {
  assert: [2, 3],
  replace: [2],
  copy_value_to: [2],
  del: [1],
  prepend: [2],
  append: [2],
  insert_at: [3],
  insert_item_before: [2],
  insert_item_after: [2],
  move_item_before: [2],
  move_item_after: [2],
  move_item_to_start: [2],
  move_item_to_end: [2],
  reorder_by: [3],
};

const LOCATION_ARGUMENTS: Record<MutationCallName, ReadonlySet<number>> = {
  assert: new Set(),
  replace: new Set([0]),
  copy_value_to: new Set([0, 1]),
  del: new Set([0]),
  prepend: new Set([0]),
  append: new Set([0]),
  insert_at: new Set([0]),
  insert_item_before: new Set([1]),
  insert_item_after: new Set([1]),
  move_item_before: new Set([0, 1]),
  move_item_after: new Set([0, 1]),
  move_item_to_start: new Set([0, 1]),
  move_item_to_end: new Set([0, 1]),
  reorder_by: new Set([0, 1]),
};

interface ScannedCharacterState {
  depth: number;
  quote: '"' | "'" | null;
  escaped: boolean;
}

function nextScanState(
  source: string,
  index: number,
  state: ScannedCharacterState,
): ScannedCharacterState {
  const character = source[index]!;
  if (state.quote !== null) {
    if (state.escaped) return { ...state, escaped: false };
    if (character === '\\') return { ...state, escaped: true };
    if (character === state.quote) return { ...state, quote: null };
    return state;
  }
  if (character === '"' || character === "'") {
    return { ...state, quote: character };
  }
  if (character === '(' || character === '[' || character === '{') {
    return { ...state, depth: state.depth + 1 };
  }
  if (character === ')' || character === ']' || character === '}') {
    return { ...state, depth: state.depth - 1 };
  }
  return state;
}

export function frameBxlMutationStatements(source: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let state: ScannedCharacterState = { depth: 0, quote: null, escaped: false };
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (character === ';' && state.quote === null && state.depth === 0) {
      const statement = source.slice(start, index).trim();
      if (statement.length === 0) {
        throw new BxlMutationError(
          'parse',
          'empty-statement',
          statements.length + 1,
          'Mutation programs cannot contain empty statements.',
        );
      }
      statements.push(statement);
      start = index + 1;
      continue;
    }
    state = nextScanState(source, index, state);
    if (state.depth < 0) {
      throw new BxlMutationError(
        'parse',
        'unbalanced-delimiter',
        statements.length + 1,
        'Mutation source contains an unmatched closing delimiter.',
      );
    }
  }
  if (state.quote !== null || state.depth !== 0) {
    throw new BxlMutationError(
      'parse',
      'stream-incomplete',
      statements.length + 1,
      'Mutation source ends inside a string or delimited expression.',
    );
  }
  if (source.slice(start).trim().length > 0) {
    throw new BxlMutationError(
      'parse',
      'stream-incomplete',
      statements.length + 1,
      'Every mutation statement must end with a semicolon.',
    );
  }
  if (statements.length === 0) {
    throw new BxlMutationError(
      'parse',
      'program-empty',
      1,
      'A mutation program must contain at least one complete statement.',
    );
  }
  return statements;
}

export interface BxlMutationStatementStreamOptions {
  maxBufferedCharacters?: number;
  maxStatements?: number;
}

/** Stateful semicolon framer for token/chunk streaming. It never emits a partial statement. */
export class BxlMutationStatementStream {
  private buffer = '';
  private cursor = 0;
  private emitted = 0;
  private state: ScannedCharacterState = {
    depth: 0,
    quote: null,
    escaped: false,
  };
  private readonly maxBufferedCharacters: number;
  private readonly maxStatements: number;

  constructor(options: BxlMutationStatementStreamOptions = {}) {
    this.maxBufferedCharacters = options.maxBufferedCharacters ?? 1_000_000;
    this.maxStatements = options.maxStatements ?? 1_000;
  }

  push(chunk: string): string[] {
    this.buffer += chunk;
    const complete: string[] = [];
    let consumed = 0;
    for (let index = this.cursor; index < this.buffer.length; index++) {
      const character = this.buffer[index]!;
      if (
        character === ';' &&
        this.state.quote === null &&
        this.state.depth === 0
      ) {
        const statement = this.buffer.slice(consumed, index + 1).trim();
        if (statement !== ';') {
          complete.push(statement);
          this.emitted++;
          if (this.emitted > this.maxStatements) {
            throw new BxlMutationError(
              'parse',
              'statement-limit',
              this.emitted,
              `Mutation stream exceeds its ${this.maxStatements}-statement limit.`,
            );
          }
        } else {
          throw new BxlMutationError(
            'parse',
            'empty-statement',
            this.emitted + 1,
            'Mutation streams cannot contain empty statements.',
          );
        }
        consumed = index + 1;
        continue;
      }
      this.state = nextScanState(this.buffer, index, this.state);
      if (this.state.depth < 0) {
        throw new BxlMutationError(
          'parse',
          'unbalanced-delimiter',
          this.emitted + 1,
          'Mutation stream contains an unmatched closing delimiter.',
        );
      }
    }
    if (consumed > 0) {
      this.buffer = this.buffer.slice(consumed);
      this.cursor = this.buffer.length;
    } else {
      this.cursor = this.buffer.length;
    }
    if (this.buffer.length > this.maxBufferedCharacters) {
      throw new BxlMutationError(
        'parse',
        'statement-size-limit',
        this.emitted + 1,
        `Incomplete mutation statement exceeds ${this.maxBufferedCharacters} buffered characters.`,
      );
    }
    return complete;
  }

  finish(): void {
    if (
      this.buffer.trim().length > 0 ||
      this.state.quote !== null ||
      this.state.depth !== 0
    ) {
      throw new BxlMutationError(
        'parse',
        'stream-incomplete',
        this.emitted + 1,
        'Mutation stream ended before its final statement terminator.',
      );
    }
  }
}

export function createBxlMutationStatementStream(
  options: BxlMutationStatementStreamOptions = {},
): BxlMutationStatementStream {
  return new BxlMutationStatementStream(options);
}

function splitTopLevel(source: string, separator: ',' | ';'): string[] {
  const parts: string[] = [];
  let start = 0;
  let state: ScannedCharacterState = { depth: 0, quote: null, escaped: false };
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (character === separator && state.quote === null && state.depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
      continue;
    }
    state = nextScanState(source, index, state);
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function findTopLevelAssignment(source: string):
  | {
      index: number;
      operator: MutationAssignmentOperator;
    }
  | undefined {
  const operators: MutationAssignmentOperator[] = [
    '//=',
    '|=',
    '+=',
    '-=',
    '*=',
    '/=',
    '%=',
    '=',
  ];
  let state: ScannedCharacterState = { depth: 0, quote: null, escaped: false };
  for (let index = 0; index < source.length; index++) {
    if (state.quote === null && state.depth === 0) {
      for (const operator of operators) {
        if (!source.startsWith(operator, index)) continue;
        if (operator === '=') {
          const previous = source[index - 1];
          const next = source[index + 1];
          if (
            previous === '=' ||
            previous === '!' ||
            previous === '<' ||
            previous === '>' ||
            next === '='
          ) {
            continue;
          }
        }
        return { index, operator };
      }
    }
    state = nextScanState(source, index, state);
  }
  return undefined;
}

function parseOuterCall(
  source: string,
): { name: string; body: string } | undefined {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(source);
  if (!match) return undefined;
  const open = source.indexOf('(', match[1]!.length);
  let state: ScannedCharacterState = { depth: 0, quote: null, escaped: false };
  let close = -1;
  for (let index = open; index < source.length; index++) {
    state = nextScanState(source, index, state);
    if (state.depth === 0 && state.quote === null) {
      close = index;
      break;
    }
  }
  if (close < 0 || source.slice(close + 1).trim().length > 0) return undefined;
  return { name: match[1]!, body: source.slice(open + 1, close) };
}

function insertExplicitBulkDots(source: string): string {
  let output = '';
  let state: ScannedCharacterState = { depth: 0, quote: null, escaped: false };
  for (let index = 0; index < source.length; index++) {
    if (
      state.quote === null &&
      source[index] === '[' &&
      source[index + 1] === '*'
    ) {
      output += '[*';
      index += 1;
      while (/\s/.test(source[index + 1] ?? '')) {
        output += source[++index]!;
      }
      const next = source[index + 1];
      if (next && next !== '.' && next !== ']') output += '.';
      continue;
    }
    output += source[index]!;
    state = nextScanState(source, index, state);
  }
  return output;
}

function solidifiedBulkLocation(source: string): string {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let open = -1;
  for (let index = 0; index < source.length - 1; index++) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '[' && source[index + 1] === '*') {
      open = index;
      break;
    }
  }
  if (open < 0) return source;
  quote = null;
  escaped = false;
  let depth = 1;
  let close = -1;
  for (let index = open + 2; index < source.length; index++) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '[') depth++;
    else if (character === ']' && --depth === 0) {
      close = index;
      break;
    }
  }
  if (close < 0) return source;
  const base = source.slice(0, open).trim();
  const predicate = source.slice(open + 2, close).trim();
  const suffix = source.slice(close + 1).trim();
  return `${base}[]|select(${predicate})${suffix ? `|${suffix}` : ''}`;
}

const SYNTHETIC_FIELD_ROOT = '__bxlMutationRoot';

function readableMutationSchema(options: BxlMutationPrepareOptions) {
  if (options.targetKind !== 'field' || !options.schema.rootField?.label) {
    return options.schema;
  }
  const root = options.schema.rootField;
  return {
    fields: [
      ...options.schema.fields,
      {
        key: SYNTHETIC_FIELD_ROOT,
        label: root.label,
        kind:
          root.fieldType === 'containsMany' || root.fieldType === 'linksToMany'
            ? ('array' as const)
            : root.item
              ? ('object' as const)
              : ('scalar' as const),
        item: root.item ?? { fields: options.schema.fields },
      },
    ],
  };
}

interface MutationAstSchemaResult {
  field?: BxlMutationField;
  schema?: BxlMutationSchema;
  item?: BxlMutationSchema;
}

function schemaField(
  schema: BxlMutationSchema | undefined,
  key: string,
): BxlMutationField | undefined {
  return schema?.fields.find((field) => field.key === key);
}

/** Follow only the value-producing spine of a compiled location AST. */
function schemaResultForLocation(
  node: ExpressionAst,
  input: BxlMutationSchema | undefined,
): MutationAstSchemaResult {
  switch (node.type) {
    case 'identity':
      return { schema: input };
    case 'index': {
      if (typeof node.index !== 'string') return {};
      const base = schemaResultForLocation(node.expr, input);
      const field = schemaField(base.schema, node.index);
      if (!field) return {};
      return {
        field,
        schema: field.fields ? { fields: field.fields } : undefined,
        item: field.item,
      };
    }
    case 'iterator': {
      const base = schemaResultForLocation(node.expr, input);
      return { schema: base.item };
    }
    case 'binary':
      if (node.operator === '|') {
        const left = schemaResultForLocation(node.left, input);
        return schemaResultForLocation(node.right, left.schema ?? left.item);
      }
      return {};
    case 'filter':
      if (node.name === 'select/1') return { schema: input };
      if (node.name === 'first/1' && node.args[0]) {
        return schemaResultForLocation(node.args[0], input);
      }
      return {};
    case 'array':
      return node.expr ? schemaResultForLocation(node.expr, input) : {};
    default:
      return {};
  }
}

function isFirstCall(node: ExpressionAst): node is FilterAst {
  return (
    node.type === 'filter' && node.name === 'first/1' && node.args.length === 1
  );
}

function identityIndex(index: IndexAst['index']): IndexAst {
  return {
    type: 'index',
    expr: { type: 'identity' },
    index,
    ...(typeof index === 'string' ? { staticPath: [index] } : {}),
  };
}

/** Preserve all mutation locations that readable value mode would collapse with first(). */
function normalizeLocationAst(node: ExpressionAst): ExpressionAst {
  if (node.type === 'array' && node.expr) {
    return normalizeLocationAst(node.expr);
  }
  if (isFirstCall(node)) {
    return normalizeLocationAst(node.args[0]!);
  }
  if (node.type === 'index') {
    if (isFirstCall(node.expr)) {
      return {
        type: 'binary',
        operator: '|',
        left: node.expr.args[0]!,
        right: identityIndex(node.index),
      };
    }
    return { ...node, expr: normalizeLocationAst(node.expr) };
  }
  if (node.type === 'iterator') {
    return { ...node, expr: normalizeLocationAst(node.expr) };
  }
  if (node.type === 'binary' && node.operator === '|') {
    return {
      ...node,
      left: normalizeLocationAst(node.left),
      right: normalizeLocationAst(node.right),
    };
  }
  return node;
}

function stripSyntheticFieldRoot(node: ExpressionAst): ExpressionAst {
  if (
    node.type === 'index' &&
    node.expr.type === 'identity' &&
    node.index === SYNTHETIC_FIELD_ROOT
  ) {
    return { type: 'identity' };
  }
  if (node.type === 'index') {
    return { ...node, expr: stripSyntheticFieldRoot(node.expr) };
  }
  if (node.type === 'iterator') {
    return { ...node, expr: stripSyntheticFieldRoot(node.expr) };
  }
  if (node.type === 'slice') {
    return { ...node, expr: stripSyntheticFieldRoot(node.expr) };
  }
  if (node.type === 'binary') {
    return {
      ...node,
      left: stripSyntheticFieldRoot(node.left),
      right: stripSyntheticFieldRoot(node.right),
    };
  }
  if (node.type === 'filter') {
    return { ...node, args: node.args.map(stripSyntheticFieldRoot) };
  }
  if (node.type === 'array' && node.expr) {
    return { ...node, expr: stripSyntheticFieldRoot(node.expr) };
  }
  return node;
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

const IDENTIFIER_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Nodes whose syntax runs to the end of the enclosing expression: `E as $x |
 * body`, `try body catch handler` and `label $l | body` each take everything
 * after them. Anywhere but the end of a delimited context they need
 * parentheses, or they swallow the operators that follow.
 */
function isOpenEnded(node: ExpressionAst): boolean {
  return (
    node.type === 'varDeclaration' ||
    node.type === 'label' ||
    node.type === 'def' ||
    (node.type === 'try' && !node.short)
  );
}

/**
 * Nodes that may take a postfix (`.k`, `[i]`, `[]`, `[a:b]`, `?`) or stand as
 * the term of `as`, `reduce` and `foreach` without parentheses — the parser's
 * `atomMaybe` chain. Anything else is wrapped.
 */
function isPostfixTerm(node: ExpressionAst): boolean {
  switch (node.type) {
    case 'identity':
    case 'var':
    case 'filter':
    case 'index':
    case 'slice':
    case 'iterator':
    case 'array':
    case 'object':
      return true;
    case 'try':
      return node.short;
    default:
      return false;
  }
}

function parenthesize(source: string): string {
  return `(${source})`;
}

function printPostfixTerm(node: ExpressionAst): string {
  const printed = printMutationAst(node);
  return isPostfixTerm(node) ? printed : parenthesize(printed);
}

function binaryPrecedence(operator: string): number {
  return Parser.getPrecedence(operator);
}

/**
 * One operand of a binary operator. The parser left-associates a chain of
 * equal precedence, so a right operand at the parent's precedence was
 * parenthesized in the source and has to stay so; an operand of lower
 * precedence always does. A binary the author parenthesized keeps its
 * parentheses, so the printed program re-parses to the same tree, grouping
 * flags included.
 */
function printBinaryOperand(
  node: ExpressionAst,
  parentOperator: string,
  side: 'left' | 'right',
): string {
  const printed = printMutationAst(node);
  if (node.type === 'binary') {
    const parent = binaryPrecedence(parentOperator);
    const child = binaryPrecedence(node.operator);
    const needsGroup =
      node.parenthesized ||
      child < parent ||
      (side === 'right' && child === parent);
    return needsGroup ? parenthesize(printed) : printed;
  }
  return isOpenEnded(node) ? parenthesize(printed) : printed;
}

function printBinary(node: Extract<ExpressionAst, { type: 'binary' }>): string {
  let left = printBinaryOperand(node.left, node.operator, 'left');
  const right = printBinaryOperand(node.right, node.operator, 'right');
  if (node.operator === 'and' || node.operator === 'or') {
    // Keyword operators need whitespace, or `.n==$n and .at` runs together
    // into `$nand` and `.at` reads as part of it.
    return `${left} ${node.operator} ${right}`;
  }
  // Symbolic operators stay unspaced, as canonical text always has been. The
  // one adjacency that tokenizes differently is a trailing `?` before `//`,
  // which reads as the destructuring operator `?//`.
  if (left.endsWith('?')) {
    left = `${left} `;
  }
  return `${left}${node.operator}${right}`;
}

/**
 * A value inside an object literal. The parser reads it up to the next
 * top-level comma, so a comma expression, or an open-ended form that would
 * run past the comma, is wrapped.
 */
function printObjectValue(node: ExpressionAst): string {
  const printed = printMutationAst(node);
  return (node.type === 'binary' && node.operator === ',') || isOpenEnded(node)
    ? parenthesize(printed)
    : printed;
}

function printObjectKey(key: string | ExpressionAst): string {
  if (typeof key === 'string') {
    return IDENTIFIER_KEY.test(key) ? key : quoted(key);
  }
  if (key.type === 'str' && !key.interpolated && !key.format) {
    return quoted(key.value);
  }
  return parenthesize(printMutationAst(key));
}

function printStringLiteral(
  node: Extract<ExpressionAst, { type: 'str' }>,
): string {
  if (node.interpolated) {
    throw new Error(
      'Interpolated strings are not supported in mutation canonicalization.',
    );
  }
  return node.format
    ? `${node.format.name} ${quoted(node.value)}`
    : quoted(node.value);
}

/**
 * Print a parsed mutation expression as canonical jq text that parses back to
 * the same tree. Spacing is minimal — only keywords are separated — and
 * parentheses appear where precedence, associativity or an open-ended form
 * requires them, or where the author wrote them around a binary.
 */
export function printMutationAst(node: ExpressionAst): string {
  switch (node.type) {
    case 'identity':
      return '.';
    case 'recursiveDescent':
      return '..';
    case 'num':
    case 'bool':
      return String(node.value);
    case 'null':
      return 'null';
    case 'str':
      return printStringLiteral(node);
    case 'format':
      return node.name;
    case 'unary': {
      const operand = printMutationAst(node.expr);
      const grouped =
        node.expr.type === 'binary' ||
        node.expr.type === 'unary' ||
        isOpenEnded(node.expr) ||
        operand.startsWith('-');
      return `${node.operator}${grouped ? parenthesize(operand) : operand}`;
    }
    case 'binary':
      return printBinary(node);
    case 'index': {
      if (typeof node.index === 'string') {
        if (IDENTIFIER_KEY.test(node.index)) {
          return node.expr.type === 'identity'
            ? `.${node.index}`
            : `${printPostfixTerm(node.expr)}.${node.index}`;
        }
        return `${printPostfixTerm(node.expr)}[${quoted(node.index)}]`;
      }
      return `${printPostfixTerm(node.expr)}[${printMutationAst(node.index)}]`;
    }
    case 'iterator':
      return `${printPostfixTerm(node.expr)}[]`;
    case 'slice':
      return `${printPostfixTerm(node.expr)}[${node.from ? printMutationAst(node.from) : ''}:${node.to ? printMutationAst(node.to) : ''}]`;
    case 'filter':
      // A zero-arity call keeps its empty parentheses — `actor()`, `not()` —
      // which parse to the same `name/0`, so canonical text already stored by
      // lowering reads the same.
      return `${node.name.split('/')[0]}(${node.args.map(printMutationAst).join(';')})`;
    case 'array':
      return `[${node.expr ? printMutationAst(node.expr) : ''}]`;
    case 'object':
      return `{${node.entries
        .map((entry) =>
          entry.value === undefined
            ? printObjectKey(entry.key)
            : `${printObjectKey(entry.key)}:${printObjectValue(entry.value)}`,
        )
        .join(',')}}`;
    case 'if':
      return `if ${printMutationAst(node.cond)} then ${printMutationAst(node.then)}${(
        node.elifs ?? []
      )
        .map(
          (elif) =>
            ` elif ${printMutationAst(elif.cond)} then ${printMutationAst(elif.then)}`,
        )
        .join(
          '',
        )}${node.else ? ` else ${printMutationAst(node.else)}` : ''} end`;
    case 'try': {
      if (node.short) {
        return `${printPostfixTerm(node.body)}?`;
      }
      // The body runs up to `catch`; a nested try in it would claim that
      // `catch` for itself.
      const body = printMutationAst(node.body);
      const groupedBody =
        node.catch && isOpenEnded(node.body) ? parenthesize(body) : body;
      return `try ${groupedBody}${node.catch ? ` catch ${printMutationAst(node.catch)}` : ''}`;
    }
    case 'reduce':
      return `reduce ${printPostfixTerm(node.expr)} as ${node.var}(${printMutationAst(node.init)};${printMutationAst(node.update)})`;
    case 'foreach':
      return `foreach ${printPostfixTerm(node.expr)} as ${node.var}(${printMutationAst(node.init)};${printMutationAst(node.update)}${node.extract ? `;${printMutationAst(node.extract)}` : ''})`;
    case 'var':
      return node.name;
    case 'varDeclaration':
      if (
        node.destructuring.length !== 1 ||
        node.destructuring[0]?.type !== 'var'
      ) {
        throw new Error(
          'Complex bindings are not supported in mutation canonicalization.',
        );
      }
      return `${printPostfixTerm(node.expr)} as ${node.destructuring[0].name}|${printMutationAst(node.next)}`;
    default:
      throw new Error(`Unsupported mutation expression node ${node.type}.`);
  }
}

function parseExpression(
  source: string,
  options: BxlMutationPrepareOptions,
  statement: number,
  location: boolean,
): {
  ast: ExpressionAst;
  canonical: string;
  warnings: ReadableSyntaxWarning[];
} {
  let candidate = source.trim();
  if (location) {
    candidate = insertExplicitBulkDots(candidate);
  }
  const schema = readableMutationSchema(options);
  try {
    const compiled =
      options.syntax === 'solidified'
        ? { source: candidate, warnings: [] as ReadableSyntaxWarning[] }
        : compileReadableSyntax(candidate, { schema });
    // Solidified filter-all is profile syntax rather than ordinary jq. Pass it
    // through the readable path compiler only when that marker is present.
    const normalized =
      options.syntax === 'solidified' && location && candidate.includes('[*')
        ? {
            source: solidifiedBulkLocation(candidate),
            warnings: [] as ReadableSyntaxWarning[],
          }
        : compiled;
    const parsed = parseNativeJq(normalized.source, { readableSyntax: false });
    if (!parsed.ast.expr) {
      throw new Error('Expression is empty.');
    }
    const withoutSyntheticRoot = stripSyntheticFieldRoot(parsed.ast.expr);
    const ast = location
      ? normalizeLocationAst(withoutSyntheticRoot)
      : withoutSyntheticRoot;
    const profile = parseBxlAst(printMutationAst(ast), {
      readableSyntax: false,
      profile: 'mutation',
    });
    const errors = profile.profileIssues.filter(
      (issue) => issue.severity === 'error',
    );
    if (errors.length > 0) {
      throw new Error(
        errors.map((issue) => `${issue.code}: ${issue.message}`).join('\n'),
      );
    }
    if (profile.body) {
      let nestedAssignment: string | undefined;
      visitBxlAst(profile.body, (node) => {
        if (
          node.type === 'binary' &&
          ['=', '|=', '+=', '-=', '*=', '/=', '%=', '//='].includes(
            node.operator,
          )
        ) {
          nestedAssignment = node.operator;
        }
      });
      if (nestedAssignment) {
        throw new Error(
          `Mutation ${location ? 'locations' : 'value expressions'} cannot contain nested assignment ${nestedAssignment}.`,
        );
      }
    }
    return {
      ast,
      canonical: printMutationAst(ast),
      warnings: normalized.warnings,
    };
  } catch (error) {
    throw new BxlMutationError(
      'parse',
      location ? 'location-syntax' : 'expression-syntax',
      statement,
      `Cannot parse mutation ${location ? 'location' : 'expression'}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function argument(
  source: string,
  options: BxlMutationPrepareOptions,
  statement: number,
  location: boolean,
): { argument: ParsedMutationArgument; warnings: ReadableSyntaxWarning[] } {
  const parsed = parseExpression(source, options, statement, location);
  return {
    argument: {
      source: source.trim(),
      ast: parsed.ast,
      canonical: parsed.canonical,
      bulk: location && source.includes('[*'),
      explicitIndex: location && /\[\s*-?\d+\s*\]/.test(source),
      readPaths: collectMutationReadPaths(parsed.ast),
    },
    warnings: parsed.warnings,
  };
}

/**
 * Builtins whose arguments are evaluated against the same input as the call
 * itself, so a path written inside one addresses the same document. Every
 * other builtin may re-root its arguments — `map(.name)` reads a collection
 * item, not a Card Field — so the walk stops at the call instead of claiming
 * a path it cannot prove.
 */
const INPUT_PRESERVING_FILTERS: ReadonlySet<string> = new Set([
  'card/1',
  'has/1',
  'last/1',
  'not/0',
  'select/1',
]);

/**
 * `first(f)` stops at f's first output, so only the first branch of a comma
 * inside it is certain to run. Every other input-preserving builtin above
 * consumes its argument whole — `last/1` included, which has to reach the end
 * of the stream to know what the last value was.
 */
function firstOperand(node: ExpressionAst): ExpressionAst {
  return node.type === 'binary' && node.operator === ','
    ? firstOperand(node.left)
    : node;
}

const SHORT_CIRCUIT_OPERATORS: ReadonlySet<string> = new Set([
  '//',
  'and',
  'or',
]);

/**
 * `IF` and `IFS` evaluate everything after their first argument
 * conditionally — `IFS` lowers to a chain of `elif`, so even its later
 * conditions run only when every earlier one was false. Argument 0 is the only
 * part of either that runs on every pass.
 */
function isConditionalFilter(name: string): boolean {
  return name.startsWith('IF/') || name.startsWith('IFS/');
}

/** The path an index chain addresses, when every segment of it is static. */
function staticPathOf(node: ExpressionAst): BxlMutationPath | undefined {
  if (node.type === 'identity') return [];
  if (node.type !== 'index') return undefined;
  const base = staticPathOf(node.expr);
  if (!base) return undefined;
  if (typeof node.index === 'string') return [...base, node.index];
  if (node.index.type === 'num' && Number.isInteger(node.index.value)) {
    return [...base, node.index.value];
  }
  return undefined;
}

/**
 * The Card paths an expression reads, in source order and deduplicated.
 *
 * Only chains the walk can prove are reported: it follows operators and
 * structural literals, and follows a pipe into its right side only when the
 * left side is a static path it can prefix with. An iterator, a dynamic index,
 * or a re-rooting builtin argument ends the chain, and the longest provable
 * prefix stands in for what lies below — `.tags[].name` reports `tags`. Under-
 * reporting costs a telemetry event; over-reporting would refuse a program
 * over a path it never read.
 *
 * A sub-expression counts only when it is evaluated every time the containing
 * expression is. Anything conditional is skipped — `if`/`else`, a `try` body,
 * the right side of `//`, `and` or `or`, everything after the first argument
 * of `IF`/`IFS`, and the branches of a comma inside `first` — because a path
 * read only on the branch not taken must not refuse the program or report a
 * read that never happened.
 *
 * What the walk reports is therefore a lower bound, not the complete set. A
 * path reached through a variable binding, `reduce`/`foreach`, a computed key,
 * `getpath`, `..`, or any builtin outside the input-preserving set above is
 * not proven and not reported. Reads through those shapes see the same layered
 * values as any other read; they are simply not the ones the overlay guards
 * can speak about.
 *
 * The empty path is a read of the expression's own input, which is the Card
 * root for most expressions and the assigned location for the value side of
 * `|=`.
 */
export function collectMutationReadPaths(
  ast: ExpressionAst,
): BxlMutationPath[] {
  const paths: BxlMutationPath[] = [];
  const seen = new Set<string>();

  function record(path: BxlMutationPath): void {
    const key = JSON.stringify(path);
    if (seen.has(key)) return;
    seen.add(key);
    paths.push(path);
  }

  function walk(node: ExpressionAst, prefix: BxlMutationPath): void {
    const direct = staticPathOf(node);
    if (direct) {
      record([...prefix, ...direct]);
      return;
    }
    switch (node.type) {
      case 'index':
        walk(node.expr, prefix);
        if (typeof node.index !== 'string') walk(node.index, prefix);
        return;
      case 'iterator':
        walk(node.expr, prefix);
        return;
      case 'array':
        if (node.expr) walk(node.expr, prefix);
        return;
      case 'slice':
        walk(node.expr, prefix);
        if (node.from) walk(node.from, prefix);
        if (node.to) walk(node.to, prefix);
        return;
      case 'unary':
        walk(node.expr, prefix);
        return;
      case 'binary': {
        walk(node.left, prefix);
        if (node.operator === '|') {
          const left = staticPathOf(node.left);
          if (left) walk(node.right, [...prefix, ...left]);
          return;
        }
        // `//`, `and` and `or` reach their right side only when the left side
        // has not already decided the result.
        if (!SHORT_CIRCUIT_OPERATORS.has(node.operator)) {
          walk(node.right, prefix);
        }
        return;
      }
      case 'object':
        for (const entry of node.entries) {
          if (typeof entry.key !== 'string') walk(entry.key, prefix);
          if (entry.value) walk(entry.value, prefix);
        }
        return;
      case 'if':
        walk(node.cond, prefix);
        return;
      case 'try':
        return;
      case 'filter':
        if (isConditionalFilter(node.name)) {
          if (node.args[0]) walk(node.args[0], prefix);
        } else if (node.name === 'first/1' && node.args[0]) {
          walk(firstOperand(node.args[0]), prefix);
        } else if (INPUT_PRESERVING_FILTERS.has(node.name)) {
          for (const arg of node.args) walk(arg, prefix);
        }
        return;
      case 'str':
        if (node.interpolated) {
          for (const part of node.parts) {
            if (typeof part !== 'string') walk(part, prefix);
          }
        }
        return;
      default:
        return;
    }
  }

  walk(ast, []);
  return paths;
}

/**
 * `assert(condition; message; { snapshot: true })` marks an assert best-effort
 * against overlay values, which may lag the stored document. The option record
 * is read at planning time rather than evaluated, so it must be written as a
 * literal.
 */
export function readAssertSnapshotOption(
  argument: ParsedMutationArgument,
  statement: number,
): true {
  const { ast } = argument;
  const entry =
    ast.type === 'object' && ast.entries.length === 1
      ? ast.entries[0]
      : undefined;
  const value = entry?.value;
  // `{ snapshot: … }` and `{ "snapshot": … }` are the same record; a generated
  // program is as likely to quote the key as not.
  const key =
    typeof entry?.key === 'string'
      ? entry.key
      : entry?.key?.type === 'str' && !entry.key.interpolated
        ? entry.key.value
        : undefined;
  if (
    !entry ||
    key !== 'snapshot' ||
    value === undefined ||
    value.type !== 'bool' ||
    value.value !== true
  ) {
    throw new BxlMutationError(
      'parse',
      'assert-option-invalid',
      statement,
      'assert accepts one option record, written as the literal { snapshot: true }. Omit the option for an assert that requires stored values.',
    );
  }
  return true;
}

export function parseBxlMutationProgram(
  source: string,
  options: BxlMutationPrepareOptions,
): {
  statements: ParsedMutationStatement[];
  canonicalSource: string;
  warnings: ReadableSyntaxWarning[];
} {
  const framed = frameBxlMutationStatements(source);
  const statements: ParsedMutationStatement[] = [];
  const warnings: ReadableSyntaxWarning[] = [];

  for (let offset = 0; offset < framed.length; offset++) {
    const statementNumber = offset + 1;
    const statementSource = framed[offset]!;
    const assignment = findTopLevelAssignment(statementSource);
    if (assignment) {
      const left = statementSource.slice(0, assignment.index).trim();
      const right = statementSource
        .slice(assignment.index + assignment.operator.length)
        .trim();
      if (!left || !right) {
        throw new BxlMutationError(
          'parse',
          'assignment-incomplete',
          statementNumber,
          'Mutation assignment requires both a location and a value expression.',
        );
      }
      const location = argument(left, options, statementNumber, true);
      const value = argument(right, options, statementNumber, false);
      warnings.push(...location.warnings, ...value.warnings);
      // The operator is kept as written. Rewriting `.n += .x` as
      // `.n |= . + .x` would change the program: a compound assignment
      // evaluates its right-hand side against the whole document, as jq's
      // does, while `|=` evaluates it against the target.
      const canonicalValue = value.argument.canonical;
      statements.push({
        kind: 'assignment',
        statement: statementNumber,
        source: statementSource,
        canonical: `${location.argument.canonical}${assignment.operator}${canonicalValue}`,
        operator: assignment.operator,
        location: location.argument,
        value: value.argument,
      });
      continue;
    }

    const call = parseOuterCall(statementSource);
    if (!call || !(call.name in CALL_ARITIES)) {
      throw new BxlMutationError(
        'parse',
        'statement-not-allowed',
        statementNumber,
        'Mutation statements must be assignments or an approved structural function call.',
      );
    }
    const name = call.name as MutationCallName;
    const semicolonArgs = splitTopLevel(call.body, ';');
    const commaArgs = splitTopLevel(call.body, ',');
    const rawArgs = semicolonArgs.length > 1 ? semicolonArgs : commaArgs;
    const arities = CALL_ARITIES[name];
    if (
      !arities.includes(rawArgs.length) ||
      rawArgs.some((value) => value.length === 0)
    ) {
      throw new BxlMutationError(
        'parse',
        'call-arity',
        statementNumber,
        `${name} expects ${arities.join(' or ')} arguments; received ${rawArgs.length}.`,
      );
    }
    const args = rawArgs.map((raw, index) => {
      if (name === 'reorder_by' && index === 1) {
        const collection = argument(
          rawArgs[0]!,
          options,
          statementNumber,
          true,
        );
        const rootSchema = readableMutationSchema(options) as BxlMutationSchema;
        const collectionField = schemaResultForLocation(
          collection.argument.ast,
          rootSchema,
        ).field;
        const itemSchema =
          collectionField?.item ?? options.schema.rootField?.item;
        if (itemSchema) {
          return argument(
            raw,
            { ...options, schema: itemSchema, targetKind: 'card' },
            statementNumber,
            true,
          );
        }
      }
      return argument(
        raw,
        options,
        statementNumber,
        LOCATION_ARGUMENTS[name].has(index),
      );
    });
    warnings.push(...args.flatMap((entry) => entry.warnings));
    if (name === 'assert' && args.length === 3) {
      readAssertSnapshotOption(args[2]!.argument, statementNumber);
    }
    statements.push({
      kind: 'call',
      statement: statementNumber,
      source: statementSource,
      name,
      args: args.map((entry) => entry.argument),
      canonical: `${name}(${args.map((entry) => entry.argument.canonical).join(';')})`,
    });
  }

  return {
    statements,
    canonicalSource: statements
      .map((statement) => `${statement.canonical};`)
      .join('\n'),
    warnings,
  };
}
