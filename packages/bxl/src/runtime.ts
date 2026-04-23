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
  parseNativeJq,
  prepareNativeJq,
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

export { evaluateBxl, prepareBxl, bxl } from './index.js';
export type {
  BxlOptions,
  BxlEvaluation,
  PreparedBxl,
  PreparedBxlRunOptions,
} from './index.js';
