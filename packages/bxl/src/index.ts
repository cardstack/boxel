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
  runNativeJq,
  tokenizeNativeJq,
} from './bxl/bridge/native.js';
import type { NativeRuntimeLimits } from './jqtools/evaluate/runtimeState.js';
import {
  compileReadableSyntax,
  ReadableSchema,
  ReadableSyntaxWarning,
} from './bxl/compiler/readable-syntax.js';
import {
  bxlToJqExpression,
  collapseBxlExpression,
  expandBxlExpression,
  jqToReadableBxlExpression,
  solidifyBxlExpression,
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

export const VERSION = '0.1.0-dev.0';

export {
  compileReadableSyntax,
  bxlToJqExpression,
  collapseBxlExpression,
  expandBxlExpression,
  jqToReadableBxlExpression,
  lintBxlExpression,
  parseNativeJq,
  runNativeJq,
  solidifyBxlExpression,
  tokenizeNativeJq,
};

export type {
  BxlConversionOptions,
  BxlFormatResult,
  BxlLintIssue,
  BxlLintOptions,
  BxlLintResult,
  BxlLintSeverity,
  BxlRewrite,
  BxlSolidifyResult,
  BuiltinLibraryName,
  JqToReadableBxlResult,
  NativeRuntimeLimits,
  ReadableSchema,
  ReadableSyntaxWarning,
};

export interface BxlOptions {
  schema?: ReadableSchema;
  libraries?: BuiltinLibraryName[];
  readableSyntax?: boolean;
  runtimeLimits?: NativeRuntimeLimits;
}

export interface BxlEvaluation {
  source: string;
  compiledSource: string;
  warnings: ReadableSyntaxWarning[];
  outputs: unknown[];
  value: unknown;
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

export function bxl(expression: string, options: BxlOptions = {}) {
  return function computeViaReadableBxl(this: object) {
    return evaluateBxl(expression, this, options).value;
  };
}
