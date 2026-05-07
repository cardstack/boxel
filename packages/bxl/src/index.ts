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
import {
  BXL_AGGREGATE_CALLS,
  BXL_CONTROL_OR_SIDE_EFFECT_CALLS,
  BXL_DERIVE_DENIED_CALLS,
  BXL_ERROR_MASKING_CALLS,
  BXL_FUNCTION_SAFETY_CATEGORIES,
  BXL_METADATA_CALLS,
  BXL_PREDICATE_LOWERABLE_CALLS,
  BXL_PROFILE_FUNCTION_POLICIES,
  BXL_VOLATILE_CALLS,
  categoryForBxlFunction,
  classifyBxlProfileFunction,
} from './bxl/profiles/function-safety.js';
import type {
  BxlPredicateSqlOptions,
  BxlPredicateSqlPath,
  BxlPredicateSqlPathUsage,
  BxlPredicateSqlResult,
  BxlPredicateSqlValue,
  BxlSqlPredicateMapping,
  BxlSqlPredicateModule,
} from './bxl/sql/index.js';
import type {
  BxlFunctionSafetyCategory,
  BxlFunctionSafetyDecision,
  BxlProfileFunctionPolicy,
  BxlProfileFunctionSafety,
} from './bxl/profiles/function-safety.js';
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
  BXL_AGGREGATE_CALLS,
  BXL_CONTROL_OR_SIDE_EFFECT_CALLS,
  BXL_DERIVE_DENIED_CALLS,
  BXL_ERROR_MASKING_CALLS,
  BXL_FUNCTION_SAFETY_CATEGORIES,
  BXL_METADATA_CALLS,
  BXL_PREDICATE_LOWERABLE_CALLS,
  BXL_PROFILE_FUNCTION_POLICIES,
  BXL_VOLATILE_CALLS,
  categoryForBxlFunction,
  classifyBxlProfileFunction,
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
  BxlFunctionSafetyCategory,
  BxlFunctionSafetyDecision,
  BxlProfileFunctionPolicy,
  BxlProfileFunctionSafety,
  BxlSafeResult,
};

export interface BxlOptions {
  schema?: ReadableSchema;
  libraries?: BuiltinLibraryName[];
  readableSyntax?: boolean;
  runtimeLimits?: NativeRuntimeLimits;
  /**
   * When the expression's raw output is structured (object or array of
   * objects), instantiate the given class and copy fields onto it. Mirrors
   * jqxl's `{ as: SomeFieldDef }` so Boxel `contains(...)` /
   * `containsMany(...)` computeds receive a real Field instance rather than
   * a plain object (which Boxel's serializer can't identify).
   */
  as?: new () => unknown;
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

/** Brand attached by the `jq` / `fx` tagged templates so `bxl()` can dispatch
 *  on the user's chosen mode. */
const BXL_MODE = Symbol.for('@cardstack/bxl.mode');

export interface BxlTaggedSource {
  readonly [BXL_MODE]: 'jq' | 'fx';
  readonly source: string;
  toString(): string;
}

function isTaggedSource(value: unknown): value is BxlTaggedSource {
  return (
    !!value &&
    typeof value === 'object' &&
    BXL_MODE in (value as object) &&
    typeof (value as BxlTaggedSource).source === 'string'
  );
}

function makeTagged(
  mode: 'jq' | 'fx',
  strings: TemplateStringsArray,
  values: unknown[],
): BxlTaggedSource {
  const source = strings.raw.reduce(
    (acc, segment, i) =>
      acc + segment + (i < values.length ? String(values[i]) : ''),
    '',
  );
  return {
    [BXL_MODE]: mode,
    source,
    toString() {
      return source;
    },
  };
}

// Boxel's `getFields` is loaded out-of-band by the realm bundle entry
// (`src/realm-bundle-entry.ts`), which performs the
// `https://cardstack.com/base/card-api` import and registers the function
// on `globalThis`. We can't import the URL statically here because Node's
// ESM loader rejects `https:` schemes at module-load time, breaking
// non-realm consumers (tests, tooling). The realm bundle still ships the
// URL import as an external statement; it just lives in the entry shim.
type GetFieldsFn = (
  instance: unknown,
  options?: { includeComputeds?: boolean },
) => Record<string, { fieldType?: string; card?: unknown; computeVia?: Function }>;

const GET_FIELDS_KEY = '__cardstackGetFields' as const;

function getCardstackGetFields(): GetFieldsFn | undefined {
  const fn = (globalThis as unknown as Record<string, unknown>)[GET_FIELDS_KEY];
  return typeof fn === 'function' ? (fn as GetFieldsFn) : undefined;
}

function safeFieldMap(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const getFields = getCardstackGetFields();
  if (!getFields) return null;
  try {
    return getFields(value, { includeComputeds: false });
  } catch {
    return null;
  }
}

function fieldMapForShape(shape: new () => unknown, instance: unknown) {
  if (!getCardstackGetFields()) return null;
  for (const target of [instance, shape]) {
    const map = safeFieldMap(target);
    if (map && Object.keys(map).length > 0) return map;
  }
  return null;
}

function hasStructuredFields(value: unknown): value is new () => unknown {
  if (typeof value !== 'function') return false;
  try {
    const probe = new (value as new () => unknown)();
    return !!safeFieldMap(probe);
  } catch {
    return false;
  }
}

function materializeShape(raw: unknown, ShapeClass: new () => unknown): unknown {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const instance = new ShapeClass() as Record<string, unknown>;
  const fieldMap = fieldMapForShape(ShapeClass, instance);
  if (!fieldMap) {
    // No field metadata available — fall back to a plain copy. Boxel's
    // serializer may not accept this (we'd hit "could not identify card"),
    // but it's the best we can do without getFields loaded.
    Object.assign(instance, raw);
    return instance;
  }
  for (const [fieldName, field] of Object.entries(fieldMap)) {
    const value = (raw as Record<string, unknown>)[fieldName];
    if (value === undefined) continue;
    if (field.fieldType === 'containsMany') {
      if (!Array.isArray(value)) {
        instance[fieldName] = [];
        continue;
      }
      if (hasStructuredFields(field.card)) {
        instance[fieldName] = value.map((entry) =>
          materializeShape(entry, field.card as new () => unknown),
        );
      } else {
        instance[fieldName] = value;
      }
      continue;
    }
    if (field.fieldType === 'contains') {
      if (hasStructuredFields(field.card) && value != null) {
        instance[fieldName] = materializeShape(
          value,
          field.card as new () => unknown,
        );
      } else {
        instance[fieldName] = value;
      }
      continue;
    }
    instance[fieldName] = value;
  }
  return instance;
}

function materializeAs(
  raw: unknown,
  ShapeClass: (new () => unknown) | undefined,
): unknown {
  if (!ShapeClass) return raw;
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return raw.map((entry) => materializeShape(entry, ShapeClass));
  }
  return materializeShape(raw, ShapeClass);
}

export function bxl(
  input: string | BxlTaggedSource,
  options: BxlOptions = {},
) {
  const tagged = isTaggedSource(input) ? input : null;
  const source = tagged ? tagged.source : (input as string);
  // Default readable-syntax mode is determined by the tag:
  //   jq`…`           → readableSyntax false (plain jq, no compile step)
  //   fx`…`           → readableSyntax true  (Excel-like BXL syntax)
  //   '…' plain str   → readableSyntax true  (assume BXL readable syntax)
  // Explicit options.readableSyntax always wins.
  const defaultReadable = tagged?.[BXL_MODE] === 'jq' ? false : true;
  const merged: BxlOptions = {
    ...options,
    readableSyntax: options.readableSyntax ?? defaultReadable,
  };
  const ShapeClass = options.as;
  return function computeViaBxl(this: object) {
    let raw: unknown;
    try {
      raw = evaluateBxl(source, this, merged).value;
    } catch (error) {
      // Excel-style errors (#N/A, #DIV/0!, #VALUE!, etc.) are first-class
      // values in spreadsheet semantics — they should land in the field,
      // not crash the indexer. The wrapped error message contains the
      // sentinel string ("#N/A", "#DIV/0!", …); return it as-is so a
      // StringField can render it and a NumberField/BooleanField gets
      // null via Boxel's normal coercion.
      if (isExcelErrorMessage(error)) {
        return null;
      }
      throw error;
    }
    return materializeAs(raw, ShapeClass);
  };
}

const EXCEL_ERROR_SENTINELS = new Set([
  '#NULL!',
  '#DIV/0!',
  '#VALUE!',
  '#REF!',
  '#NAME?',
  '#NUM!',
  '#N/A',
  '#ERROR!',
  '#GETTING_DATA',
]);

function isExcelErrorMessage(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  // Native dialect errors wrap the Excel sentinel as their message; the
  // sentinel may appear alone or with surrounding context.
  return Array.from(EXCEL_ERROR_SENTINELS).some((sentinel) =>
    message.includes(sentinel),
  );
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

/**
 * `jq` — tagged template literal that returns a raw jq string.
 *
 * Sidesteps the JS string-escape gotcha for jq's `\(...)` interpolation:
 * in a regular JS string literal, `\(` is unrecognized so JS silently drops
 * the backslash, and the runtime never sees the interpolation.
 *
 *   // Without — the leading backslash gets stripped by JS:
 *   expression('"\(.bpSystolic)/\(.bpDiastolic)"')
 *
 *   // With — backticks preserve everything verbatim:
 *   expression(jq`"\(.bpSystolic)/\(.bpDiastolic)"`)
 *
 * Reach for `jq\`…\`` only when the expression contains `\(...)` or any
 * other character JS would mangle. Plain expressions stay simple:
 *   expression('.firstName + " " + .lastName')
 */
/**
 * `jq\`…\`` — tagged template marking the expression as plain jq. The
 * caller of `bxl()` / `expression()` will skip the readable-syntax
 * compilation step and pass the source straight to the jq parser.
 *
 * Also sidesteps JS's silent-escape gotcha: backslashes in `\(.foo)`
 * survive untouched.
 */
export function jq(
  strings: TemplateStringsArray,
  ...values: unknown[]
): BxlTaggedSource {
  return makeTagged('jq', strings, values);
}

/**
 * `fx\`…\`` — tagged template marking the expression as Excel-like
 * readable BXL syntax. Mirrors the spreadsheet `fx` button. The caller of
 * `bxl()` / `expression()` will run the readable-syntax compiler before
 * evaluation. Same as passing a plain string today, but explicit at the
 * call site.
 */
export function fx(
  strings: TemplateStringsArray,
  ...values: unknown[]
): BxlTaggedSource {
  return makeTagged('fx', strings, values);
}
