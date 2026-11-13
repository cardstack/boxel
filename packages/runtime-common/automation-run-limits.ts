// What an automation's declaration allows a run's calls (ADR 026 §1.3): the
// `callApi` operations it declares, and the per-run caps on `callApi` calls,
// the response bytes they read, and `resolve` calls. The realm server holds
// a run to them on every run-token call, read from the automation card as
// the index stores it, never by running the card's code.
//
// Each count is kept on the run row (`automation_runs`), next to the work it
// counts: a `callApi` call is counted just before it is sent, its response's
// bytes once they are read, and a `resolve` call just before it is forwarded.
// A call past a cap is refused, and the run ends as an error, reason
// `hit-a-cap`, naming the cap.
//
// The `writes` cap is the run overlay's: it rides the run token and bounds
// the files a run stages, and the commit adds the files it writes to the row.
// `seconds` is the run token's expiry, and `aiCredits` is
// `automation-ai-spending`'s reservation.

import {
  automationRef,
  readAutomationDeclaration,
  type AutomationCaps,
  type AutomationDeclaration,
  type AutomationOperationDeclaration,
} from './automation-declaration.ts';
import { getAutomation, type AutomationCapsSnapshot } from './automations.ts';
import {
  addAutomationRunCounts,
  countAutomationRunCall,
  endAutomationRunAtCap,
  getAutomationRun,
  type AutomationRunCallCounter,
} from './automation-runs.ts';
import type {
  CallApiRunMeter,
  CallApiRunAdmission,
  CallApiRunLogEntry,
} from './card-operations/call-api.ts';
import type { OperationError } from './card-operations/types.ts';
import { OperationFailure } from './card-operations/types.ts';
import type { DBAdapter } from './db.ts';
import type { DefinitionLookup } from './definition-lookup.ts';
import { internalKeyFor } from './index.ts';
import { logger } from './log.ts';
import {
  logRunPlatformLine,
  maskedRunLogURL,
  type RunLogLine,
} from './automation-run-log.ts';
import { IndexQueryEngine } from './index-query-engine.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';

const log = logger('automation-run-limits');

// The run a run-token call belongs to, as its admission named it.
export interface LimitedRun {
  runId: string;
  attempt: number;
  automationId: RealmResourceIdentifier;
}

export type RunDeclarationRead =
  | { ok: true; declaration: AutomationDeclaration }
  | { ok: false; message: string };

// The automation's declaration, read from its card's live index row. A card
// that isn't indexed, failed to index, or doesn't read as an automation
// declares nothing, so a run of it may make no call its declaration governs.
export async function readRunDeclaration({
  dbAdapter,
  definitionLookup,
  virtualNetwork,
  automationId,
}: {
  dbAdapter: DBAdapter;
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
  automationId: RealmResourceIdentifier;
}): Promise<RunDeclarationRead> {
  let cardURL = virtualNetwork.toURLHref(automationId);
  let engine = new IndexQueryEngine(
    dbAdapter,
    definitionLookup,
    virtualNetwork,
  );
  let card = await engine.getInstanceSource(new URL(cardURL));
  if (!card || !card.instance || card.failureWithheld) {
    return {
      ok: false,
      message: `the automation card ${automationId} has no indexed document to read its declaration from`,
    };
  }
  let read = readAutomationDeclaration(
    {
      url: automationId,
      realmURL: card.realmURL,
      types: card.types,
      instance: card.instance,
    },
    {
      automationTypeKey: internalKeyFor(
        automationRef,
        undefined,
        virtualNetwork,
      ),
      virtualNetwork,
    },
  );
  if (!read.ok) {
    return {
      ok: false,
      message: `the automation card ${automationId} doesn't read as an automation: ${read.problems
        .map(({ path, message }) => (path ? `${path}: ${message}` : message))
        .join('; ')}`,
    };
  }
  return { ok: true, declaration: read.declaration };
}

// What a run is held to: the operations its automation declares, and the
// per-run caps. Each cap is the card's, but never more than the automation's
// caps snapshot, what its payer agreed to when they switched it on or last
// resumed it. Raising a cap pauses the automation, which stops new runs, but
// a run already going reads the card as it is now, so the snapshot is what
// keeps that run to what was agreed. A run of an automation with no row (a
// Preview) is held to the card's caps.
export interface RunLimits {
  operations: AutomationOperationDeclaration[];
  caps: AutomationCaps;
}

export type RunLimitsRead =
  | ({ ok: true } & RunLimits)
  | { ok: false; message: string };

export async function readRunLimits(args: {
  dbAdapter: DBAdapter;
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
  automationId: RealmResourceIdentifier;
}): Promise<RunLimitsRead> {
  let read = await readRunDeclaration(args);
  if (!read.ok) {
    return read;
  }
  let { operations, caps } = read.declaration;
  let row = await getAutomation(args.dbAdapter, args.automationId);
  return {
    ok: true,
    operations,
    caps: row ? withinSnapshot(caps, row.capsSnapshot) : caps,
  };
}

function withinSnapshot(
  caps: AutomationCaps,
  snapshot: AutomationCapsSnapshot,
): AutomationCaps {
  let lower = (card: number, agreed: number | undefined) =>
    typeof agreed === 'number' ? Math.min(card, agreed) : card;
  return {
    ...caps,
    callApiCalls: lower(caps.callApiCalls, snapshot.callApiCalls),
    responseBytes: lower(caps.responseBytes, snapshot.responseBytes),
    resolveCalls: lower(caps.resolveCalls, snapshot.resolveCalls),
    aiCredits: lower(caps.aiCredits, snapshot.aiCredits),
    writes: lower(caps.writes, snapshot.writes),
    seconds: lower(caps.seconds, snapshot.seconds),
  };
}

// Whether the declared operations name `operation` on `type`, the type the
// operation was resolved on. Both sides are compared as `internalKeyFor`
// spells them, so a declaration in prefix form matches a type resolved to a
// URL, and the reverse.
export function declaresOperation(
  operations: readonly AutomationOperationDeclaration[],
  type: { module: string; name: string },
  operation: string,
  virtualNetwork: VirtualNetwork,
): boolean {
  let key = internalKeyFor(
    { module: type.module as RealmResourceIdentifier, name: type.name },
    undefined,
    virtualNetwork,
  );
  return operations.some(
    (declared) =>
      declared.operation === operation &&
      internalKeyFor(declared.targetType, undefined, virtualNetwork) === key,
  );
}

// The refusal of a call past one of the run's caps. The run has already
// ended when it is raised.
export function runCapReached(cap: string): OperationError {
  return {
    status: 403,
    code: 'run-cap-reached',
    title: 'Run cap reached',
    detail: `The automation run hit its ${cap} cap, so the run has ended`,
    meta: { cap },
  };
}

// Counts one call of a run against its cap on `counter`. A call past the cap
// ends the run and is refused with `runCapReached`; a run that is no longer
// running is refused as one.
export async function countRunCall(
  dbAdapter: DBAdapter,
  run: LimitedRun,
  counter: AutomationRunCallCounter,
  cap: number,
): Promise<{ ok: true } | { ok: false; error: OperationError }> {
  let count = await countAutomationRunCall(
    dbAdapter,
    run.runId,
    run.attempt,
    counter,
    cap,
  );
  switch (count.kind) {
    case 'counted':
      return { ok: true };
    case 'over-cap':
      await endRunAtCap(dbAdapter, run, counter);
      return { ok: false, error: runCapReached(counter) };
    case 'not-running':
    case 'missing':
      return { ok: false, error: runNotRunning() };
  }
}

export async function endRunAtCap(
  dbAdapter: DBAdapter,
  run: LimitedRun,
  cap: string,
): Promise<void> {
  let ended = await endAutomationRunAtCap(
    dbAdapter,
    run.runId,
    run.attempt,
    cap,
  );
  log.info(
    ended
      ? `run ${run.runId} attempt ${run.attempt} of ${run.automationId} hit its ${cap} cap and ended`
      : `run ${run.runId} attempt ${run.attempt} of ${run.automationId} hit its ${cap} cap after it stopped running`,
  );
  if (ended) {
    await logRunPlatformLine(dbAdapter, run.runId, {
      kind: 'cap',
      level: 'error',
      message: `The run reached its ${cap} cap and ended`,
      data: { cap },
    });
  }
}

function runNotRunning(): OperationError {
  return {
    status: 401,
    code: 'run-not-running',
    title: 'Run not running',
    detail: 'The automation run is not running',
  };
}

// Holds one run-token request's `callApi` calls to the automation's
// declaration and the run's caps. The declaration is read once per request,
// the first time a call needs it.
export function automationRunCallApiMeter({
  dbAdapter,
  definitionLookup,
  virtualNetwork,
  run,
}: {
  dbAdapter: DBAdapter;
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
  run: LimitedRun;
}): CallApiRunMeter {
  let limits: Promise<RunLimitsRead> | undefined;
  let declared = async (): Promise<RunLimits> => {
    let read = await (limits ??= readRunLimits({
      dbAdapter,
      definitionLookup,
      virtualNetwork,
      automationId: run.automationId,
    }));
    if (!read.ok) {
      log.warn(`run ${run.runId}'s callApi refused: ${read.message}`);
      throw new OperationFailure({
        status: 403,
        code: 'operation-not-declared',
        title: 'Operation not declared',
        detail: `The automation's declaration can't be read, so its run may call no outside service`,
      });
    }
    return { operations: read.operations, caps: read.caps };
  };
  return {
    async checkDeclared(type, operation) {
      let { operations } = await declared();
      if (
        !type ||
        !declaresOperation(operations, type, operation, virtualNetwork)
      ) {
        log.warn(
          `run ${run.runId}'s callApi refused: ${run.automationId} doesn't declare operation "${operation}"${type ? ` on ${type.module}/${type.name}` : ''}`,
        );
        throw new OperationFailure({
          status: 403,
          code: 'operation-not-declared',
          title: 'Operation not declared',
          detail: `The automation doesn't declare operation "${operation}"${type ? ` on ${type.name}` : ''}, so its run may not call it`,
          meta: { operation },
        });
      }
    },
    async admitCall(): Promise<CallApiRunAdmission> {
      let { caps } = await declared();
      // A response can't be read once the run has read its cap's worth, so
      // a run with none left is stopped before its call counts.
      let current = await getAutomationRun(dbAdapter, run.runId);
      if (current && current.callApiResponseBytes >= caps.responseBytes) {
        await endRunAtCap(dbAdapter, run, 'responseBytes');
        throw new OperationFailure(runCapReached('responseBytes'));
      }
      let counted = await countRunCall(
        dbAdapter,
        run,
        'callApiCalls',
        caps.callApiCalls,
      );
      if (!counted.ok) {
        throw new OperationFailure(counted.error);
      }
      return {
        responseByteBudget: Math.max(
          0,
          caps.responseBytes - (current?.callApiResponseBytes ?? 0),
        ),
      };
    },
    async recordResponse(bytes, budgetReached) {
      if (bytes > 0) {
        await addAutomationRunCounts(dbAdapter, run.runId, {
          callApiResponseBytes: bytes,
        });
      }
      if (budgetReached) {
        await endRunAtCap(dbAdapter, run, 'responseBytes');
        return runCapReached('responseBytes');
      }
      return undefined;
    },
    async logCall(call) {
      await logRunPlatformLine(dbAdapter, run.runId, callApiLogLine(call));
    },
  };
}

// A `callApi` call as its line in the run's log: the operation, the request's
// method and destination with its query values masked, and the vendor's
// status, time and size, or why it was refused or failed.
export function callApiLogLine(
  call: CallApiRunLogEntry,
): Omit<RunLogLine, 'source' | 'at'> {
  let destination = call.url
    ? ` ${call.method ? `${call.method} ` : ''}${maskedRunLogURL(call.url)}`
    : '';
  let measured = [
    ...(call.ms !== undefined ? [`${call.ms} ms`] : []),
    ...(call.bytes !== undefined ? [`${call.bytes} bytes`] : []),
  ].join(', ');
  let outcome =
    call.status !== undefined
      ? `${call.status}${measured ? ` in ${measured}` : ''}`
      : `${call.code === 'failed' ? 'failed' : `refused (${call.code})`}${call.detail ? `: ${call.detail}` : ''}${measured ? ` after ${measured}` : ''}`;
  return {
    kind: 'call-api',
    level:
      call.status === undefined
        ? 'error'
        : call.status >= 400
          ? 'warn'
          : 'info',
    message: `callApi ${call.operation}${destination}: ${outcome}`,
    data: {
      operation: call.operation,
      ...(call.method ? { method: call.method } : {}),
      ...(call.url ? { destination: maskedRunLogURL(call.url) } : {}),
      ...(call.status !== undefined ? { status: call.status } : {}),
      ...(call.code ? { code: call.code } : {}),
      ...(call.ms !== undefined ? { ms: call.ms } : {}),
      ...(call.bytes !== undefined ? { bytes: call.bytes } : {}),
    },
  };
}
