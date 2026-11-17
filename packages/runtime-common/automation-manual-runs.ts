// Preview and Run now: a direct writer starts a run of an automation at once,
// acting as and charged to themselves, whether or not the automation is
// switched on. A Preview runs the script, stages its writes and stops before
// the commit, so the realm is left as it was and the run keeps the batch it
// would have written. Run now does the same and commits.
//
// Both make an ordinary run row, slotted by the click, and enqueue it as the
// automation command's job (`enqueueAutomationRunJob`). So a worker runs it
// exactly as it runs a scheduled run, through `runAutomationAttempt`: every
// check that makes before a run starts applies to it, as do the caps, the
// concurrency group and the priority. They move through pending, running,
// complete or error, and `readAutomationRunReport` answers where a run is:
// its state, log, timings, cost and the files it staged or saved.

import {
  MANUAL_RUN_TRIGGER,
  type AutomationDeclaration,
} from './automation-declaration.ts';
import { readRunLog, type RunLog } from './automation-run-log.ts';
import {
  getAutomationRun,
  insertOrFindAutomationRun,
  type AutomationRun,
} from './automation-runs.ts';
import {
  isDeclarationOf,
  isDirectWriterOf,
  type AutomationActorOptions,
} from './automations.ts';
import type { DBAdapter } from './db.ts';
import { dbAdapterQuerier, param, query } from './expression.ts';
import { ensureTrailingSlash } from './index.ts';
import { enqueueAutomationRunJob } from './jobs/run-command.ts';
import { emitAutomationRunEvent } from './automation-run-telemetry.ts';
import { RealmPaths } from './paths.ts';
import type { Job, QueuePublisher } from './queue.ts';
import { fromBase64 } from './run-overlay.ts';
import type {
  RealmIdentifier,
  RealmResourceIdentifier,
} from './realm-identifiers.ts';
import type { RunCommandResponse } from './index.ts';

export { MANUAL_RUN_TRIGGER };

export interface ManualRunRequest {
  automationId: RealmResourceIdentifier;
  // The realm the automation is in, which the clicker must directly write.
  realm: RealmIdentifier;
  // The Matrix user id of whoever clicked: the run acts as them and is
  // charged to them.
  user: string;
  // The click's id, unique per click. Sending the same click again answers
  // the run it started rather than starting another.
  click: string;
  // The automation's card, as `readAutomationDeclaration` read it.
  declaration: AutomationDeclaration;
}

// A Preview or Run now was refused:
//
// - `not-a-direct-writer`: the clicker isn't a direct writer of the realm.
// - `outside-realm`: the automation isn't in the realm named.
// - `other-card`: the declaration given is another card's.
// - `click-reused`: the click already started a run for someone else, or a
//   run of the other kind.
export type ManualRunRefusal = {
  ok: false;
  reason:
    | 'not-a-direct-writer'
    | 'outside-realm'
    | 'other-card'
    | 'click-reused';
};

export type ManualRunStart =
  | {
      ok: true;
      run: AutomationRun;
      // The run's job, when this call enqueued it: a run that has already
      // finished isn't enqueued again.
      job?: Job<RunCommandResponse>;
    }
  | ManualRunRefusal;

export interface ManualRunContext {
  dbAdapter: DBAdapter;
  queue: QueuePublisher;
}

// Starts a Preview of the automation for its clicker.
export async function startAutomationPreview(
  ctx: ManualRunContext,
  request: ManualRunRequest,
  options: AutomationActorOptions,
): Promise<ManualRunStart> {
  return await startManualRun(ctx, request, true, options);
}

// Starts a run of the automation that commits, for its clicker.
export async function startAutomationRunNow(
  ctx: ManualRunContext,
  request: ManualRunRequest,
  options: AutomationActorOptions,
): Promise<ManualRunStart> {
  return await startManualRun(ctx, request, false, options);
}

async function startManualRun(
  { dbAdapter, queue }: ManualRunContext,
  { automationId, realm, user, click, declaration }: ManualRunRequest,
  dryRun: boolean,
  options: AutomationActorOptions,
): Promise<ManualRunStart> {
  if (!new RealmPaths(realm, options.virtualNetwork).inRealm(automationId)) {
    return { ok: false, reason: 'outside-realm' };
  }
  if (!isDeclarationOf(declaration, automationId, options)) {
    return { ok: false, reason: 'other-card' };
  }
  // Whether this click created the run, rather than a resent click finding
  // the run the first send created. Only the first send's enqueue is the
  // run's `enqueued` telemetry.
  let created = false;
  let started = await dbAdapter.withTransaction(
    async (txQuery): Promise<ManualRunStart> => {
      created = false;
      if (!(await isDirectWriterOf(txQuery, realm, user, options))) {
        return { ok: false, reason: 'not-a-direct-writer' };
      }
      let inserted = await insertOrFindAutomationRun(txQuery, {
        automationId,
        realm,
        trigger: MANUAL_RUN_TRIGGER,
        slot: click,
        actsAs: user,
        dryRun,
      });
      let { run } = inserted;
      created = inserted.created;
      if (run.actsAs !== user || run.dryRun !== dryRun) {
        return { ok: false, reason: 'click-reused' };
      }
      return { ok: true, run };
    },
  );
  if (!started.ok || started.run.state !== 'pending') {
    return started;
  }
  let { run } = started;
  // A second send of the same click joins the job the first enqueued, since
  // the job's key is the run's.
  let job = await enqueueAutomationRunJob(queue, {
    automationId,
    realmURL: ensureTrailingSlash(options.virtualNetwork.toURLHref(realm)),
    actsAs: user,
    trigger: run.trigger,
    slot: run.slot,
    secondsCap: declaration.caps.seconds,
    input: {
      runId: run.id,
      scheduledAt: run.createdAt,
      dryRun,
      triggerKind: 'manual',
    },
  });
  if (created) {
    let enqueuedAt = new Date().toISOString();
    emitAutomationRunEvent({
      kind: 'enqueued',
      automation: automationId,
      run: run.id,
      job: job.id,
      realm,
      trigger: run.trigger,
      triggerKind: 'manual',
      dryRun,
      scheduledAt: run.createdAt,
      enqueuedAt,
      scheduleLagMs: Math.max(
        0,
        Date.parse(enqueuedAt) - Date.parse(run.createdAt),
      ),
    });
  }
  await options.reportRunChange?.(run.id);
  return { ok: true, run, job };
}

// A file a Preview staged, as its report lists it. Its bytes come from
// `readAutomationPreviewFile`.
export interface StagedRunFile {
  // Realm-local.
  path: string;
  size: number;
}

export interface AutomationRunTimings {
  createdAt: string;
  startedAt: string | null;
  commitStartedAt: string | null;
  committedAt: string | null;
  finishedAt: string | null;
  // ms waiting in the queue, from enqueue to the first start.
  queuedMs: number | null;
  // ms from the first start to the finish.
  runMs: number | null;
  // ms from claiming the commit to the batch landing.
  commitMs: number | null;
}

export interface AutomationRunCost {
  // Credits the ledger holds for the run, by charge kind (`ai`, `run`,
  // `run_indexing`, `batched_ai`), and together.
  credits: number;
  creditsByKind: Record<string, number>;
  // What the realm server metered for the run, against its caps.
  callApiCalls: number;
  callApiResponseBytes: number;
  resolveCalls: number;
  writes: number;
  aiCreditsSpent: number;
  aiCreditsReserved: number;
}

export interface AutomationRunReport {
  run: AutomationRun;
  timings: AutomationRunTimings;
  cost: AutomationRunCost;
  log: RunLog;
  // A Preview that finished complete: the files it would have written, in
  // path order, or none when the script staged nothing or when
  // `stagedFilesReplacedBy` is set. Absent for any other run.
  stagedFiles?: StagedRunFile[];
  // The later Preview, by the same person of the same automation, whose
  // batch replaced this one's: its files are gone.
  stagedFilesReplacedBy?: string;
  // A run whose commit landed: the realm-local paths the commit saved, as
  // its commit line records them. Absent when the run's log dropped that
  // line at its cap; the row's `writes` still counts them.
  committedPaths?: string[];
}

export type AutomationRunReportRead =
  | { ok: true; report: AutomationRunReport }
  | { ok: false; reason: 'missing' | 'not-a-direct-writer' };

// Where a run is, for a direct writer of its realm: its row, timings, cost,
// log, and the batch it staged (a Preview) or saved (a run that committed).
export async function readAutomationRunReport(
  dbAdapter: DBAdapter,
  { runId, user }: { runId: string; user: string },
  options: Pick<AutomationActorOptions, 'matrixServerName' | 'virtualNetwork'>,
): Promise<AutomationRunReportRead> {
  let run = await getAutomationRun(dbAdapter, runId);
  if (!run) {
    return { ok: false, reason: 'missing' };
  }
  if (
    !(await isDirectWriterOf(
      dbAdapterQuerier(dbAdapter),
      run.realm,
      user,
      options,
    ))
  ) {
    return { ok: false, reason: 'not-a-direct-writer' };
  }
  let [log, creditsByKind] = await Promise.all([
    readRunLog(dbAdapter, run.id),
    runCreditsByKind(dbAdapter, run.id),
  ]);
  let runLog: RunLog = log ?? { lines: [], dropped: 0 };
  let report: AutomationRunReport = {
    run,
    timings: timingsOf(run),
    cost: {
      credits: Object.values(creditsByKind).reduce((a, b) => a + b, 0),
      creditsByKind,
      callApiCalls: run.callApiCalls,
      callApiResponseBytes: run.callApiResponseBytes,
      resolveCalls: run.resolveCalls,
      writes: run.writes,
      aiCreditsSpent: run.aiCreditsSpent,
      aiCreditsReserved: run.aiCreditsReserved,
    },
    log: runLog,
  };
  if (run.dryRun && run.state === 'complete') {
    report.stagedFiles = await listAutomationPreviewFiles(dbAdapter, run.id);
    if (run.previewReplacedBy) {
      report.stagedFilesReplacedBy = run.previewReplacedBy;
    }
  }
  if (run.committedAt) {
    let paths = committedPathsOf(runLog);
    if (paths) {
      report.committedPaths = paths;
    }
  }
  return { ok: true, report };
}

// The batch a complete Preview kept, in path order, without the bytes.
async function listAutomationPreviewFiles(
  dbAdapter: DBAdapter,
  runId: string,
): Promise<StagedRunFile[]> {
  let rows = await query(dbAdapter, [
    'SELECT path, size FROM automation_preview_files WHERE run_id =',
    param(runId),
    'ORDER BY path',
  ]);
  return rows.map((row) => ({
    path: String(row.path),
    size: Number(row.size),
  }));
}

export type AutomationPreviewFileRead =
  | { ok: true; content: Uint8Array }
  | { ok: false; reason: 'missing' | 'not-a-direct-writer' };

// The bytes of one file a complete Preview kept, for a direct writer of the
// run's realm. `missing` when there's no such run, or the Preview kept no
// file at `path` (it staged none there, or a later Preview replaced its
// batch).
export async function readAutomationPreviewFile(
  dbAdapter: DBAdapter,
  { runId, path, user }: { runId: string; path: string; user: string },
  options: Pick<AutomationActorOptions, 'matrixServerName' | 'virtualNetwork'>,
): Promise<AutomationPreviewFileRead> {
  let run = await getAutomationRun(dbAdapter, runId);
  if (!run) {
    return { ok: false, reason: 'missing' };
  }
  if (
    !(await isDirectWriterOf(
      dbAdapterQuerier(dbAdapter),
      run.realm,
      user,
      options,
    ))
  ) {
    return { ok: false, reason: 'not-a-direct-writer' };
  }
  let [row] = await query(dbAdapter, [
    "SELECT encode(content, 'base64') AS content FROM automation_preview_files WHERE run_id =",
    param(runId),
    'AND path =',
    param(path),
  ]);
  return row
    ? { ok: true, content: fromBase64(String(row.content)) }
    : { ok: false, reason: 'missing' };
}

function timingsOf(run: AutomationRun): AutomationRunTimings {
  let between = (from: string | null, to: string | null) =>
    from && to ? Date.parse(to) - Date.parse(from) : null;
  return {
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    commitStartedAt: run.commitStartedAt,
    committedAt: run.committedAt,
    finishedAt: run.finishedAt,
    queuedMs: between(run.createdAt, run.startedAt),
    runMs: between(run.startedAt, run.finishedAt),
    commitMs: between(run.commitStartedAt, run.committedAt),
  };
}

// The run's charges in the ledger, in credits, by kind. Credits are negative
// on a spend, so a charge's cost is the negated sum.
async function runCreditsByKind(
  dbAdapter: DBAdapter,
  runId: string,
): Promise<Record<string, number>> {
  let rows = await query(dbAdapter, [
    'SELECT charge_kind, -SUM(credit_amount) AS credits FROM credits_ledger WHERE run_id =',
    param(runId),
    'GROUP BY charge_kind',
  ]);
  let byKind: Record<string, number> = {};
  for (let row of rows) {
    byKind[String(row.charge_kind)] = Number(row.credits);
  }
  return byKind;
}

// The paths the run's landed commit saved, from its successful commit line,
// or undefined when the log has no such line (dropped past the log's cap).
function committedPathsOf(log: RunLog): string[] | undefined {
  let line = log.lines.find(
    (l) =>
      l.source === 'platform' &&
      l.kind === 'commit' &&
      Array.isArray(l.data?.paths),
  );
  return line?.data?.paths as string[] | undefined;
}
