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
import type {
  BxlMutationField,
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

const CALL_ARITIES: Record<MutationCallName, number> = {
  assert: 2,
  replace: 2,
  copy_value_to: 2,
  del: 1,
  prepend: 2,
  append: 2,
  insert_at: 3,
  insert_item_before: 2,
  insert_item_after: 2,
  move_item_before: 2,
  move_item_after: 2,
  move_item_to_start: 2,
  move_item_to_end: 2,
  reorder_by: 3,
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

export function printMutationAst(node: ExpressionAst): string {
  switch (node.type) {
    case 'identity':
      return '.';
    case 'num':
    case 'bool':
      return String(node.value);
    case 'null':
      return 'null';
    case 'str':
      if (node.interpolated) {
        throw new Error(
          'Interpolated strings are not supported in mutation canonicalization.',
        );
      }
      return quoted(node.value);
    case 'unary':
      return `${node.operator}${printMutationAst(node.expr)}`;
    case 'binary':
      return `${printMutationAst(node.left)}${node.operator}${printMutationAst(node.right)}`;
    case 'index': {
      const base = printMutationAst(node.expr);
      if (typeof node.index === 'string') {
        const suffix = /^[A-Za-z_][A-Za-z0-9_]*$/.test(node.index)
          ? `.${node.index}`
          : `[${quoted(node.index)}]`;
        return node.expr.type === 'identity' ? suffix : `${base}${suffix}`;
      }
      return `${base}[${printMutationAst(node.index)}]`;
    }
    case 'iterator':
      return `${printMutationAst(node.expr)}[]`;
    case 'slice':
      return `${printMutationAst(node.expr)}[${node.from ? printMutationAst(node.from) : ''}:${node.to ? printMutationAst(node.to) : ''}]`;
    case 'filter':
      return `${node.name.split('/')[0]}(${node.args.map(printMutationAst).join(';')})`;
    case 'array':
      return `[${node.expr ? printMutationAst(node.expr) : ''}]`;
    case 'object':
      return `{${node.entries
        .map((entry) => {
          const key =
            typeof entry.key === 'string'
              ? entry.key
              : printMutationAst(entry.key);
          return entry.value === undefined
            ? key
            : `${/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : quoted(key)}:${printMutationAst(entry.value)}`;
        })
        .join(',')}}`;
    case 'if':
      return `if ${printMutationAst(node.cond)} then ${printMutationAst(node.then)}${node.else ? ` else ${printMutationAst(node.else)}` : ''} end`;
    case 'try':
      return `try ${printMutationAst(node.body)}${node.catch ? ` catch ${printMutationAst(node.catch)}` : ''}`;
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
      return `${printMutationAst(node.expr)}as${node.destructuring[0].name}|${printMutationAst(node.next)}`;
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
    },
    warnings: parsed.warnings,
  };
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
      const canonicalOperator = assignment.operator === '=' ? '=' : '|=';
      let canonicalValue = value.argument.canonical;
      if (assignment.operator !== '=' && assignment.operator !== '|=') {
        canonicalValue = `.${assignment.operator.slice(0, -1)}${canonicalValue}`;
      }
      statements.push({
        kind: 'assignment',
        statement: statementNumber,
        source: statementSource,
        canonical: `${location.argument.canonical}${canonicalOperator}${canonicalValue}`,
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
    if (
      rawArgs.length !== CALL_ARITIES[name] ||
      rawArgs.some((value) => value.length === 0)
    ) {
      throw new BxlMutationError(
        'parse',
        'call-arity',
        statementNumber,
        `${name} expects ${CALL_ARITIES[name]} arguments; received ${rawArgs.length}.`,
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
