/**
 * @cardstack/bxl/transform — sub-entry.
 *
 * Runs one BXL expression over one value under the `transform` profile: a
 * card operation's `input` stage, which shapes the payload before the
 * operation uses it, and its `output` stage, which projects the result before
 * the caller sees it.
 *
 * The sibling of `@cardstack/bxl/mutation`, and split from it for the same
 * reason the mutation entry is split from the root: a host that runs
 * transforms pulls in the evaluator, the AST profile check and the
 * request-context builtins, and nothing of the linter, the formatter or the
 * SQL compiler.
 *
 * A transform is an *expression*, not a plan. It reads `.` — the value it was
 * handed — plus the request context (`params()`, `actor()`, `instance()`),
 * and yields one value. It writes nothing: the `transform` profile refuses
 * jq's assignment operators, user-defined helpers, loops, recursive descent,
 * `try`, `label`/`break`, format filters, and every call that touches the
 * runtime or has a side effect.
 */
import { parseBxlAst, validateBxlAst } from './bxl/ast/index.ts';
import { runNativeJq } from './bxl/bridge/native.ts';
import {
  requestContextBuiltinLibraries,
  type BuiltinLibraryName,
} from './bxl/registry/index.ts';
import {
  withRequestContext,
  type NativeRequestContext,
  type NativeRuntimeLimits,
} from './jqtools/evaluate/runtimeState.ts';

/**
 * The request-scoped values a transform program reads, as the builtins expect
 * them. Every slot is optional: a slot the host leaves out is one the program
 * may not read, and reading it is an error naming the slot rather than a
 * `null` flowing on into the result.
 */
export interface BxlTransformContext extends NativeRequestContext {
  readonly params?: Record<string, unknown>;
  readonly actor?: string;
  readonly instance?: Record<string, unknown>;
}

export interface BxlTransformOptions {
  /** Defaults to the canonical spelling the operation store holds. */
  readonly syntax?: 'readable' | 'solidified';
  readonly libraries?: BuiltinLibraryName[];
  readonly runtimeLimits?: NativeRuntimeLimits;
}

/**
 * Why a transform did not produce a value.
 *
 * `phase` separates the two things a host has to tell apart: a program the
 * author wrote wrong (`parse`, `profile`) from one that was well formed and
 * failed on the values it was handed (`evaluate`). Both are the author's, and
 * a host that reports them differently is describing the same defect at two
 * different moments.
 */
export class BxlTransformError extends Error {
  readonly phase: 'parse' | 'profile' | 'evaluate';

  constructor(phase: 'parse' | 'profile' | 'evaluate', message: string) {
    super(message);
    this.name = 'BxlTransformError';
    this.phase = phase;
  }
}

export function isBxlTransformError(err: unknown): err is BxlTransformError {
  return err instanceof BxlTransformError;
}

/**
 * Check a transform program without running it, for a caller that is storing
 * one rather than invoking it. Answers the profile's findings, so a program
 * that parses but reaches outside the dialect is reported where it is written
 * rather than at the first invocation.
 */
export function checkBxlTransform(
  source: string,
  options: BxlTransformOptions = {},
): string[] {
  try {
    return profileErrors(source, options);
  } catch (err: unknown) {
    return [messageOf(err)];
  }
}

/**
 * Run `source` over `input`, with `context` scoped to the run.
 *
 * One value in, one value out. A program that yields several values is
 * refused rather than having its first taken: the stages this runs are a
 * payload and a result, and a caller handed the first of several would carry
 * on with an answer the author did not mean to give. A program that yields
 * none is refused for the same reason — `empty` is already denied, so the
 * only way here is a filter that matched nothing, and a payload silently
 * becoming absent is the failure these stages exist to avoid.
 */
export function runBxlTransform(
  source: string,
  input: unknown,
  context: BxlTransformContext = {},
  options: BxlTransformOptions = {},
): unknown {
  let issues = profileErrors(source, options);
  if (issues.length > 0) {
    throw new BxlTransformError('profile', issues.join('\n'));
  }
  let outputs: unknown[];
  try {
    // Synchronous on purpose: `withRequestContext` unwinds its stack when the
    // callback returns, so anything deferred past that point would read
    // another request's context. It refuses a promise rather than allowing
    // one, and the evaluator this calls is the synchronous entry.
    outputs = withRequestContext(
      context,
      () =>
        runNativeJq(source, input, {
          readableSyntax: options.syntax === 'readable',
          libraries: requestContextBuiltinLibraries(options.libraries),
          ...(options.runtimeLimits
            ? { runtimeLimits: options.runtimeLimits }
            : {}),
        }).outputs,
    );
  } catch (err: unknown) {
    throw new BxlTransformError('evaluate', messageOf(err));
  }
  if (outputs.length !== 1) {
    throw new BxlTransformError(
      'evaluate',
      `a transform produces one value, and this program produced ${outputs.length}`,
    );
  }
  return outputs[0];
}

/** The profile's error findings, with a parse failure reported as its own. */
function profileErrors(source: string, options: BxlTransformOptions): string[] {
  let program;
  try {
    program = parseBxlAst(source, {
      readableSyntax: options.syntax === 'readable',
      profile: 'transform',
    });
  } catch (err: unknown) {
    throw new BxlTransformError('parse', messageOf(err));
  }
  // Re-validated rather than read off `program.profileIssues`, so a caller
  // handing in an already-parsed program later reaches the same answer.
  return validateBxlAst(program, { profile: 'transform' })
    .filter((issue) => issue.severity === 'error')
    .map((issue) => `${issue.code}: ${issue.message}`);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
