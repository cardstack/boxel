import { deepClone } from './utils/utils.ts';
import { JqEvaluateError } from '../errors.ts';

export interface NativeRuntimeDiagnostics {
  debugMessages: string[];
  stderr: string[];
  haltedExitCode?: number;
}

export interface NativeRuntimeSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
}

export interface NativeRuntimeLimits {
  maxSteps?: number;
  maxOutputs?: number;
  maxOutputBytes?: number;
  maxMillis?: number;
  signal?: NativeRuntimeSignal;
}

const DEFAULT_RUNTIME_LIMITS: Required<Omit<NativeRuntimeLimits, 'signal'>> = {
  maxSteps: 250_000,
  maxOutputs: 10_000,
  maxOutputBytes: 5_000_000,
  maxMillis: 2_000,
};

interface RuntimeContext extends NativeRuntimeDiagnostics {
  limits: Required<Omit<NativeRuntimeLimits, 'signal'>> & {
    signal?: NativeRuntimeSignal;
  };
  startMillis: number;
  steps: number;
  outputs: number;
  outputBytes: number;
}

const runtimeStack: RuntimeContext[] = [];

function currentRuntimeContext(): RuntimeContext | undefined {
  return runtimeStack[runtimeStack.length - 1];
}

export class HaltSignal extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super(`jq halted with exit code ${exitCode}`);
    this.exitCode = exitCode;
    this.name = 'HaltSignal';
  }
}

export class RuntimeLimitError extends JqEvaluateError {
  readonly limit:
    | keyof Required<Omit<NativeRuntimeLimits, 'signal'>>
    | 'signal';

  constructor(
    limit: keyof Required<Omit<NativeRuntimeLimits, 'signal'>> | 'signal',
    message: string,
  ) {
    super(message);
    this.limit = limit;
    this.name = 'RuntimeLimitError';
  }
}

function normalizeRuntimeLimits(
  limits: NativeRuntimeLimits = {},
): RuntimeContext['limits'] {
  return {
    ...DEFAULT_RUNTIME_LIMITS,
    ...limits,
  };
}

function isFiniteLimit(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function estimateOutputBytes(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 4;
  } catch {
    return 0;
  }
}

export function withRuntimeDiagnostics<T>(
  callback: () => T,
  limits?: NativeRuntimeLimits,
): { result?: T; diagnostics: NativeRuntimeDiagnostics; error?: unknown } {
  const context: RuntimeContext = {
    debugMessages: [],
    stderr: [],
    limits: normalizeRuntimeLimits(limits),
    startMillis: Date.now(),
    steps: 0,
    outputs: 0,
    outputBytes: 0,
  };
  runtimeStack.push(context);

  try {
    return {
      result: callback(),
      diagnostics: {
        debugMessages: [...context.debugMessages],
        stderr: [...context.stderr],
        haltedExitCode: context.haltedExitCode,
      },
    };
  } catch (error) {
    return {
      diagnostics: {
        debugMessages: [...context.debugMessages],
        stderr: [...context.stderr],
        haltedExitCode: context.haltedExitCode,
      },
      error,
    };
  } finally {
    runtimeStack.pop();
  }
}

/**
 * Request-scoped values a program reads through the `params`, `actor` and
 * `instance` builtins: what the caller sent, who the caller is, and the
 * stored document the program is editing.
 *
 * These arrive ambiently rather than as jq variables because a native filter
 * is handed `(input, ...args)` and never sees the `Environment` — a builtin
 * has no other way to reach a value the host supplied. They are deliberately
 * not registry entries either: resolved registries are cached by library
 * name, so per-request data placed there would outlive the request and be
 * read by the next one.
 */
export interface NativeRequestContext {
  readonly params?: unknown;
  readonly actor?: unknown;
  readonly instance?: unknown;
}

const requestContextStack: NativeRequestContext[] = [];

/**
 * Scope `context` to one `callback`, which is the only way a program reaches
 * these values. Nesting is a stack, so the innermost scope wins and an
 * evaluation outside every scope sees no context at all — which the builtins
 * report as an error rather than as `null`.
 *
 * This stack is separate from the diagnostics frames {@link
 * withRuntimeDiagnostics} pushes, because the two have different lifetimes: a
 * host scopes a context around a whole call, and entry points inside that
 * call push diagnostics frames of their own. Carrying the context on those
 * frames would hide it from every evaluation that opens one.
 */
export function withRequestContext<T>(
  context: NativeRequestContext,
  callback: () => T,
): T {
  requestContextStack.push(context);
  let result: T;
  try {
    result = callback();
  } finally {
    requestContextStack.pop();
  }
  // The scope is a synchronous stack, so it is already unwound by the time a
  // deferred callback resumes or a lazy result is pulled: the evaluation would
  // read whatever context is current then, which for concurrent requests is
  // another request's. BXL evaluation is synchronous throughout and the
  // planner materializes each statement's outputs before returning, so
  // neither shape can arrive today — each is refused loudly rather than left
  // as a silent cross-request read for whoever first writes one.
  const deferred = deferredResultKind(result);
  if (deferred) {
    if (deferred === 'promise') {
      // The promise is abandoned, so nothing else will ever settle it. Left
      // alone, a rejection becomes an unhandled rejection that terminates the
      // process — after this throw has already been caught, which makes the
      // crash look unrelated to its cause. Claim it before throwing.
      void Promise.resolve(result as PromiseLike<unknown>).then(
        () => {},
        () => {},
      );
    }
    throw new JqEvaluateError(
      'withRequestContext scopes a request context synchronously and was ' +
        `given a callback that returned ${
          deferred === 'promise' ? 'a promise' : 'a lazy iterator'
        }. The context is unwound before that ` +
        `${deferred === 'promise' ? 'settles' : 'is drained'}, so the ` +
        "evaluation inside it would read another request's context.",
    );
  }
  return result;
}

/**
 * Whether a value defers its work past the call that produced it, and how.
 *
 * An iterator is checked for alongside a promise because this evaluator is
 * built on generators, which makes handing one back the likelier mistake of
 * the two. Arrays and strings are iterable without deferring anything, so the
 * test is for the iterator protocol itself — a `next` method — rather than
 * for iterability.
 */
function deferredResultKind(
  value: unknown,
): 'promise' | 'iterator' | undefined {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    return undefined;
  }
  const candidate = value as {
    then?: unknown;
    next?: unknown;
    [Symbol.iterator]?: unknown;
    [Symbol.asyncIterator]?: unknown;
  };
  if (typeof candidate.then === 'function') return 'promise';
  if (
    typeof candidate.next === 'function' &&
    (typeof candidate[Symbol.iterator] === 'function' ||
      typeof candidate[Symbol.asyncIterator] === 'function')
  ) {
    return 'iterator';
  }
  return undefined;
}

/** The innermost scoped request context, or `undefined` outside them all. */
export function currentRequestContext(): NativeRequestContext | undefined {
  return requestContextStack[requestContextStack.length - 1];
}

export function checkRuntimeBudget(units = 1) {
  const context = currentRuntimeContext();
  if (!context) {
    return;
  }

  if (context.limits.signal?.aborted) {
    throw new RuntimeLimitError(
      'signal',
      `BXL evaluation aborted${context.limits.signal.reason ? `: ${String(context.limits.signal.reason)}` : ''}`,
    );
  }

  context.steps += units;
  if (
    isFiniteLimit(context.limits.maxSteps) &&
    context.steps > context.limits.maxSteps
  ) {
    throw new RuntimeLimitError(
      'maxSteps',
      `BXL evaluation exceeded the ${context.limits.maxSteps} step runtime limit`,
    );
  }

  if (
    isFiniteLimit(context.limits.maxMillis) &&
    context.steps % 1024 === 0 &&
    Date.now() - context.startMillis > context.limits.maxMillis
  ) {
    throw new RuntimeLimitError(
      'maxMillis',
      `BXL evaluation exceeded the ${context.limits.maxMillis}ms runtime limit`,
    );
  }
}

export function recordRuntimeOutput(value: unknown) {
  const context = currentRuntimeContext();
  checkRuntimeBudget();
  if (!context) {
    return;
  }

  context.outputs++;
  if (
    isFiniteLimit(context.limits.maxOutputs) &&
    context.outputs > context.limits.maxOutputs
  ) {
    throw new RuntimeLimitError(
      'maxOutputs',
      `BXL evaluation exceeded the ${context.limits.maxOutputs} output runtime limit`,
    );
  }

  context.outputBytes += estimateOutputBytes(value);
  if (
    isFiniteLimit(context.limits.maxOutputBytes) &&
    context.outputBytes > context.limits.maxOutputBytes
  ) {
    throw new RuntimeLimitError(
      'maxOutputBytes',
      `BXL evaluation exceeded the ${context.limits.maxOutputBytes} byte output runtime limit`,
    );
  }
}

export function emitDebugMessage(message: string) {
  currentRuntimeContext()?.debugMessages.push(message);
}

export function emitStderrChunk(message: string) {
  currentRuntimeContext()?.stderr.push(message);
}

export function markHalted(exitCode: number) {
  const context = currentRuntimeContext();
  if (context) {
    context.haltedExitCode = exitCode;
  }
}

export function halt(exitCode: number): never {
  markHalted(exitCode);
  throw new HaltSignal(exitCode);
}

export function snapshotForDiagnostics<T>(value: T): T {
  return deepClone(value);
}
