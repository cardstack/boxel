import { logger } from '../log.ts';
import type { BaseOperation, OperationErrorCode } from './types.ts';

// ============================================================================
// Per-execution telemetry for an operation that runs a program.
//
// One JSON-object log line per execution on the `boxel:operations` channel —
// the same emit convention as `boxel:client-perf` and `boxel:capture-perf`:
// the whole line is one JSON object carrying an explicit `channel` field, so
// Loki's `| json` parse reads it, and the counts and the duration are flat
// top-level fields so LogQL can `unwrap` any of them directly.
//
// The same record — minus the fields that describe the realm rather than the
// invocation — rides back on the result as `meta.diagnostics`, so a caller can
// see what its own invocation read without going to the logs. Which is the
// point of recording it at all: an operation reads values from three places
// and only one of them is the card's own stored document, so "this program
// read a stale value" and "this program read nothing at all" are otherwise
// indistinguishable from the outside.
// ============================================================================

// Where a value a program read came from. `stored` is the card's own source
// file, the only authoritative layer; the other two are index snapshots, which
// lag the file and can be absent entirely.
export type OperationReadLayer = 'stored' | 'computed' | 'linked';

// Why a snapshot layer had no value at a path: the card has no clean index row
// at all, the value sits behind a link the author did not mark `searchable`,
// or the row is there and simply carries no key for it.
export type OperationMissingReason =
  | 'not-indexed'
  | 'not-searchable'
  | 'key-absent';

// One value a program asked for that no layer could supply.
export interface OperationMissingRead {
  path: string;
  // Never `stored`: the stored document is always there, so a path it holds
  // nothing at is an empty value rather than a missing one.
  layer: Exclude<OperationReadLayer, 'stored'>;
  reason: OperationMissingReason;
}

// What one execution did, as both the log line and the result's diagnostics
// carry it.
export interface OperationDiagnostics {
  // The name the operation was invoked under, which is what an author reads it
  // by. Never the base behavior — a `donate` built on `transform` is reported
  // as `donate`, with `base` alongside it.
  operation: string;
  base: BaseOperation;
  target: string;
  outcome: OperationOutcome;
  // Present only on a refusal, naming what the caller is told.
  code?: OperationErrorCode;
  totalMs: number;
  // One count per layer, over every read the program's expressions resolved.
  // A write location is not a read: it reports through the plan's intents, so
  // a program that only assigns reports no reads at all.
  storedReads: number;
  computedReads: number;
  linkedReads: number;
  missingCount: number;
  missing: OperationMissingRead[];
}

export type OperationOutcome =
  // The program produced a document different from the stored one.
  | 'applied'
  // The program ran and changed nothing, so the card keeps the version it
  // already had.
  | 'unchanged'
  // The operation was refused; nothing was staged.
  | 'refused';

export interface OperationPerfEvent extends OperationDiagnostics {
  realmURL: string;
  // The authenticated caller, as `actor()` resolves it. Null where the
  // invocation named none.
  actor: string | null;
}

export const OPERATIONS_CHANNEL = 'boxel:operations';

// Test seam, mirroring `emitCapturePerf`'s sink: when set, events go to the
// sink instead of the logger, so a test asserts on records rather than
// scraping stdout.
let operationPerfSink: ((event: OperationPerfEvent) => void) | undefined;

export function setOperationPerfSink(
  sink: ((event: OperationPerfEvent) => void) | undefined,
): void {
  operationPerfSink = sink;
}

// Created lazily: a module-scope `logger()` here can race the circular import
// that installs the log-definitions factory, the same hazard
// `emitCapturePerf` documents.
let operationPerfLog: ReturnType<typeof logger> | undefined;

export function emitOperationPerf(event: OperationPerfEvent): void {
  if (operationPerfSink) {
    operationPerfSink(event);
    return;
  }
  (operationPerfLog ??= logger(OPERATIONS_CHANNEL)).info(
    JSON.stringify({ channel: OPERATIONS_CHANNEL, ...event }),
  );
}

// Tally the reads one execution resolved, and the ones no layer answered.
// Handed to the executor as a sink it can pass straight to the program runner,
// so counting is one place rather than one per call site.
export class OperationReadTally {
  #counts: Record<OperationReadLayer, number> = {
    stored: 0,
    computed: 0,
    linked: 0,
  };
  #missing: OperationMissingRead[] = [];
  #seen = new Set<string>();

  // One resolved read, in the layer vocabulary the program runner reports.
  record(
    path: string,
    layer: OperationReadLayer,
    unavailable: OperationMissingReason | undefined,
  ): void {
    this.#counts[layer]++;
    if (!unavailable || layer === 'stored') {
      return;
    }
    // A program can read one path many times — once per statement that names
    // it — and the same absence reported twice says nothing the first did not.
    let key = `${layer}:${path}`;
    if (this.#seen.has(key)) {
      return;
    }
    this.#seen.add(key);
    this.#missing.push({ path, layer, reason: unavailable });
  }

  get counts(): Readonly<Record<OperationReadLayer, number>> {
    return this.#counts;
  }

  get missing(): readonly OperationMissingRead[] {
    return this.#missing;
  }
}
