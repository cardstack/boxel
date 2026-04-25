/**
 * @cardstack/bxl — public entry.
 *
 * Re-exports the compiler, linter, formatter, and full-runtime evaluator.
 * For size-constrained bundles, use one of the sub-entries:
 *   - '@cardstack/bxl/compiler'     — readable BXL → canonical jqxl
 *   - '@cardstack/bxl/linter'       — parser-only diagnostics
 *   - '@cardstack/bxl/runtime'      — evaluator + default formula libraries
 *   - '@cardstack/bxl/runtime-bare' — evaluator without default formulas
 */

import {
  parseNativeJq,
  prepareNativeJq,
  runNativeJq,
  tokenizeNativeJq,
} from './bxl/bridge/native.js';
import type { NativeRuntimeLimits } from './jqtools/evaluate/runtimeState.js';
import {
  compileReadableSyntax,
  ReadableSchema,
  ReadableSyntaxCompileResult,
  ReadableSyntaxWarning,
} from './bxl/compiler/readable-syntax.js';
import {
  bxlToJqExpression,
  bxlToStorageExpression,
  collapseBxlExpression,
  expandBxlExpression,
  jqToReadableBxlExpression,
  solidifyBxlExpression,
  storageToReadableBxlExpression,
} from './bxl/formatter/index.js';
import type {
  BxlConversionOptions,
  BxlFormatResult,
  BxlRewrite,
  BxlSolidifyResult,
  JqToReadableBxlResult,
} from './bxl/formatter/index.js';
import { lintBxlExpression } from './bxl/linter/index.js';
import type {
  BxlLintIssue,
  BxlLintOptions,
  BxlLintResult,
  BxlLintSeverity,
} from './bxl/linter/index.js';
import {
  DEFAULT_BUILTIN_LIBRARIES,
  BuiltinLibraryName,
} from './bxl/registry/index.js';
import {
  assertValidBxlProfile,
  parseBxlAst,
  validateBxlAst,
  visitBxlAst,
  type BxlAstOptions,
  type BxlAstProgram,
  type BxlAttachment,
  type BxlProfile,
  type BxlProfileIssue,
  type BxlProfileValidationOptions,
} from './bxl/ast/index.js';
import {
  BxlPredicateSqlError,
  SQL_PREDICATE_MODULE,
  compileBxlPredicateAstToSql,
  compileBxlPredicateToSql,
} from './bxl/sql/index.js';
import type {
  BxlPredicateSqlOptions,
  BxlPredicateSqlPath,
  BxlPredicateSqlPathUsage,
  BxlPredicateSqlResult,
  BxlPredicateSqlValue,
  BxlSqlPredicateMapping,
  BxlSqlPredicateModule,
} from './bxl/sql/index.js';
import { toBxlErrorRecord, type BxlErrorRecord, type BxlSafeResult } from './error-utils.js';
export {
  __runBoxelRuntimeWorker,
  getBoxelValue,
  invalidateBoxelRuntimeAsyncCache,
  prepareBoxelGuideAsyncSafe,
  prepareBoxelGuideAsync,
  prepareBoxelGuideSafe,
  prepareBoxelGuide,
  prepareBoxelRuntimeAsyncSafe,
  prepareBoxelRuntimeAsync,
  prepareBoxelRuntimeSafe,
  prepareBoxelRuntime,
} from './boxel-runtime.js';
export type {
  BoxelAnnotationActor,
  BoxelAnnotationCardDraft,
  BoxelAnnotationEntryDraft,
  BoxelAnnotationKind,
  BoxelAnnotationSpec,
  BoxelConstraintSpec,
  BoxelExpressionValue,
  BoxelFieldGuideSpec,
  BoxelFieldState,
  BoxelFieldSuggestion,
  BoxelFormulaPatch,
  BoxelFormulaSpec,
  BoxelGuideExpression,
  BoxelGuideSpec,
  BoxelGuideViolation,
  BoxelLiteralOrExpression,
  BoxelRuntimeDefinition,
  BoxelRuntimeDelta,
  BoxelRuntimeErrorRecord,
  BoxelRuntimeAsyncOptions,
  BoxelRuntimeAsyncSession,
  BoxelRuntimeOptions,
  BoxelRuntimeResult,
  BoxelRuntimeRuleSummary,
  BoxelRuntimeSession,
  BoxelRuntimeWarning,
  PreparedBoxelRuntimeAsync,
  PreparedBoxelRuntime,
} from './boxel-runtime.js';

export const VERSION = '0.1.0-dev.0';

export {
  compileReadableSyntax,
  assertValidBxlProfile,
  SQL_PREDICATE_MODULE,
  bxlToJqExpression,
  bxlToStorageExpression,
  collapseBxlExpression,
  compileBxlPredicateAstToSql,
  compileBxlPredicateToSql,
  expandBxlExpression,
  jqToReadableBxlExpression,
  lintBxlExpression,
  parseBxlAst,
  parseNativeJq,
  prepareNativeJq,
  runNativeJq,
  solidifyBxlExpression,
  storageToReadableBxlExpression,
  tokenizeNativeJq,
  validateBxlAst,
  visitBxlAst,
  BxlPredicateSqlError,
};

export type {
  BxlAstOptions,
  BxlAstProgram,
  BxlAttachment,
  BxlConversionOptions,
  BxlFormatResult,
  BxlLintIssue,
  BxlLintOptions,
  BxlLintResult,
  BxlLintSeverity,
  BxlRewrite,
  BxlSolidifyResult,
  BxlProfile,
  BxlProfileIssue,
  BxlProfileValidationOptions,
  BxlPredicateSqlOptions,
  BxlPredicateSqlPath,
  BxlPredicateSqlPathUsage,
  BxlPredicateSqlResult,
  BxlPredicateSqlValue,
  BxlSqlPredicateMapping,
  BxlSqlPredicateModule,
  BuiltinLibraryName,
  JqToReadableBxlResult,
  NativeRuntimeLimits,
  ReadableSchema,
  ReadableSyntaxCompileResult,
  ReadableSyntaxWarning,
  BxlErrorRecord,
  BxlSafeResult,
};

export interface BxlOptions {
  schema?: ReadableSchema;
  libraries?: BuiltinLibraryName[];
  readableSyntax?: boolean;
  runtimeLimits?: NativeRuntimeLimits;
}

export interface CompileBxlOptions extends BxlOptions {
  target?: 'jq' | 'ast';
  profile?: BxlProfile;
  attachment?: BxlAttachment;
}

export function compileBxl(
  expression: string,
  options: CompileBxlOptions & { target: 'ast' },
): BxlAstProgram;
export function compileBxl(
  expression: string,
  options?: CompileBxlOptions & { target?: 'jq' },
): ReadableSyntaxCompileResult;
export function compileBxl(
  expression: string,
  options: CompileBxlOptions = {},
): ReadableSyntaxCompileResult | BxlAstProgram {
  if (options.target === 'ast') {
    return parseBxlAst(expression, options);
  }
  return compileReadableSyntax(expression, options);
}

export interface BxlEvaluation {
  source: string;
  compiledSource: string;
  warnings: ReadableSyntaxWarning[];
  outputs: unknown[];
  value: unknown;
}

export interface PreparedBxlRunOptions {
  runtimeLimits?: NativeRuntimeLimits;
}

export interface PreparedBxl {
  source: string;
  compiledSource: string;
  warnings: ReadableSyntaxWarning[];
  deps: string[];
  evaluate(input: unknown, options?: PreparedBxlRunOptions): BxlEvaluation;
}

function normalizeBxlOutputs(outputs: unknown[]): unknown {
  if (outputs.length === 0) return null;
  if (outputs.length === 1) return outputs[0];
  return outputs;
}

export function evaluateBxl(
  expression: string,
  input: unknown,
  options: BxlOptions = {},
): BxlEvaluation {
  const run = runNativeJq(expression, input, {
    schema: options.schema,
    readableSyntax: options.readableSyntax,
    libraries: options.libraries ?? DEFAULT_BUILTIN_LIBRARIES,
    runtimeLimits: options.runtimeLimits,
  });

  return {
    source: run.source,
    compiledSource: run.compiledSource,
    warnings: run.readableWarnings,
    outputs: run.outputs,
    value: normalizeBxlOutputs(run.outputs),
  };
}

export function evaluateBxlSafe(
  expression: string,
  input: unknown,
  options: BxlOptions = {},
): BxlSafeResult<BxlEvaluation> {
  try {
    return {
      ok: true,
      value: evaluateBxl(expression, input, options),
    };
  } catch (error) {
    return {
      ok: false,
      error: toBxlErrorRecord(error),
    };
  }
}

export function prepareBxl(
  expression: string,
  options: BxlOptions = {},
): PreparedBxl {
  const prepared = prepareNativeJq(expression, {
    schema: options.schema,
    readableSyntax: options.readableSyntax,
    libraries: options.libraries ?? DEFAULT_BUILTIN_LIBRARIES,
    runtimeLimits: options.runtimeLimits,
  });

  return {
    source: prepared.source,
    compiledSource: prepared.compiledSource,
    warnings: prepared.readableWarnings,
    deps: prepared.deps,
    evaluate(input: unknown, runOptions: PreparedBxlRunOptions = {}) {
      const run = prepared.run(input, {
        runtimeLimits: runOptions.runtimeLimits ?? options.runtimeLimits,
      });

      return {
        source: run.source,
        compiledSource: run.compiledSource,
        warnings: run.readableWarnings,
        outputs: run.outputs,
        value: normalizeBxlOutputs(run.outputs),
      };
    },
  };
}

export function prepareBxlSafe(
  expression: string,
  options: BxlOptions = {},
): BxlSafeResult<PreparedBxl> {
  try {
    return {
      ok: true,
      value: prepareBxl(expression, options),
    };
  } catch (error) {
    return {
      ok: false,
      error: toBxlErrorRecord(error, 'prepare'),
    };
  }
}

export function bxl(expression: string, options: BxlOptions = {}) {
  return function computeViaReadableBxl(this: object) {
    return evaluateBxl(expression, this, options).value;
  };
}

/**
 * `expression` / `expr` — aliases of `bxl`.
 *
 * Reads beautifully inside @field decorators:
 *
 *   @field total = contains(NumberField, {
 *     computeVia: expression('ROUND(.subtotal * (1 + .taxRate), 2)'),
 *   });
 *
 *   @field isActive = contains(BooleanField, {
 *     computeVia: expr('Status = "active"'),
 *   });
 *
 * Identical semantics to `bxl(...)`. Pick whichever reads best in context.
 */
export const expression = bxl;
export const expr = bxl;
