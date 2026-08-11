import type { BoxelExecutionMode } from './boxel-runtime';

export const BOXEL_EXECUTION_PERFORMANCE_QUERY_PARAM =
  'boxelExecutionPerformance';

export type BoxelExecutionStage =
  | 'request'
  | 'source'
  | 'serialize'
  | 'card-api'
  | 'projection-settle'
  | 'classify'
  | 'materialize'
  | 'runtime-create'
  | 'render-record'
  | 'generation'
  | 'format-switch';

export type BoxelExecutionStageStatus = 'ok' | 'error' | 'obsolete';

export interface BoxelExecutionPerformanceContext {
  operationId: string;
  occurrenceId: string;
}

export interface BoxelExecutionStageStart extends BoxelExecutionPerformanceContext {
  stage: BoxelExecutionStage;
  tier?: BoxelExecutionMode;
}

export interface BoxelExecutionStageFinish {
  counters?: Readonly<Record<string, number>>;
  status?: BoxelExecutionStageStatus;
}

export interface BoxelExecutionStageRecord extends BoxelExecutionPerformanceContext {
  sequence: number;
  stage: BoxelExecutionStage;
  tier?: BoxelExecutionMode;
  status: BoxelExecutionStageStatus;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  counters?: Readonly<Record<string, number>>;
}

export interface BoxelExecutionPerformanceSnapshot {
  droppedRecords: number;
  records: readonly BoxelExecutionStageRecord[];
}

export interface BoxelExecutionStageToken {
  finish(options?: BoxelExecutionStageFinish): boolean;
}

type Clock = () => number;

/**
 * Bounded, data-only diagnostics for the execution runtime.
 *
 * This recorder is deliberately not part of BoxelRuntime. It observes the
 * Host's existing orchestration seams and cannot carry executable objects,
 * authority, card state, source text, or services across a boundary.
 */
export class BoxelExecutionPerformanceRecorder {
  private records: BoxelExecutionStageRecord[] = [];
  private nextSequence = 0;
  private droppedRecords = 0;
  private recording: boolean;

  constructor(
    enabled: boolean,
    private readonly maximumRecords = 1_000,
    private readonly now: Clock = monotonicNow,
  ) {
    if (!Number.isInteger(maximumRecords) || maximumRecords < 1) {
      throw new Error(
        'Execution performance recorder requires a positive bound',
      );
    }
    this.recording = enabled;
  }

  get enabled(): boolean {
    return this.recording;
  }

  enable(): void {
    this.recording = true;
  }

  disable(): void {
    this.recording = false;
  }

  start(input: BoxelExecutionStageStart): BoxelExecutionStageToken {
    if (!this.enabled) {
      return disabledStageToken;
    }
    let startedAt = this.now();
    let finished = false;
    return {
      finish: (options = {}) => {
        if (finished) {
          return false;
        }
        finished = true;
        let endedAt = this.now();
        this.append({
          ...input,
          sequence: ++this.nextSequence,
          status: options.status ?? 'ok',
          startedAt,
          endedAt,
          durationMs: Math.max(0, endedAt - startedAt),
          ...(options.counters
            ? { counters: cloneCounters(options.counters) }
            : {}),
        });
        return true;
      },
    };
  }

  reset(): void {
    this.records = [];
    this.droppedRecords = 0;
    this.nextSequence = 0;
  }

  snapshot(): BoxelExecutionPerformanceSnapshot {
    return {
      droppedRecords: this.droppedRecords,
      records: this.records.map((record) => ({
        ...record,
        ...(record.counters
          ? { counters: cloneCounters(record.counters) }
          : {}),
      })),
    };
  }

  private append(record: BoxelExecutionStageRecord): void {
    if (this.records.length === this.maximumRecords) {
      this.records.shift();
      this.droppedRecords++;
    }
    this.records.push(record);
  }
}

const disabledStageToken: BoxelExecutionStageToken = Object.freeze({
  finish: () => false,
});

function cloneCounters(
  counters: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  let clone: Record<string, number> = {};
  for (let [name, value] of Object.entries(counters)) {
    if (Number.isFinite(value)) {
      clone[name] = value;
    }
  }
  return Object.freeze(clone);
}

function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function diagnosticsRequested(): boolean {
  if (typeof globalThis.location === 'undefined') {
    return false;
  }
  return new URL(globalThis.location.href).searchParams.has(
    BOXEL_EXECUTION_PERFORMANCE_QUERY_PARAM,
  );
}

const recorder = new BoxelExecutionPerformanceRecorder(diagnosticsRequested());

export function startBoxelExecutionStage(
  input: BoxelExecutionStageStart,
): BoxelExecutionStageToken {
  return recorder.start(input);
}

export function boxelExecutionPerformanceEnabled(): boolean {
  return recorder.enabled;
}

export function boxelExecutionPerformanceSnapshot(): BoxelExecutionPerformanceSnapshot {
  return recorder.snapshot();
}

export function resetBoxelExecutionPerformance(): void {
  recorder.reset();
}

interface BoxelExecutionPerformanceDiagnostics {
  disable(): void;
  enable(): void;
  reset(): void;
  snapshot(): BoxelExecutionPerformanceSnapshot;
}

declare global {
  // Browser-smoke diagnostics only. The recorder remains inert until the
  // explicit performance query flag or `enable()` activates it.
  // eslint-disable-next-line no-var
  var __boxelExecutionPerformance:
    | BoxelExecutionPerformanceDiagnostics
    | undefined;
}

Object.defineProperty(globalThis, '__boxelExecutionPerformance', {
  configurable: true,
  value: Object.freeze({
    disable: () => recorder.disable(),
    enable: () => recorder.enable(),
    reset: () => recorder.reset(),
    snapshot: () => recorder.snapshot(),
  }),
});
