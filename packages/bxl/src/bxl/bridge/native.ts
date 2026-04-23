import type {
  ArgAst,
  DefAst,
  DestructuringAst,
  ExpressionAst,
  ProgAst,
} from '../../jqtools/parser/AST.js';
import { InputStream } from '../../jqtools/parser/InputStream.js';
import { parse } from '../../jqtools/parser/Parser.js';
import { Tokenizer } from '../../jqtools/parser/Tokenizer.js';
import type { Token } from '../../jqtools/parser/Tokenizer.js';
import { evaluateWithRegistry } from '../../jqtools/evaluate/evaluate.js';
import {
  BuiltinLibraryName,
  DEFAULT_BUILTIN_LIBRARIES,
  resolveBuiltinRegistry,
  type ResolvedBuiltinRegistry,
} from '../registry/index.js';
import {
  NativeRuntimeLimits,
  recordRuntimeOutput,
  HaltSignal,
  withRuntimeDiagnostics,
} from '../../jqtools/evaluate/runtimeState.js';
import {
  compileReadableSyntax,
  ReadableSchema,
  ReadableSyntaxWarning,
} from '../compiler/readable-syntax.js';

export type NativeToken = Token;
export type AstNode = ProgAst;

export interface NativeDialectRun {
  tokens: NativeToken[];
  ast: AstNode;
  source: string;
  compiledSource: string;
  readableWarnings: ReadableSyntaxWarning[];
  outputs: unknown[];
  debugMessages: string[];
  stderr: string[];
  haltedExitCode?: number;
}

export interface PreparedNativeRunOptions {
  runtimeLimits?: NativeRuntimeLimits;
}

export interface PreparedNativeJq {
  tokens: NativeToken[];
  ast: AstNode;
  source: string;
  compiledSource: string;
  readableWarnings: ReadableSyntaxWarning[];
  deps: string[];
  run(input: unknown, options?: PreparedNativeRunOptions): NativeDialectRun;
}

export interface NativeDialectOptions {
  libraries?: BuiltinLibraryName[];
  schema?: ReadableSchema;
  readableSyntax?: boolean;
  runtimeLimits?: NativeRuntimeLimits;
}

interface ParsedNativeProgram {
  tokens: NativeToken[];
  ast: AstNode;
  source: string;
  compiledSource: string;
  readableWarnings: ReadableSyntaxWarning[];
}

export class NativeJqDialectError extends Error {
  constructor(
    public readonly phase: 'tokenize' | 'parse' | 'evaluate',
    message: string,
  ) {
    super(message);
    this.name = 'NativeJqDialectError';
  }
}

function wrapPhaseError(
  phase: 'tokenize' | 'parse' | 'evaluate',
  error: unknown,
): NativeJqDialectError {
  if (error instanceof NativeJqDialectError) {
    return error;
  }

  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);

  return new NativeJqDialectError(phase, message);
}

function compileProgram(program: string, options: NativeDialectOptions = {}) {
  if (options.readableSyntax === false) {
    return {
      source: program,
      changed: false,
      warnings: [],
    };
  }
  return compileReadableSyntax(program, { schema: options.schema });
}

export function tokenizeNativeJq(
  program: string,
  options: NativeDialectOptions = {},
): NativeToken[] {
  const compiled = compileProgram(program, options);
  try {
    return new Tokenizer(new InputStream(compiled.source)).toArray();
  } catch (error) {
    throw wrapPhaseError('tokenize', error);
  }
}

export function parseNativeJq(
  program: string,
  options: NativeDialectOptions = {},
): ParsedNativeProgram {
  const compiled = compileProgram(program, options);
  const tokens = tokenizeNativeJq(compiled.source, {
    ...options,
    readableSyntax: false,
  });
  try {
    return {
      tokens,
      ast: parse(compiled.source),
      source: program,
      compiledSource: compiled.source,
      readableWarnings: compiled.warnings,
    };
  } catch (error) {
    throw wrapPhaseError('parse', error);
  }
}

function runParsedNativeProgram(
  parsed: ParsedNativeProgram,
  input: unknown,
  registry: ResolvedBuiltinRegistry,
  runtimeLimits?: NativeRuntimeLimits,
): NativeDialectRun {
  const outputs: unknown[] = [];

  try {
    const runtime = withRuntimeDiagnostics(() => {
      for (const value of evaluateWithRegistry(parsed.ast, [input], registry)) {
        recordRuntimeOutput(value);
        outputs.push(value);
      }
    }, runtimeLimits);

    if (runtime.error && !(runtime.error instanceof HaltSignal)) {
      throw runtime.error;
    }

    return {
      tokens: parsed.tokens,
      ast: parsed.ast,
      source: parsed.source,
      compiledSource: parsed.compiledSource,
      readableWarnings: parsed.readableWarnings,
      outputs,
      debugMessages: runtime.diagnostics.debugMessages,
      stderr: runtime.diagnostics.stderr,
      haltedExitCode: runtime.diagnostics.haltedExitCode,
    };
  } catch (error) {
    throw wrapPhaseError('evaluate', error);
  }
}

export function runNativeJq(
  program: string,
  input: unknown,
  options: NativeDialectOptions = {},
): NativeDialectRun {
  const parsed = parseNativeJq(program, options);
  const registry = resolveBuiltinRegistry(
    options.libraries ?? DEFAULT_BUILTIN_LIBRARIES,
  );

  return runParsedNativeProgram(parsed, input, registry, options.runtimeLimits);
}

function stringLiteralValue(node: ExpressionAst | undefined): string | undefined {
  return node?.type === 'str' && !node.interpolated ? node.value : undefined;
}

function objectLiteralKeys(node: ExpressionAst | undefined): string[] {
  if (!node || node.type !== 'object') {
    return [];
  }

  return node.entries
    .map((entry) => (typeof entry.key === 'string' ? entry.key : undefined))
    .filter((entry): entry is string => Boolean(entry));
}

function collectExcelContribFilterDeps(
  node: Extract<ExpressionAst, { type: 'filter' }>,
  deps: Set<string>,
  scope: DependencyScope,
  currentOrigin: DependencyOrigin,
) {
  const addStringKeyFromArg = (rowsIndex: number, keyIndex: number) => {
    if (
      expressionOutputOrigin(node.args[rowsIndex], scope, currentOrigin) === 'root'
    ) {
      const key = stringLiteralValue(node.args[keyIndex]);
      if (key) {
        deps.add(key);
      }
    }
  };

  const addCriteriaObjectKeys = (criteriaIndex: number) => {
    if (
      expressionOutputOrigin(node.args[0], scope, currentOrigin) === 'root'
    ) {
      for (const key of objectLiteralKeys(node.args[criteriaIndex])) {
        deps.add(key);
      }
    }
  };

  switch (node.name) {
    case 'COL/2':
      addStringKeyFromArg(0, 1);
      return;
    case 'SUMIF_BY/4':
    case 'AVERAGEIF_BY/4':
      addStringKeyFromArg(0, 1);
      addStringKeyFromArg(0, 2);
      return;
    case 'COUNTIF_BY/3':
      addStringKeyFromArg(0, 1);
      return;
    case 'SUMIFS_BY/3':
    case 'AVERAGEIFS_BY/3':
      addStringKeyFromArg(0, 1);
      addCriteriaObjectKeys(2);
      return;
    case 'COUNTIFS_BY/2':
      addCriteriaObjectKeys(1);
      return;
    case 'LOOKUP_BY/4':
      addStringKeyFromArg(0, 1);
      addStringKeyFromArg(0, 3);
      return;
    case 'NPV_BY/3':
      addStringKeyFromArg(1, 2);
      return;
    case 'IRR_BY/2':
      addStringKeyFromArg(0, 1);
      return;
    case 'IRR_BY/3':
      addStringKeyFromArg(0, 1);
      return;
    case 'XNPV_BY/4':
      addStringKeyFromArg(1, 2);
      addStringKeyFromArg(1, 3);
      return;
    case 'XIRR_BY/3':
      addStringKeyFromArg(0, 1);
      addStringKeyFromArg(0, 2);
      return;
    case 'XIRR_BY/4':
      addStringKeyFromArg(0, 1);
      addStringKeyFromArg(0, 2);
      return;
    case 'VLOOKUP_BY/4':
    case 'VLOOKUP_BY/5':
      addStringKeyFromArg(0, 1);
      addStringKeyFromArg(0, 3);
      return;
  }
}

type DependencyOrigin = 'root' | 'derived' | 'unknown';

interface DependencyScope {
  defs: Map<string, DefAst>;
  vars: Map<string, DependencyOrigin>;
}

function extendDependencyScope(scope: DependencyScope): DependencyScope {
  return {
    defs: new Map(scope.defs),
    vars: new Map(scope.vars),
  };
}

function bindDefArgs(scope: DependencyScope, args: ArgAst[]) {
  for (const arg of args) {
    scope.vars.set(arg.name, 'derived');
  }
}

function bindDestructuringOrigins(
  scope: DependencyScope,
  destructurings: DestructuringAst[],
  origin: DependencyOrigin,
) {
  for (const destructuring of destructurings) {
    switch (destructuring.type) {
      case 'var':
        scope.vars.set(destructuring.name, origin);
        break;
      case 'arrayDestructuring':
        bindDestructuringOrigins(scope, destructuring.destructuring, 'derived');
        break;
      case 'objectDestructuring':
        for (const entry of destructuring.entries) {
          if (entry.destructuring) {
            bindDestructuringOrigins(scope, [entry.destructuring], 'derived');
          } else {
            scope.vars.set(entry.key.name, 'derived');
          }
        }
        break;
    }
  }
}

function collectDestructuringDeps(
  destructurings: DestructuringAst[],
  deps: Set<string>,
  scope: DependencyScope,
  origin: DependencyOrigin,
) {
  for (const destructuring of destructurings) {
    switch (destructuring.type) {
      case 'var':
        break;
      case 'arrayDestructuring':
        collectDestructuringDeps(destructuring.destructuring, deps, scope, 'derived');
        break;
      case 'objectDestructuring':
        for (const entry of destructuring.entries) {
          if (origin === 'root') {
            if (typeof entry.key === 'string') {
              deps.add(entry.key);
            } else if (entry.key.type === 'var' && !entry.destructuring) {
              deps.add(entry.key.name.replace(/^\$/, ''));
            } else {
              collectExpressionDeps(entry.key, deps, scope, origin);
            }
          } else if (typeof entry.key !== 'string' && entry.key.type !== 'var') {
            collectExpressionDeps(entry.key, deps, scope, origin);
          }

          if (entry.destructuring) {
            collectDestructuringDeps([entry.destructuring], deps, scope, 'derived');
          }
        }
        break;
    }
  }
}

function expressionOutputOrigin(
  node: ExpressionAst | undefined,
  scope: DependencyScope,
  currentOrigin: DependencyOrigin,
): DependencyOrigin {
  if (!node) return currentOrigin;

  switch (node.type) {
    case 'identity':
      return currentOrigin;
    case 'var':
      return scope.vars.get(node.name) ?? 'derived';
    case 'def': {
      const nextScope = extendDependencyScope(scope);
      nextScope.defs.set(node.name, node);
      return expressionOutputOrigin(node.next, nextScope, currentOrigin);
    }
    case 'varDeclaration': {
      const exprOrigin = expressionOutputOrigin(node.expr, scope, currentOrigin);
      const nextScope = extendDependencyScope(scope);
      bindDestructuringOrigins(nextScope, node.destructuring, exprOrigin);
      return expressionOutputOrigin(node.next, nextScope, currentOrigin);
    }
    case 'label':
      return expressionOutputOrigin(node.next, scope, currentOrigin);
    case 'try':
      return expressionOutputOrigin(node.body, scope, currentOrigin);
    case 'binary':
      if (node.operator === '|') {
        const leftOrigin = expressionOutputOrigin(node.left, scope, currentOrigin);
        return expressionOutputOrigin(node.right, scope, leftOrigin);
      }
      return 'derived';
    default:
      return 'derived';
  }
}

function collectExpressionDeps(
  node: ExpressionAst | undefined,
  deps: Set<string>,
  scope: DependencyScope,
  currentOrigin: DependencyOrigin,
) {
  if (!node) return;

  switch (node.type) {
    case 'binary':
      if (node.operator === '|') {
        collectExpressionDeps(node.left, deps, scope, currentOrigin);
        collectExpressionDeps(
          node.right,
          deps,
          scope,
          expressionOutputOrigin(node.left, scope, currentOrigin),
        );
        return;
      }
      collectExpressionDeps(node.left, deps, scope, currentOrigin);
      collectExpressionDeps(node.right, deps, scope, currentOrigin);
      return;
    case 'def': {
      const nextScope = extendDependencyScope(scope);
      nextScope.defs.set(node.name, node);
      collectExpressionDeps(node.next, deps, nextScope, currentOrigin);
      return;
    }
    case 'filter': {
      for (const arg of node.args) {
        collectExpressionDeps(arg, deps, scope, currentOrigin);
      }
      collectExcelContribFilterDeps(node, deps, scope, currentOrigin);
      const localDef = scope.defs.get(node.name);
      if (localDef) {
        const defScope = extendDependencyScope(scope);
        bindDefArgs(defScope, localDef.args);
        collectExpressionDeps(localDef.body, deps, defScope, currentOrigin);
      }
      return;
    }
    case 'if':
      collectExpressionDeps(node.cond, deps, scope, currentOrigin);
      collectExpressionDeps(node.then, deps, scope, currentOrigin);
      for (const branch of node.elifs ?? []) {
        collectExpressionDeps(branch.cond, deps, scope, currentOrigin);
        collectExpressionDeps(branch.then, deps, scope, currentOrigin);
      }
      collectExpressionDeps(node.else, deps, scope, currentOrigin);
      return;
    case 'try':
      collectExpressionDeps(node.body, deps, scope, currentOrigin);
      collectExpressionDeps(node.catch, deps, scope, currentOrigin);
      return;
    case 'reduce': {
      collectExpressionDeps(node.expr, deps, scope, currentOrigin);
      collectExpressionDeps(node.init, deps, scope, currentOrigin);
      const nextScope = extendDependencyScope(scope);
      nextScope.vars.set(node.var, 'derived');
      collectExpressionDeps(node.update, deps, nextScope, currentOrigin);
      return;
    }
    case 'foreach': {
      collectExpressionDeps(node.expr, deps, scope, currentOrigin);
      collectExpressionDeps(node.init, deps, scope, currentOrigin);
      const nextScope = extendDependencyScope(scope);
      nextScope.vars.set(node.var, 'derived');
      collectExpressionDeps(node.update, deps, nextScope, currentOrigin);
      collectExpressionDeps(node.extract, deps, nextScope, currentOrigin);
      return;
    }
    case 'varDeclaration': {
      collectExpressionDeps(node.expr, deps, scope, currentOrigin);
      const exprOrigin = expressionOutputOrigin(node.expr, scope, currentOrigin);
      collectDestructuringDeps(node.destructuring, deps, scope, exprOrigin);
      const nextScope = extendDependencyScope(scope);
      bindDestructuringOrigins(nextScope, node.destructuring, exprOrigin);
      collectExpressionDeps(node.next, deps, nextScope, currentOrigin);
      return;
    }
    case 'label':
      collectExpressionDeps(node.next, deps, scope, currentOrigin);
      return;
    case 'unary':
      collectExpressionDeps(node.expr, deps, scope, currentOrigin);
      return;
    case 'index': {
      collectExpressionDeps(node.expr, deps, scope, currentOrigin);
      if (
        typeof node.index === 'string' &&
        expressionOutputOrigin(node.expr, scope, currentOrigin) === 'root'
      ) {
        deps.add(node.index);
      } else if (typeof node.index !== 'string') {
        collectExpressionDeps(node.index, deps, scope, currentOrigin);
      }
      return;
    }
    case 'slice':
      collectExpressionDeps(node.expr, deps, scope, currentOrigin);
      collectExpressionDeps(node.from, deps, scope, currentOrigin);
      collectExpressionDeps(node.to, deps, scope, currentOrigin);
      return;
    case 'iterator':
      collectExpressionDeps(node.expr, deps, scope, currentOrigin);
      return;
    case 'array':
      collectExpressionDeps(node.expr, deps, scope, currentOrigin);
      return;
    case 'object':
      for (const entry of node.entries) {
        if (typeof entry.key !== 'string') {
          collectExpressionDeps(entry.key, deps, scope, currentOrigin);
        } else if (!('value' in entry) && currentOrigin === 'root') {
          deps.add(entry.key);
        }
        if ('value' in entry) {
          collectExpressionDeps(entry.value, deps, scope, currentOrigin);
        }
      }
      return;
    case 'str':
      if (node.interpolated) {
        for (const part of node.parts) {
          if (typeof part !== 'string') {
            collectExpressionDeps(part, deps, scope, currentOrigin);
          }
        }
      }
      return;
    case 'format':
    case 'identity':
    case 'num':
    case 'bool':
    case 'null':
    case 'var':
    case 'break':
    case 'recursiveDescent':
      return;
  }
}

function extractNativeJqDepsFromAst(ast: AstNode): string[] {
  const deps = new Set<string>();
  collectExpressionDeps(
    ast.expr,
    deps,
    {
      defs: new Map(),
      vars: new Map(),
    },
    'root',
  );
  return [...deps];
}

export function prepareNativeJq(
  program: string,
  options: NativeDialectOptions = {},
): PreparedNativeJq {
  const parsed = parseNativeJq(program, options);
  const registry = resolveBuiltinRegistry(
    options.libraries ?? DEFAULT_BUILTIN_LIBRARIES,
  );
  const deps = extractNativeJqDepsFromAst(parsed.ast);

  return {
    ...parsed,
    deps,
    run(input: unknown, runOptions: PreparedNativeRunOptions = {}) {
      return runParsedNativeProgram(
        parsed,
        input,
        registry,
        runOptions.runtimeLimits ?? options.runtimeLimits,
      );
    },
  };
}

export function extractNativeJqDeps(
  program: string,
  options: NativeDialectOptions = {},
): string[] {
  try {
    const { ast } = parseNativeJq(program, options);
    return extractNativeJqDepsFromAst(ast);
  } catch (_error) {
    const matches = program.match(/\.[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
    return [...new Set(matches.map((entry) => entry.slice(1)))];
  }
}

export type { BuiltinLibraryName } from '../registry/index.js';
