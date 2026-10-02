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

// ============================================================================
// Per-request telemetry for a capability check.
//
// On the same channel as an execution, because a check is a gate decision like
// any other and an operator reading policy reach wants both in one place. It
// carries `kind`, which an execution's line does not, so a panel built to show
// realm-authorized callers reaching the policy path excludes checks on that
// field alone. Without it every rendered button would count as policy reach,
// which would make the panel report the shape of a template rather than the
// shape of the traffic.
//
// One line per request rather than one per pair: a check is asked in bulk, a
// per-pair line would put a view's whole render into the log at the rate the
// view re-renders, and the counts below are what a panel plots anyway. The
// pairs themselves are not recorded — a line naming which cards a caller asked
// about would put in the log exactly what the bare-boolean rule keeps off the
// wire.
// ============================================================================

export interface CapabilityCheckEvent {
  kind: 'capability-check';
  realmURL: string;
  // The authenticated caller, as `actor()` resolves it. Null where the request
  // authenticated nobody.
  actor: string | null;
  // What the realm ACL declined this caller, which is what decides whether any
  // of the pairs reached the policy at all.
  coarseDeclined: 'none' | 'writes' | 'all';
  pairs: number;
  allowed: number;
  conditional: number;
  denied: number;
  totalMs: number;
}

let capabilityCheckSink: ((event: CapabilityCheckEvent) => void) | undefined;

export function setCapabilityCheckSink(
  sink: ((event: CapabilityCheckEvent) => void) | undefined,
): void {
  capabilityCheckSink = sink;
}

let capabilityCheckLog: ReturnType<typeof logger> | undefined;

export function emitCapabilityCheck(event: CapabilityCheckEvent): void {
  if (capabilityCheckSink) {
    capabilityCheckSink(event);
    return;
  }
  (capabilityCheckLog ??= logger(OPERATIONS_CHANNEL)).info(
    JSON.stringify({ channel: OPERATIONS_CHANNEL, ...event }),
  );
}

// ============================================================================
// Per-evaluation telemetry for a policy predicate judged against a snapshot.
//
// A predicate annotated `snapshot: true` reads the target's computed values or
// its linked cards' values from the index, which lags the card's stored
// source. Each such grant is a window, measured in index latency, during which
// a card that no longer satisfies the predicate is still admitted. This record
// is what lets an operator count the windows a realm has accepted: one line
// each time such a predicate decides an invocation, at the gate or under the
// write lock.
//
// A capability check records nothing, and neither does a prediction of what
// the lock would decide, such as what a refused caller may be told: neither
// decides anything, and a view asks a capability check at the rate it
// renders. An explain decides nothing either. Its
// evaluation at the gate is recorded with `hypothetical` set, so a panel can
// leave it out.
//
// No card content, no target, and no predicate source: the rule's type and the
// grant's place in the policy card say which window was used.
// ============================================================================

export interface PolicySnapshotReadEvent {
  kind: 'policy-snapshot-read';
  realmURL: string;
  // The caller the predicate was judged for, as `actor()` resolves it. Null
  // where the request authenticated nobody.
  actor: string | null;
  // The operation the grant admits.
  operation: string;
  // The type the grant's rule governs.
  targetType: { module: string; name: string };
  // Where the grant is in the policy card, as `rules[2].grants[1]`.
  grant: string;
  // Where the predicate decided: at the gate, for a read, or under the write
  // lock, for a write.
  decidedAt: 'gate' | 'lock';
  outcome: 'held' | 'did-not-hold' | 'threw';
  // Whether the target had an index row to read. A predicate judged against
  // a card with none does not hold.
  indexed: boolean;
  // Set for an explain, which runs the gate for a named actor rather than for
  // a caller.
  hypothetical: boolean;
}

let policySnapshotReadSink:
  | ((event: PolicySnapshotReadEvent) => void)
  | undefined;

export function setPolicySnapshotReadSink(
  sink: ((event: PolicySnapshotReadEvent) => void) | undefined,
): void {
  policySnapshotReadSink = sink;
}

let policySnapshotReadLog: ReturnType<typeof logger> | undefined;

export function emitPolicySnapshotRead(event: PolicySnapshotReadEvent): void {
  if (policySnapshotReadSink) {
    policySnapshotReadSink(event);
    return;
  }
  (policySnapshotReadLog ??= logger(OPERATIONS_CHANNEL)).info(
    JSON.stringify({ channel: OPERATIONS_CHANNEL, ...event }),
  );
}

// ============================================================================
// Per-decision telemetry for the policy gate.
//
// One line each time the gate decides an invocation for a caller the realm ACL
// declined: at the gate for a read, and for a write the gate admits or refuses
// outright; under the write lock for a write the gate left to it. A caller the
// ACL allowed is never judged by the policy and records nothing, so the rate
// of these lines is the rate callers reach the policy at all — the gate-reach
// signal — and a realm whose callers are all realm-authorized should show
// none.
//
// A capability check records no decision: it asks what the gate would decide,
// at the rate a view renders, and its own `capability-check` line counts it.
// An explain's decisions are recorded with `hypothetical` set, since it runs
// the gate for an actor it names rather than for a caller, and a panel counting
// what callers were decided leaves those out.
//
// No card content, no target and no predicate source. The rule and grant
// positions say which part of the policy decided; the policy card says what
// that part holds.
// ============================================================================

// What reached the gate: the request surface an invocation arrived on, and the
// route on it. `internal` is a dispatch made by the realm itself, which names
// no surface.
export type PolicyTransport =
  | 'envelope'
  | 'card-json'
  | 'byte-route'
  | 'explain'
  | 'internal';

export interface PolicyRoute {
  transport: PolicyTransport;
  // The method or route on that surface: `GET`, `HEAD`, `POST`, `PATCH`,
  // `DELETE`, `source`, `module`, `_operations`. Open-ended, since it only
  // labels a panel's series.
  route: string;
}

export const INTERNAL_ROUTE: PolicyRoute = Object.freeze({
  transport: 'internal' as const,
  route: 'internal',
});

// Why the gate decided as it did. A refusal before any predicate ran names the
// rule it refused under, as an explain reports it (`GateTraceRefusal`);
// `predicate` is a refusal no evaluated predicate admitted; `target-missing`
// is a card the index holds no row for; `stored-card-refused` is a write whose
// card the lock found gone, stored as a type other than the one its grants
// were matched on, or stored as a policy card; `policy-unavailable` is a realm whose policy did not compile;
// `predicate-threw` is a fault in a predicate, which the caller may have been
// told as a 404; `gate-failed` is any other failure while deciding.
export type PolicyDecisionReason =
  | 'granted'
  | 'pending'
  | 'non-grantable'
  | 'query-lane'
  | 'authorization-infrastructure'
  | 'unmatchable-target'
  | 'no-grant'
  | 'predicate'
  | 'target-missing'
  | 'stored-card-refused'
  | 'policy-unavailable'
  | 'predicate-threw'
  | 'gate-failed';

export interface PolicyDecisionEvent {
  kind: 'policy-decision';
  realmURL: string;
  // The caller the gate decided for, as `actor()` resolves it. Null where the
  // request authenticated nobody.
  actor: string | null;
  // The name the operation was invoked under, and the behavior it builds on.
  // `base` is null where the decision was made before the operation resolved:
  // a policy that could not be loaded, for a caller who may not read the
  // realm, is answered before anything about the target is read.
  operation: string;
  base: string | null;
  // The type key the grants were matched on: the target's own type, or the
  // type a create mints. Null where the gate refused before typing it.
  targetType: string | null;
  transport: PolicyTransport;
  route: string;
  // What the realm ACL declined the caller: their writes, or everything.
  coarseDeclined: 'writes' | 'all';
  // Where this decision was made. A write the gate left to the lock records a
  // `pending` decision at the gate and its final one under the lock.
  decidedAt: 'gate' | 'lock';
  outcome: 'allow' | 'deny' | 'error' | 'pending';
  reason: PolicyDecisionReason;
  // The rule and grant that admitted the invocation, as `rules[2]` and
  // `rules[2].grants[1]`. Null for anything but an allow.
  rule: string | null;
  grant: string | null;
  // Every rule matched on the target's type, and every grant in them for the
  // operation, comma-separated in policy order. What a denial was judged by.
  rules: string;
  grants: string;
  // The tier the predicates evaluated read: `none` where no predicate ran,
  // `stored` for the card's stored source, `snapshot` where any read the
  // index snapshot (Tier 1 or 2).
  tier: 'none' | 'stored' | 'snapshot';
  // How many predicates ran, and how long they took between them. The rest of
  // `evaluationMs` is matching, typing the target and reading its source.
  predicates: number;
  predicateMs: number;
  // The whole decision, from the gate's entry to its answer.
  evaluationMs: number;
  // Set for an explain, which decides nothing.
  hypothetical: boolean;
}

let policyDecisionSink: ((event: PolicyDecisionEvent) => void) | undefined;

export function setPolicyDecisionSink(
  sink: ((event: PolicyDecisionEvent) => void) | undefined,
): void {
  policyDecisionSink = sink;
}

let policyDecisionLog: ReturnType<typeof logger> | undefined;

export function emitPolicyDecision(event: PolicyDecisionEvent): void {
  if (policyDecisionSink) {
    policyDecisionSink(event);
    return;
  }
  (policyDecisionLog ??= logger(OPERATIONS_CHANNEL)).info(
    JSON.stringify({ channel: OPERATIONS_CHANNEL, ...event }),
  );
}

// ============================================================================
// Per-realm telemetry for a search a policy scopes.
//
// A search never passes the gate: each realm it reaches only through its
// policy composes the filters that policy's query grants admit into the
// search. That is a decision too, and the one that decides the most cards, so
// it is recorded once per realm a search consults: `scoped` with the grants
// that contributed a filter, `none` where none did, `failed` where the policy
// could not be judged. A realm the caller reads coarsely is never consulted,
// and records nothing.
// ============================================================================

export interface PolicySearchScopeEvent {
  kind: 'policy-search-scope';
  realmURL: string;
  actor: string | null;
  // The named query, or `query` for an ad-hoc search.
  operation: string;
  // The anchor types the search names, as `module/name`, comma-separated.
  types: string;
  transport: 'search' | 'federated-search' | 'envelope' | 'explain';
  outcome: 'scoped' | 'none' | 'failed';
  // The rules and grants that contributed a filter, comma-separated in policy
  // order. Empty for anything but `scoped`.
  rules: string;
  grants: string;
  evaluationMs: number;
  hypothetical: boolean;
}

let policySearchScopeSink:
  | ((event: PolicySearchScopeEvent) => void)
  | undefined;

export function setPolicySearchScopeSink(
  sink: ((event: PolicySearchScopeEvent) => void) | undefined,
): void {
  policySearchScopeSink = sink;
}

let policySearchScopeLog: ReturnType<typeof logger> | undefined;

export function emitPolicySearchScope(event: PolicySearchScopeEvent): void {
  if (policySearchScopeSink) {
    policySearchScopeSink(event);
    return;
  }
  (policySearchScopeLog ??= logger(OPERATIONS_CHANNEL)).info(
    JSON.stringify({ channel: OPERATIONS_CHANNEL, ...event }),
  );
}

// ============================================================================
// Per-compile telemetry for a realm's policy.
//
// One line each time a realm's policy cache reads its policy card: a compile,
// or a revalidation that found the compiled policy still current. A policy
// that did not compile as a whole refuses every caller the realm reaches only
// through it, so `uncompilable` is what an operator counts per realm, and the
// durations are what a compile costs the request that waited on it.
// ============================================================================

export interface PolicyCompileEvent {
  kind: 'policy-compile';
  realmURL: string;
  // The policy card the realm's pointer names.
  card: string;
  outcome: 'compiled' | 'revalidated';
  uncompilable: boolean;
  rules: number;
  grants: number;
  issues: number;
  durationMs: number;
}

let policyCompileSink: ((event: PolicyCompileEvent) => void) | undefined;

export function setPolicyCompileSink(
  sink: ((event: PolicyCompileEvent) => void) | undefined,
): void {
  policyCompileSink = sink;
}

let policyCompileLog: ReturnType<typeof logger> | undefined;

export function emitPolicyCompile(event: PolicyCompileEvent): void {
  if (policyCompileSink) {
    policyCompileSink(event);
    return;
  }
  (policyCompileLog ??= logger(OPERATIONS_CHANNEL)).info(
    JSON.stringify({ channel: OPERATIONS_CHANNEL, ...event }),
  );
}

// Elapsed milliseconds since `started`, a `performance.now()` reading, to the
// hundredth. A decision is commonly well under a millisecond, which a whole
// number would report as nothing.
export function elapsedMs(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}
