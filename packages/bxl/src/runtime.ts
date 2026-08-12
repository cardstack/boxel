/**
 * @cardstack/bxl/runtime — sub-entry.
 *
 * Full evaluator with default formula libraries enabled. Use this if you
 * want the complete Excel-formula surface out of the box.
 *
 * For size-constrained embeds that don't need formulas, use
 * `@cardstack/bxl/runtime-bare` instead and register only the libraries
 * your application actually uses.
 */

export {
  runNativeJq,
  runNativeJqAsync,
  parseNativeJq,
  prepareNativeJq,
  prepareNativeJqAsync,
  tokenizeNativeJq,
  extractNativeJqDeps,
} from './bxl/bridge/native.js';

export type {
  NativeDialectOptions,
  NativeDialectRun,
  PreparedNativeJq,
  PreparedNativeRunOptions,
  NativeToken,
  AstNode,
  NativeJqDialectError,
} from './bxl/bridge/native.js';

export type { NativeRuntimeLimits } from './jqtools/evaluate/runtimeState.js';

export {
  BXL_REGISTRY,
  DEFAULT_BUILTIN_LIBRARIES,
  resolveBuiltinRegistry,
} from './bxl/registry/index.js';

export type {
  BuiltinLibrary,
  BuiltinLibraryName,
  ResolvedBuiltinRegistry,
} from './bxl/registry/index.js';

export {
  beginBxlComputeCycle,
  bxl,
  clearBxlComputeMemoization,
  currentBxlComputeCycle,
  evaluateBxl,
  evaluateBxlSafe,
  prepareBxl,
  prepareBxlSafe,
} from './index.js';
export type {
  BxlErrorRecord,
  BxlOptions,
  BxlEvaluation,
  BxlSafeResult,
  PreparedBxl,
  PreparedBxlRunOptions,
} from './index.js';

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
