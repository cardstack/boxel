/**
 * @cardstack/bxl/runtime-bare — sub-entry.
 *
 * Evaluator WITHOUT default formula libraries. This entry deliberately does
 * not import from src/formulajs/; the resulting bundle is substantially
 * smaller because the ~280 Excel helpers are not included.
 *
 * Callers who want specific formula libraries should import them from
 * `@cardstack/bxl/formulas/*` (when those sub-entries are implemented in
 * v0.2) and register them explicitly.
 */

export { runNativeJq } from './bxl/bridge/native.js';
export type {
  NativeDialectOptions,
  NativeDialectRun,
} from './bxl/bridge/native.js';

export {
  resolveCoreRegistry,
  CORE_REGISTRY,
} from './jqtools/evaluate/filters/registry.js';
export type {
  BuiltinLibrary,
  ResolvedBuiltinRegistry,
} from './jqtools/evaluate/filters/registry.js';

export type { NativeRuntimeLimits } from './jqtools/evaluate/runtimeState.js';

import { runNativeJq } from './bxl/bridge/native.js';
import type { ReadableSchema } from './bxl/compiler/readable-syntax.js';
import type { NativeRuntimeLimits } from './jqtools/evaluate/runtimeState.js';

export interface BxlBareOptions {
  schema?: ReadableSchema;
  readableSyntax?: boolean;
  runtimeLimits?: NativeRuntimeLimits;
}

/**
 * Evaluate with jq-core builtins only (no Excel formulas).
 *
 * Throws on any formula-call in the expression because those builtins are
 * not registered in the core library.
 */
export function evaluateBxlBare(
  expression: string,
  input: unknown,
  options: BxlBareOptions = {},
) {
  let run;
  try {
    run = runNativeJq(expression, input, {
      schema: options.schema,
      readableSyntax: options.readableSyntax,
      libraries: ['core'] as any,
      runtimeLimits: options.runtimeLimits,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missingFormula = message.match(/'([A-Z][A-Z0-9_]*\/\d+)' is not defined/);
    if (missingFormula) {
      throw new Error(
        `runtime-bare contains jq core only; ${missingFormula[1]} is a ` +
        `spreadsheet formula. Import from '@cardstack/bxl/runtime' (or the ` +
        `main '@cardstack/bxl' entry) to enable the formula library.`,
      );
    }
    throw error;
  }

  if (run.outputs.length === 0) return null;
  if (run.outputs.length === 1) return run.outputs[0];
  return run.outputs;
}
