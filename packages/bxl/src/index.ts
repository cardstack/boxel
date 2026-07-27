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
  prepareNativeJqAsync,
  prepareNativeJq,
  prepareNativeJqForRuntime,
  runNativeJq,
  runNativeJqForRuntime,
  runNativeJqAsync,
  type PreparedNativeJq,
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
  bxlAstProgramFromNativeParsed,
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

export const VERSION = '0.2.0';

/**
 * Build identity, useful for debugging stale caches in the realm
 * bundle. The realm-bundle script
 * (`scripts/build-realm-bundle.mjs`) replaces `buildTime: 'dev'`
 * with the wall-clock build timestamp at bundling time, so a
 * served bundle's `BXL_BUILD_INFO.buildTime` reveals when it was
 * produced.
 *
 * `features` is the canonical list of port-doc rules baked into
 * the bundle. If you suspect a card is hitting a regression, grep
 * the served bundle for the feature string before tearing the
 * realm-server stack down — a missing feature means the rebuild
 * never landed.
 *
 * @example
 * ```ts
 * import { BXL_BUILD_INFO } from '@cardstack/bxl';
 *
 * console.log(BXL_BUILD_INFO);
 * // {
 * //   version: '0.2.0',
 * //   buildTime: '2026-05-07T15:42:01.000Z',
 * //   features: ['null-tolerance', 'jq-fx-tags', 'as-materialize',
 * //              'pascalcase-fallback', 'jq-keywords-guard'],
 * // }
 * ```
 */
export const BXL_BUILD_INFO = {
  version: VERSION,
  buildTime: 'dev',
  features: [
    'null-tolerance',       // port-doc §6–9
    'jq-fx-tags',           // §10, §11
    'as-materialize',       // §11a
    'pascalcase-fallback',  // §12
    'jq-keywords-guard',    // §13
  ] as const,
};

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
  prepareNativeJqAsync,
  runNativeJq,
  runNativeJqAsync,
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

/**
 * Shared options for the BXL surface. Every entry-point function
 * (`evaluateBxl`, `compileBxl`, `prepareBxl`, `bxl`, …) accepts this
 * shape and forwards the relevant fields to the underlying compiler /
 * runtime.
 */
export interface BxlOptions {
  /**
   * Field metadata used by the readable-syntax compiler to resolve
   * label paths (e.g. `"Line Item"` → `.lineItems`). When omitted, the
   * compiler falls back to a single-word PascalCase → camelCase rule
   * for bare identifiers — see docs/internals/port-from-jqxl.md §12.
   */
  schema?: ReadableSchema;
  /**
   * Which builtin formula libraries to load into the runtime. Defaults
   * to `DEFAULT_BUILTIN_LIBRARIES`. Pass an empty array to use jq + the
   * native filters only, no spreadsheet helpers.
   */
  libraries?: BuiltinLibraryName[];
  /**
   * Whether to run the readable-syntax compiler before evaluation.
   * - `true` — accept `Severity == "High"`, `ROUND(x, 2)`, etc.
   * - `false` — pass the source straight to the jq parser.
   *
   * Default depends on the caller: `evaluateBxl` and plain-string
   * `bxl()` default to `true`; `bxl(jq\`…\`)` defaults to `false`.
   */
  readableSyntax?: boolean;
  /** Per-call runtime caps (output count, wall-clock, …). */
  runtimeLimits?: NativeRuntimeLimits;
  /**
   * Materialize the raw output as an instance of `Class`. When the
   * expression yields:
   * - a plain object → `new Class(); Object.assign(instance, raw)`
   *   — or, if Boxel's `getFields` is reachable, a recursive
   *   `field.fieldType` walk that materializes nested
   *   `contains` / `containsMany` shapes.
   * - an array → each entry gets the same treatment.
   * - `null` / a scalar → returned as-is.
   *
   * Mirrors jqxl's `{ as: SomeFieldDef }` so a Boxel
   * `contains(BaseField, { computeVia: bxl(..., { as: SubField }) })`
   * gets back a real subclass instance the serializer can identify,
   * rather than a plain object that hits "could not identify card".
   */
  as?: new () => unknown;
  /**
   * Cache `bxl()` / `expression()` results per compute function and
   * card instance. This only affects the Boxel computeVia factory, not
   * `evaluateBxl` or `prepareBxl`.
   *
   * - `true` / `'microtask'` / omitted: cache within the current
   *   microtask. This catches repeated synchronous reads during a
   *   serializer/search pass without holding stale values after the
   *   current turn completes.
   * - `'manual'`: cache until {@link beginBxlComputeCycle} is called.
   *   Boxel can use this for an explicit render/index cycle boundary.
   * - `false`: disable computeVia memoization for this expression.
   */
  memoize?: boolean | BxlComputeMemoizationMode;
}

export type BxlComputeMemoizationMode = 'microtask' | 'manual' | false;

export interface BxlComputeMetadata {
  source: string;
  compiledSource: string;
  warnings: ReadableSyntaxWarning[];
  deps: string[];
  memoize: BxlComputeMemoizationMode;
}

export interface BxlComputeFunction {
  (this: object): unknown;
  readonly bxl: BxlComputeMetadata;
}

let bxlComputeCycle = 0;
let bxlMicrotaskCycleScheduled = false;

/**
 * Start a new explicit BXL compute cycle and invalidate all per-cycle
 * `expression()` memo entries. Boxel render/index code can call this
 * once around a logical serialization or indexing pass when it wants
 * memoization to span async boundaries inside that pass.
 */
export function beginBxlComputeCycle(): number {
  bxlComputeCycle += 1;
  bxlMicrotaskCycleScheduled = false;
  return bxlComputeCycle;
}

/** Alias for callers that want the operation name to read as invalidation. */
export const clearBxlComputeMemoization = beginBxlComputeCycle;

export function currentBxlComputeCycle(): number {
  return bxlComputeCycle;
}

function assertComputeViaDeriveProfile(
  source: string,
  options: BxlOptions,
  prepared?: PreparedNativeJq,
) {
  const astOptions = {
    attachment: 'formula',
    libraries: options.libraries,
    profile: 'derive',
    readableSyntax: options.readableSyntax,
    schema: options.schema,
  } satisfies BxlAstOptions;
  const program = prepared
    ? bxlAstProgramFromNativeParsed(prepared, astOptions)
    : parseBxlAst(source, astOptions);
  const issues = program.profileIssues.filter(
    (issue) => issue.severity === 'error',
  );
  if (issues.length === 0) {
    return;
  }

  throw new Error(
    [
      'computeVia expression violates the derive profile:',
      ...issues.map((issue) => `${issue.code}: ${issue.message}`),
    ].join('\n'),
  );
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

/** Result shape returned by {@link evaluateBxl} and `prepared.evaluate(...)`. */
export interface BxlEvaluation {
  /** The original source as passed in (post-tag-extraction). */
  source: string;
  /** Canonical jq source the compiler produced. */
  compiledSource: string;
  /** Lint-style warnings raised during readable-syntax compilation. */
  warnings: ReadableSyntaxWarning[];
  /** Every value the program emitted. jq programs are streams, not single values. */
  outputs: unknown[];
  /**
   * Convenience: `outputs[0]` if there was one output, the array if
   * there were several, `null` for an empty stream.
   */
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

function schemaInputWarnings(
  input: unknown,
  schema: ReadableSchema | undefined,
  path = '$',
): ReadableSyntaxWarning[] {
  if (!schema || !input || typeof input !== 'object' || Array.isArray(input)) {
    return [];
  }

  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  const warnings: ReadableSyntaxWarning[] = [];

  for (const field of schema.fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field.key)) {
      const casingMatch = keys.find(
        (key) => key !== field.key && key.toLowerCase() === field.key.toLowerCase(),
      );
      if (casingMatch) {
        warnings.push({
          code: 'input-key-casing-mismatch',
          message:
            `Input key '${path}.${casingMatch}' differs from schema key ` +
            `'${path}.${field.key}' only by casing; readable BXL compiled for ` +
            `'${field.key}' and will not read '${casingMatch}'.`,
        });
      }
      continue;
    }

    const value = record[field.key];
    if (field.kind === 'array' && Array.isArray(value) && field.item) {
      value.forEach((entry, index) => {
        warnings.push(
          ...schemaInputWarnings(entry, field.item, `${path}.${field.key}[${index}]`),
        );
      });
    } else if (field.kind === 'object' && field.fields) {
      warnings.push(
        ...schemaInputWarnings(value, { fields: field.fields }, `${path}.${field.key}`),
      );
    }
  }

  return warnings;
}

/**
 * Compile and evaluate a BXL expression against a single input.
 *
 * - `expression` — readable BXL or plain jq, depending on
 *   `options.readableSyntax` (default `true`).
 * - `input` — the JSON value bound to `.` (the jq root). Plain JS
 *   objects, arrays, primitives, and `null` are all valid.
 * - `options` — see {@link BxlOptions}.
 *
 * Returns a {@link BxlEvaluation} with the canonical jq source the
 * compiler produced, the array of all output values, and a normalized
 * `value` (the single output, the array if there were several, or
 * `null` for an empty stream).
 *
 * Throws on parse, compile, or evaluation errors. Use
 * {@link evaluateBxlSafe} for a result-shaped variant.
 *
 * @example
 * ```ts
 * evaluateBxl(
 *   'ROUND(Subtotal * "Tax Rate" / 100, 2)',
 *   { subtotal: 50, taxRate: 8.25 },
 *   { schema: invoiceSchema },
 * );
 * // → { value: 4.13, … }
 * ```
 */
export function evaluateBxl(
  expression: string,
  input: unknown,
  options: BxlOptions = {},
): BxlEvaluation {
  const run = runNativeJqForRuntime(expression, input, {
    schema: options.schema,
    readableSyntax: options.readableSyntax,
    libraries: options.libraries ?? DEFAULT_BUILTIN_LIBRARIES,
    runtimeLimits: options.runtimeLimits,
  });

  return {
    source: run.source,
    compiledSource: run.compiledSource,
    warnings: [
      ...run.readableWarnings,
      ...schemaInputWarnings(input, options.schema),
    ],
    outputs: run.outputs,
    value: normalizeBxlOutputs(run.outputs),
  };
}

/**
 * {@link evaluateBxl} variant that returns a discriminated union
 * instead of throwing. Use when the caller is iterating over
 * user-authored expressions and a single bad apple shouldn't tear
 * down the loop.
 *
 * @example
 * ```ts
 * const r = evaluateBxlSafe('totally bogus', {});
 * if (r.ok) doSomething(r.value);
 * else logger.warn(r.error.phase, r.error.message);
 * ```
 */
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

/**
 * Compile a BXL expression once, then evaluate it against many
 * inputs. Returns a {@link PreparedBxl} whose `evaluate(input)` is
 * cheaper than re-running `evaluateBxl` because parse + compile
 * happens up front.
 *
 * `prepared.deps` lists the root-input field keys the expression
 * actually reads — handy for invalidation-tracking inside a reactive
 * runtime.
 */
export function prepareBxl(
  expression: string,
  options: BxlOptions = {},
): PreparedBxl {
  const prepared = prepareNativeJqForRuntime(expression, {
    schema: options.schema,
    readableSyntax: options.readableSyntax,
    libraries: options.libraries ?? DEFAULT_BUILTIN_LIBRARIES,
    runtimeLimits: options.runtimeLimits,
  });

  return preparedBxlFromNative(prepared, options);
}

function preparedBxlFromNative(
  prepared: PreparedNativeJq,
  options: BxlOptions,
): PreparedBxl {
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
        warnings: [
          ...run.readableWarnings,
          ...schemaInputWarnings(input, options.schema),
        ],
        outputs: run.outputs,
        value: normalizeBxlOutputs(run.outputs),
      };
    },
  };
}

/**
 * {@link prepareBxl} variant that returns a discriminated union
 * instead of throwing on parse / compile errors. Run-time errors
 * still propagate from the returned `prepared.evaluate(...)` call —
 * use {@link evaluateBxlSafe} for evaluation-time safety as well.
 */
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

/**
 * Branded source produced by the {@link jq} and {@link fx} tagged
 * templates. Carries the chosen mode alongside the raw source so
 * {@link bxl} can dispatch without a `typeof input === 'function'`
 * check at the call site.
 */
export interface BxlTaggedSource {
  readonly [BXL_MODE]: 'jq' | 'fx';
  /** Raw source with `String.raw`-style escape handling. */
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
) => Record<string, { fieldType?: string; card?: unknown; computeVia?: (...args: unknown[]) => unknown }>;

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

function normalizeMemoizationMode(
  value: BxlOptions['memoize'],
): BxlComputeMemoizationMode {
  if (value === false) return false;
  if (value === 'manual') return 'manual';
  return 'microtask';
}

function scheduleMicrotaskCycleBump() {
  if (bxlMicrotaskCycleScheduled) return;
  bxlMicrotaskCycleScheduled = true;
  const run = () => {
    bxlComputeCycle += 1;
    bxlMicrotaskCycleScheduled = false;
  };
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(run);
  } else {
    void Promise.resolve().then(run);
  }
}

function memoEpochFor(mode: BxlComputeMemoizationMode): number | null {
  if (mode === false) return null;
  if (mode === 'microtask') {
    scheduleMicrotaskCycleBump();
  }
  return bxlComputeCycle;
}

function objectMemoKey(value: unknown): object | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? (value as object)
    : null;
}

/**
 * Factory that compiles a BXL expression into a function bound to
 * `this` (the value of `.` at evaluation time). The returned
 * `computeViaBxl` is shaped for Boxel's `computeVia` contract — call
 * it via `compute.call(card)` (or let the realm runtime do the
 * binding inside `@field decorator { computeVia: bxl(...) }`).
 *
 * `input` may be:
 * - a plain string — readable BXL syntax, compiled before evaluation.
 * - `` jq`…` `` — plain jq; readable-syntax compilation is skipped.
 * - `` fx`…` `` — Excel-like readable BXL; identical to a plain
 *   string today, explicit at the call site for cross-tag clarity.
 *
 * Beyond plain `evaluateBxl`, the factory adds five behaviors that
 * Boxel realms need:
 * 1. **Prepare-once evaluation** — parse/compile happens when the
 *    compute function is constructed, not on every field access.
 * 2. **Derive-profile validation** — the source must be deterministic
 *    record-local computation before a compute function is returned.
 * 3. **Excel-error catch** — a thrown `#N/A`, `#DIV/0!`, `#VALUE!`,
 *    etc. is captured at the boundary and surfaced as `null` so the
 *    indexer doesn't tear down the card mid-render.
 * 4. **`as: SomeFieldDef`** — the raw output is materialized as an
 *    instance of the given class via {@link BxlOptions.as}.
 * 5. **Tag-aware `readableSyntax` default** — `jq` tag → false,
 *    everything else → true. Explicit `options.readableSyntax` always
 *    wins.
 *
 * @example
 * ```ts
 * @field statusPanel = contains(RegularStatusField, {
 *   computeVia: bxl(
 *     jq`if .severity == "Critical" then { label: "ICU CARE", tone: "red" } else { label: "Stable", tone: "blue" } end`,
 *     { as: IcuStatusField },
 *   ),
 * });
 * ```
 *
 * Aliased as {@link expression} and {@link expr} — pick whichever
 * reads best at the call site.
 */
export function bxl(
  input: string | BxlTaggedSource,
  options: BxlOptions = {},
): BxlComputeFunction {
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
  const preparedNative = prepareNativeJqForRuntime(source, {
    schema: merged.schema,
    readableSyntax: merged.readableSyntax,
    libraries: merged.libraries ?? DEFAULT_BUILTIN_LIBRARIES,
    runtimeLimits: merged.runtimeLimits,
  });
  assertComputeViaDeriveProfile(source, merged, preparedNative);
  const prepared = preparedBxlFromNative(preparedNative, merged);
  const ShapeClass = options.as;
  const memoize = normalizeMemoizationMode(merged.memoize);
  const memoCache =
    memoize === false
      ? undefined
      : new WeakMap<object, { cycle: number; value: unknown }>();

  const computeViaBxl = function computeViaBxl(this: object) {
    const memoKey = objectMemoKey(this);
    const cycle = memoEpochFor(memoize);
    if (memoCache && memoKey && cycle !== null) {
      const cached = memoCache.get(memoKey);
      if (cached?.cycle === cycle) {
        return cached.value;
      }
    }

    let raw: unknown;
    try {
      raw = prepared.evaluate(this).value;
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
    const value = materializeAs(raw, ShapeClass);
    if (memoCache && memoKey && cycle !== null) {
      memoCache.set(memoKey, { cycle, value });
    }
    return value;
  } as BxlComputeFunction;

  Object.defineProperty(computeViaBxl, 'bxl', {
    value: Object.freeze({
      source: prepared.source,
      compiledSource: prepared.compiledSource,
      warnings: prepared.warnings,
      deps: prepared.deps,
      memoize,
    } satisfies BxlComputeMetadata),
    enumerable: false,
  });

  return computeViaBxl;
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
 * Alias of {@link bxl}. Reads more naturally than `bxl(...)` inside
 * Boxel `@field` decorators where the surrounding code talks about
 * "expressions".
 *
 * @example
 * ```ts
 * @field total = contains(NumberField, {
 *   computeVia: expression('ROUND(.subtotal * (1 + .taxRate), 2)'),
 * });
 * ```
 */
export const expression = bxl;
/** Shorthand alias of {@link bxl}. */
export const expr = bxl;

/**
 * Tagged template marking the expression as plain jq. Two purposes:
 *
 * 1. Tells {@link bxl} / {@link expression} to skip readable-syntax
 *    compilation and hand the source straight to the jq parser.
 * 2. Backticks preserve `\(...)` interpolation verbatim — a regular
 *    JS string literal silently drops the backslash before `(`, and
 *    the runtime never sees the interpolation.
 *
 * Reach for `` jq`…` `` when the expression uses `\(...)` or any
 * character JS string-escaping would mangle. Plain prose paths stay
 * simple as a string:
 *
 * @example
 * ```ts
 * expression(jq`"\(.bpSystolic)/\(.bpDiastolic)"`)        // ✓
 * expression('"\(.bpSystolic)/\(.bpDiastolic)"')          // ✗ — backslashes stripped
 * expression('.firstName + " " + .lastName')              // ✓ — no escape needed
 * ```
 */
export function jq(
  strings: TemplateStringsArray,
  ...values: unknown[]
): BxlTaggedSource {
  return makeTagged('jq', strings, values);
}

/**
 * Tagged template marking the expression as Excel-like readable BXL
 * syntax. Identical to passing a plain string today (the readable-
 * syntax compiler runs in both cases), but the `fx` tag is explicit
 * at the call site — useful when a file mixes `jq` and `fx` sources
 * and you want the casing/PascalCase intent to be obvious.
 *
 * The name mirrors a spreadsheet's `fx` button.
 *
 * @example
 * ```ts
 * expression(fx`ROUND(Salary / 2080, 2)`)
 * expression(fx`PatientId & " — " & FirstName & " " & LastName`)
 * ```
 */
export function fx(
  strings: TemplateStringsArray,
  ...values: unknown[]
): BxlTaggedSource {
  return makeTagged('fx', strings, values);
}
