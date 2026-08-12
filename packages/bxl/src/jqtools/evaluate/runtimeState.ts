import { deepClone } from './utils/utils.js';
import { JqEvaluateError } from '../errors.js';

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
  constructor(public readonly exitCode: number) {
    super(`jq halted with exit code ${exitCode}`);
    this.name = 'HaltSignal';
  }
}

export class RuntimeLimitError extends JqEvaluateError {
  constructor(
    public readonly limit: keyof Required<Omit<NativeRuntimeLimits, 'signal'>> | 'signal',
    message: string,
  ) {
    super(message);
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
