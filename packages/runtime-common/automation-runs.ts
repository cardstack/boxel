// The run row: one `automation_runs` row per run of an automation, and the
// functions that move a run through its states. The row is the source of
// truth for a run's commit and for its retries, so each function below is one
// conditional statement that reads and changes the row together, and two
// processes racing on a run (a retry and the attempt it replaced, a cancel
// and a commit) can't both win.
//
//   pending ──start──▶ running ──finish──▶ complete | error
//      │                  │  └──abandon──▶ complete | error
//      └─────cancel───────┴──▶ canceled   (only before the commit is claimed)
//
// A queue attempt takes a run with `startAutomationRunAttempt`, which makes
// it the run's owner. An attempt is the queue's reservation id, which grows
// with each reservation, so only an attempt at least as new as the owner can
// take the run over. Only the owner may record the script, claim the commit
// or finish the run, so an attempt that a retry has replaced is refused at
// each of them. The commit is claimed once (`commit_started_at`) before the
// batch is sent, and recorded (`committed_at`) once it has landed, so a run
// commits at most once however many times its job runs: an attempt that
// takes a run whose commit was already claimed learns that from the start
// and finishes the run without running the script again.

import { v4 as uuidv4 } from '@lukeed/uuid';

import { MANUAL_RUN_TRIGGER } from './automation-declaration.ts';
import { logRunPlatformLine } from './automation-run-log.ts';
import {
  clearRunMilestones,
  closeRunMilestones,
} from './automation-run-milestones.ts';
import {
  emitAutomationRunEvent,
  jobOfRun,
  msBetween,
} from './automation-run-telemetry.ts';
import type { DBAdapter } from './db.ts';
import { isDirectWriter } from './db-queries/realm-permission-queries.ts';
import {
  dbAdapterQuerier,
  param,
  query,
  type Expression,
  type Querier,
} from './expression.ts';
import type { PgPrimitive } from './index.ts';
import type {
  RealmIdentifier,
  RealmResourceIdentifier,
} from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';

export type AutomationRunState =
  | 'pending'
  | 'running'
  | 'complete'
  | 'error'
  | 'canceled';

// What the realm server meters for a run, where it does the work.
export interface AutomationRunCounts {
  callApiCalls: number;
  callApiResponseBytes: number;
  resolveCalls: number;
  writes: number;
}

export interface AutomationRun extends AutomationRunCounts {
  id: string;
  automationId: RealmResourceIdentifier;
  realm: RealmIdentifier;
  // The trigger's label, and the slot it fired for: the scheduled instant,
  // a webhook delivery's id, a batch's id, or a click's.
  trigger: string;
  slot: string;
  // The Matrix user id of the person the run acts as.
  actsAs: string;
  // A Preview: the run stops before its commit, and once it finishes
  // complete the files it staged are kept as the batch it shows
  // (`automation_preview_files`).
  dryRun: boolean;
  // For a complete Preview whose batch a later one by the same person
  // replaced: that Preview.
  previewReplacedBy: string | null;
  // The queue attempt (the job's reservation id) that owns the run, once one
  // has started it.
  attempt: number | null;
  scriptId: RealmResourceIdentifier | null;
  scriptHash: string | null;
  state: AutomationRunState;
  // For an error, a code such as `script-error`. A run canceled by a pause no
  // person asked for carries that pause's reason here instead.
  errorReason: string | null;
  errorMessage: string | null;
  // Who canceled the run, when a person did.
  canceledBy: string | null;
  // For a run that ended on a credential refused for a reason a person must
  // fix: the reason, and the share or personal key the refused slot is filled
  // from.
  credentialRefusal: AutomationRunCredentialRefusal | null;
  // Credits the run's finished AI requests cost, and the most its AI requests
  // in flight can cost: the sum of the reservations it holds (see
  // `reserveAutomationRunAICredits`).
  aiCreditsSpent: number;
  aiCreditsReserved: number;
  // Milliseconds of prerender tab time the run's script took, summed over
  // the attempts that ran it (see `addAutomationRunTabTime`).
  prerenderTabMs: number;
  // The most the run can cost, in whole credits, which its admission held
  // against its identity's balance (see `holdAutomationRunCredits`). Null
  // until the spending check admits it.
  costCeilingCredits: number | null;
  // When that hold stopped counting (`releaseAutomationRunCreditHold`).
  creditHoldReleasedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  // When the attempt that owns the run admitted it (see
  // `automation-admission.ts`). Each attempt admits the run again before it
  // runs the script, so this is the latest admission; an attempt that takes
  // the run over from another clears it until that attempt admits the run.
  admittedAt: string | null;
  commitStartedAt: string | null;
  committedAt: string | null;
  finishedAt: string | null;
}

export interface NewAutomationRun {
  automationId: RealmResourceIdentifier;
  realm: RealmIdentifier;
  trigger: string;
  slot: string;
  actsAs: string;
  // A Preview; false when absent.
  dryRun?: boolean;
}

// What an attempt that has just taken a run must do with it:
//
// - `run`: run the script.
// - `committed`: an earlier attempt's commit landed; finish the run as
//   complete without running the script.
// - `commit-interrupted`: an earlier attempt claimed the commit and stopped
//   before recording that it landed, so whether its batch landed is unknown.
//   Finish the run as an error without running the script, since running it
//   again could commit twice. If the batch lands later after all, recording
//   it makes the run complete.
// - `superseded`: a newer attempt owns the run. Stop without touching it.
// - `over`: the run is complete, errored or canceled, and the attempt doesn't
//   own it.
// - `missing`: there is no such run.
export type AutomationRunAttemptStart =
  | {
      kind: 'run' | 'committed' | 'commit-interrupted' | 'superseded' | 'over';
      run: AutomationRun;
    }
  | { kind: 'missing' };

export type AutomationRunOutcome =
  | { state: 'complete' }
  | {
      state: 'error';
      reason: string;
      message?: string;
      credential?: AutomationRunCredentialRefusal;
    };

// The error reason of a run that ended on a refused credential: at admission,
// or at one of its `callApi` calls.
export const CREDENTIAL_REJECTED_REASON = 'credential-rejected';

// A credential a run ended on, refused for a reason a person must fix:
// `rejected`, the vendor no longer accepts the key or connection, or
// `needs-admin`, the OAuth client it mints through, or the share it is
// filled from, needs an administrator. `subject` is the share the refused
// slot is filled from, or the personal key that fills it. A token endpoint
// that is only failing for now (`unavailable`) is never one.
export interface AutomationRunCredentialRefusal {
  reason: 'rejected' | 'needs-admin';
  subject: { kind: 'share' | 'key'; id: string };
}

const COUNT_COLUMNS: Record<keyof AutomationRunCounts, string> = {
  callApiCalls: 'call_api_calls',
  callApiResponseBytes: 'call_api_response_bytes',
  resolveCalls: 'resolve_calls',
  writes: 'writes',
};

// Adds a run for its automation, trigger and slot, or returns the run already
// there for them, so enqueueing the same run twice gives one row.
export async function createAutomationRun(
  dbAdapter: DBAdapter,
  run: NewAutomationRun,
): Promise<AutomationRun> {
  return await insertAutomationRun(dbAdapterQuerier(dbAdapter), run);
}

// `createAutomationRun` inside the caller's transaction.
export async function insertAutomationRun(
  querier: Querier,
  run: NewAutomationRun,
): Promise<AutomationRun> {
  return (await insertOrFindAutomationRun(querier, run)).run;
}

// `insertAutomationRun`, saying whether this call created the run or found
// the one already there for its automation, trigger and slot.
export async function insertOrFindAutomationRun(
  querier: Querier,
  run: NewAutomationRun,
): Promise<{ run: AutomationRun; created: boolean }> {
  let [created] = await querier([
    'INSERT INTO automation_runs (automation_id, realm, trigger, slot, acts_as, dry_run) VALUES (',
    param(run.automationId),
    ',',
    param(run.realm),
    ',',
    param(run.trigger),
    ',',
    param(run.slot),
    ',',
    param(run.actsAs),
    ',',
    param(run.dryRun ?? false),
    ') ON CONFLICT ON CONSTRAINT automation_runs_slot_key DO NOTHING RETURNING *',
  ]);
  if (created) {
    return { run: runFromRow(created), created: true };
  }
  let [existing] = await querier([
    'SELECT * FROM automation_runs WHERE automation_id =',
    param(run.automationId),
    'AND trigger =',
    param(run.trigger),
    'AND slot =',
    param(run.slot),
  ]);
  return { run: runFromRow(existing), created: false };
}

export async function getAutomationRun(
  dbAdapter: DBAdapter,
  id: string,
): Promise<AutomationRun | undefined> {
  let [row] = await query(dbAdapter, [
    'SELECT * FROM automation_runs WHERE id =',
    param(id),
  ]);
  return row ? runFromRow(row) : undefined;
}

// One page of an automation's runs that have started, newest first by when
// they were made, Previews and Run nows included: a run still waiting in the
// queue for its first attempt isn't one of them. `page` counts from 1, and
// `total` is how many such runs the automation has, so a reader can tell how
// many pages there are. Both reads walk the runs' `(automation_id,
// created_at)` index.
export async function listAutomationRuns(
  querier: Querier,
  automationId: RealmResourceIdentifier,
  { page, limit }: { page: number; limit: number },
): Promise<{ runs: AutomationRun[]; total: number }> {
  let [counted] = (await querier([
    'SELECT count(*) AS total FROM automation_runs WHERE automation_id =',
    param(automationId),
    'AND started_at IS NOT NULL',
  ] as Expression)) as { total: PgPrimitive }[];
  let rows = (await querier([
    'SELECT * FROM automation_runs WHERE automation_id =',
    param(automationId),
    'AND started_at IS NOT NULL',
    'ORDER BY created_at DESC, id DESC LIMIT',
    param(limit),
    'OFFSET',
    param((page - 1) * limit),
  ] as Expression)) as Record<string, PgPrimitive>[];
  return {
    runs: rows.map(runFromRow),
    total: Number(counted?.total ?? 0),
  };
}

// Whether `id` can name a run: a run's id is a UUID, so anything else names
// no run, and a read can answer so without asking the database, which would
// refuse to compare it with the column.
export function isAutomationRunId(id: string): boolean {
  return RUN_ID.test(id);
}

const RUN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Why a run-token call was refused by the run's row: there is no such run,
// it isn't running (it finished, was canceled or hasn't started), or another
// attempt owns it.
export type AutomationRunCallRefusal = 'missing' | 'not-running' | 'superseded';

// The run a run-token call belongs to, when the row lets the call through:
// the run is running and `attempt`, the attempt the token was minted for,
// still owns it. A cancel, a pause that cancels the run, a finish or a
// takeover by a newer attempt refuses every later call. The row is read on
// every call, so a change made by any process takes effect at the next one.
export async function automationRunForCall(
  dbAdapter: DBAdapter,
  id: string,
  attempt: number,
): Promise<
  | { ok: true; run: AutomationRun }
  | { ok: false; reason: AutomationRunCallRefusal; run?: AutomationRun }
> {
  let run = await getAutomationRun(dbAdapter, id);
  if (!run) {
    return { ok: false, reason: 'missing' };
  }
  if (run.state !== 'running') {
    return { ok: false, reason: 'not-running', run };
  }
  if (run.attempt !== attempt) {
    return { ok: false, reason: 'superseded', run };
  }
  return { ok: true, run };
}

// Makes `attempt` the owner of a pending or running run, and says what it must
// do next. A running run is taken over by an attempt at least as new as its
// owner: the attempt that owned it is refused from then on. `started_at` keeps
// the first attempt's start.
export async function startAutomationRunAttempt(
  dbAdapter: DBAdapter,
  id: string,
  attempt: number,
): Promise<AutomationRunAttemptStart> {
  // The same transaction drops what any other attempt staged, so the attempt
  // that owns the run starts from an empty overlay. The drop is its own
  // statement, which sees a file a replaced attempt staged while it held the
  // run's row, since the takeover waited on that lock. A run whose commit was
  // already claimed keeps its files: the claiming attempt may still be
  // reading them to send its batch. An attempt that takes the run from
  // another also clears the run's admission and milestones, since it admits
  // the run again and the script runs again from its start and reports them
  // afresh. The run's row is locked first, the order `appendRunLog` takes the
  // locks in.
  let row = await dbAdapter.withTransaction(async (txQuery) => {
    let [owner] = await txQuery([
      'SELECT attempt FROM automation_runs WHERE id =',
      param(id),
      'FOR UPDATE',
    ]);
    let [started] = await txQuery([
      "UPDATE automation_runs SET state = 'running', attempt =",
      param(attempt),
      ', started_at = COALESCE(started_at, now()) WHERE id =',
      param(id),
      "AND state IN ('pending', 'running') AND (attempt IS NULL OR attempt <=",
      param(attempt),
      ') RETURNING *',
    ]);
    if (started && started.commit_started_at == null) {
      await txQuery([
        'DELETE FROM run_overlay_files WHERE run_id =',
        param(id),
        'AND attempt <>',
        param(attempt),
      ]);
      if (owner?.attempt != null && Number(owner.attempt) !== attempt) {
        await clearRunMilestones(txQuery, id);
        if (started.admitted_at != null) {
          let [readmitting] = await txQuery([
            'UPDATE automation_runs SET admitted_at = NULL WHERE id =',
            param(id),
            'RETURNING *',
          ]);
          return readmitting;
        }
      }
    }
    return started;
  });
  if (!row) {
    let run = await getAutomationRun(dbAdapter, id);
    if (!run) {
      return { kind: 'missing' };
    }
    return {
      kind:
        run.state === 'pending' || run.state === 'running'
          ? 'superseded'
          : 'over',
      run,
    };
  }
  let run = runFromRow(row);
  if (run.committedAt) {
    return { kind: 'committed', run };
  }
  if (run.commitStartedAt) {
    return { kind: 'commit-interrupted', run };
  }
  return { kind: 'run', run };
}

// Records which script file the run read and the hash of the text it ran.
export async function recordAutomationRunScript(
  dbAdapter: DBAdapter,
  id: string,
  attempt: number,
  script: { scriptId: RealmResourceIdentifier; scriptHash: string },
): Promise<AutomationRun | undefined> {
  return await updateOwned(dbAdapter, id, attempt, [
    'script_id =',
    param(script.scriptId),
    ', script_hash =',
    param(script.scriptHash),
  ]);
}

// Records that `attempt` admitted the run. Refused unless the run is running
// and `attempt` owns it.
export async function recordAutomationRunAdmitted(
  dbAdapter: DBAdapter,
  id: string,
  attempt: number,
): Promise<AutomationRun | undefined> {
  return await updateOwned(dbAdapter, id, attempt, ['admitted_at = now()']);
}

// Holds `credits`, the most the run can cost, against its identity's balance
// and its automation's credit caps while it is in flight (see
// `creditsHeldByRunsInFlight`). Refused unless the run is running and
// `attempt` owns it. A retry's admission holds again, replacing what the
// earlier attempt held.
export async function holdAutomationRunCredits(
  dbAdapter: DBAdapter,
  id: string,
  attempt: number,
  credits: number,
): Promise<AutomationRun | undefined> {
  if (!Number.isInteger(credits) || credits < 0) {
    throw new Error(
      `a run's credit hold must be a whole number of credits, got ${credits}`,
    );
  }
  return await updateOwned(dbAdapter, id, attempt, [
    'cost_ceiling_credits =',
    param(credits),
    ', credit_hold_released_at = NULL',
  ]);
}

// Stops the run's hold counting, once the run has ended and its `run` charge
// is written or it had nothing to charge (`chargeAutomationRun`). A run that
// is still pending or running keeps its hold, so a run canceled while its tab
// still runs holds until the attempt has charged what the tab used. Returns
// whether a hold was released.
export async function releaseAutomationRunCreditHold(
  dbAdapter: DBAdapter,
  id: string,
): Promise<boolean> {
  let rows = await query(dbAdapter, [
    'UPDATE automation_runs SET credit_hold_released_at = now() WHERE id =',
    param(id),
    "AND state IN ('complete', 'error', 'canceled')",
    'AND cost_ceiling_credits IS NOT NULL AND credit_hold_released_at IS NULL',
    'RETURNING id',
  ]);
  return rows.length > 0;
}

// How long an ended run's hold keeps counting when nothing releases it: its
// charge couldn't be written, or the run was closed without an attempt. The
// attempt releases the hold just after the run ends, so this only bounds a
// hold that release never reaches.
export const UNRELEASED_RUN_HOLD_SECONDS = 60 * 60;

// The credits held by admitted runs whose holds haven't been released, other
// than `excludeRunId`: those of `actsAs` (the balance check), or those of
// `automationId`'s runs that aren't Previews or Run nows (the credit caps).
//
// A run holds its cost ceiling, less what the ledger has charged it for AI
// (each AI request is charged as it finishes, so the balance already shows
// it). Only ledger charges count: a request whose cost couldn't be learned
// adds its reservation to `ai_credits_spent` but charges nothing, so the
// hold keeps covering it. A run holds from its admission until its hold is
// released (`releaseAutomationRunCreditHold`), or for at most
// `UNRELEASED_RUN_HOLD_SECONDS` after it ends.
export async function creditsHeldByRunsInFlight(
  querier: Querier,
  filter: (
    | { actsAs: string; automationId?: undefined }
    | { automationId: RealmResourceIdentifier; actsAs?: undefined }
  ) & { excludeRunId: string },
): Promise<number> {
  let [row] = await querier([
    'SELECT COALESCE(SUM(GREATEST(r.cost_ceiling_credits - COALESCE(ai.charged, 0), 0)), 0) AS held',
    'FROM automation_runs r LEFT JOIN LATERAL (',
    "SELECT -SUM(l.credit_amount) AS charged FROM credits_ledger l WHERE l.run_id = r.id AND l.charge_kind = 'ai'",
    ') ai ON true',
    'WHERE r.cost_ceiling_credits IS NOT NULL AND r.credit_hold_released_at IS NULL',
    ...((filter.actsAs !== undefined
      ? ['AND r.acts_as =', param(filter.actsAs)]
      : [
          'AND r.automation_id =',
          param(filter.automationId),
          'AND r.trigger <>',
          param(MANUAL_RUN_TRIGGER),
        ]) as Expression),
    'AND (r.finished_at IS NULL OR r.finished_at > now() - make_interval(secs =>',
    param(UNRELEASED_RUN_HOLD_SECONDS),
    ')) AND r.id <>',
    param(filter.excludeRunId),
  ] as Expression);
  return Number(row?.held ?? 0);
}

// Claims the run's one commit for `attempt`. The claim is refused unless the
// run is running, `attempt` owns it, and no commit was claimed before, so a
// caller sends the batch only when this returns the run.
export async function claimAutomationRunCommit(
  dbAdapter: DBAdapter,
  id: string,
  attempt: number,
): Promise<AutomationRun | undefined> {
  return await updateOwned(
    dbAdapter,
    id,
    attempt,
    ['commit_started_at = now()'],
    ['AND commit_started_at IS NULL'],
  );
}

// Records that the claimed commit's batch has landed. It needs no owner: the
// batch landed whichever attempt sent it, even one a retry has since
// replaced. A batch can land after its run was finished as an error, when a
// retry found the commit interrupted or the run was abandoned, since nobody
// knew then whether it would land. That run becomes complete, so a run whose
// commit landed never reads as an error.
export async function recordAutomationRunCommitted(
  dbAdapter: DBAdapter,
  id: string,
): Promise<AutomationRun | undefined> {
  let [row] = await query(dbAdapter, [
    'UPDATE automation_runs SET committed_at = now(),',
    "error_reason = CASE WHEN state = 'error' THEN NULL ELSE error_reason END,",
    "error_message = CASE WHEN state = 'error' THEN NULL ELSE error_message END,",
    "state = CASE WHEN state = 'error' THEN 'complete' ELSE state END",
    'WHERE id =',
    param(id),
    "AND state IN ('running', 'error') AND commit_started_at IS NOT NULL AND committed_at IS NULL",
    'RETURNING *, (SELECT state FROM automation_runs WHERE id =',
    param(id),
    ') AS state_before',
  ]);
  if (!row) {
    return undefined;
  }
  let run = runFromRow(row);
  if (row.state_before === 'error') {
    // The run's `finished` telemetry said `error`; this one says how it
    // ended after all.
    emitRunFinished(run, await jobOfRun(dbAdapter, run), true);
  }
  return run;
}

// Ends a running run that `attempt` owns. A run whose commit was claimed can
// finish as complete only once the commit has landed, and a run whose commit
// landed can't finish as an error, since its writes are in the realm. (A
// claimed commit that lands after the run finished as an error makes the run
// complete; see `recordAutomationRunCommitted`.)
export async function finishAutomationRun(
  dbAdapter: DBAdapter,
  id: string,
  attempt: number,
  outcome: AutomationRunOutcome,
): Promise<AutomationRun | undefined> {
  let run =
    outcome.state === 'complete'
      ? await updateOwned(
          dbAdapter,
          id,
          attempt,
          ["state = 'complete', finished_at = now()"],
          ['AND (commit_started_at IS NULL OR committed_at IS NOT NULL)'],
          { ends: true },
        )
      : await updateOwned(
          dbAdapter,
          id,
          attempt,
          [
            "state = 'error', finished_at = now(), error_reason =",
            param(outcome.reason),
            ', error_message =',
            param(outcome.message ?? null),
            ...(outcome.credential
              ? [',', ...credentialColumns(outcome.credential)]
              : []),
          ],
          ['AND committed_at IS NULL'],
          { ends: true },
        );
  if (run) {
    await logAutomationRunEnded(dbAdapter, run);
  }
  return run;
}

// Records on a running run the credential its admission was refused for,
// before the attempt finishes it as an error: the share or key the refused
// slot is filled from, which the run's notices are read against. Owner only;
// a run that already records one keeps it.
export async function recordAutomationRunCredentialRefusal(
  dbAdapter: DBAdapter,
  id: string,
  attempt: number,
  credential: AutomationRunCredentialRefusal,
): Promise<AutomationRun | undefined> {
  return await updateOwned(
    dbAdapter,
    id,
    attempt,
    credentialColumns(credential),
    ['AND credential_reason IS NULL'],
  );
}

function credentialColumns(
  credential: AutomationRunCredentialRefusal,
): Expression {
  return [
    'credential_reason =',
    param(credential.reason),
    ', credential_share_id =',
    param(credential.subject.kind === 'share' ? credential.subject.id : null),
    ', credential_key_id =',
    param(credential.subject.kind === 'key' ? credential.subject.id : null),
  ];
}

// The run log's last line: how the run ended, as its row says. The realm
// server writes it, so a run whose tab can no longer send (its token expired
// at its time limit, say) still ends its log with why. Writing a line locks
// the run's row, so a caller that ended the run inside a transaction of its
// own writes the line once that transaction has committed.
export async function logAutomationRunEnded(
  dbAdapter: DBAdapter,
  run: AutomationRun,
): Promise<void> {
  let job = await jobOfRun(dbAdapter, run);
  emitRunFinished(run, job);
  await closeRunMilestones(dbAdapter, run, job);
  await logRunPlatformLine(
    dbAdapter,
    run.id,
    run.state === 'complete'
      ? { kind: 'finish', level: 'info', message: 'The run finished' }
      : run.state === 'canceled'
        ? {
            kind: 'finish',
            level: 'warn',
            message: run.canceledBy
              ? `The run was canceled by ${run.canceledBy}`
              : `The run was canceled${run.errorReason ? ` (${run.errorReason})` : ''}`,
            ...(run.errorReason ? { data: { reason: run.errorReason } } : {}),
          }
        : {
            kind: 'finish',
            level: 'error',
            message: `The run ended with an error (${run.errorReason ?? 'error'})${run.errorMessage ? `: ${run.errorMessage}` : ''}`,
            ...(run.errorReason ? { data: { reason: run.errorReason } } : {}),
          },
    job,
  );
}

// The run's `finished` telemetry event: every timestamp and count its row
// holds as it ends, whichever path ended it.
function emitRunFinished(
  run: AutomationRun,
  job: number | undefined,
  lateCommit = false,
): void {
  emitAutomationRunEvent({
    kind: 'finished',
    ...(lateCommit ? { lateCommit: true as const } : {}),
    automation: run.automationId,
    run: run.id,
    ...(job !== undefined ? { job } : {}),
    ...(run.attempt != null ? { attempt: run.attempt } : {}),
    realm: run.realm,
    trigger: run.trigger,
    dryRun: run.dryRun,
    state: run.state,
    ...(run.errorReason ? { errorReason: run.errorReason } : {}),
    ...(run.canceledBy ? { canceledBy: run.canceledBy } : {}),
    createdAt: run.createdAt,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.admittedAt ? { admittedAt: run.admittedAt } : {}),
    ...(run.commitStartedAt ? { commitStartedAt: run.commitStartedAt } : {}),
    ...(run.committedAt ? { committedAt: run.committedAt } : {}),
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    ...optionalMs('totalMs', msBetween(run.createdAt, run.finishedAt)),
    ...optionalMs('runMs', msBetween(run.startedAt, run.finishedAt)),
    prerenderTabMs: run.prerenderTabMs,
    callApiCalls: run.callApiCalls,
    callApiResponseBytes: run.callApiResponseBytes,
    resolveCalls: run.resolveCalls,
    writes: run.writes,
    aiCreditsSpent: run.aiCreditsSpent,
  });
}

function optionalMs<K extends string>(
  name: K,
  ms: number | undefined,
): Partial<Record<K, number>> {
  return ms === undefined ? {} : ({ [name]: ms } as Record<K, number>);
}

// Closes a pending or running run whose job is gone, such as one whose job ran
// out of retries, whoever owned it. A run whose commit landed finishes as
// complete. Any other run finishes as an error with `reason`, including one
// whose commit was claimed but never recorded as landed. No attempt is left to
// charge the run, so the caller charges it (`chargeAutomationRun`).
export async function abandonAutomationRun(
  dbAdapter: DBAdapter,
  id: string,
  reason: string,
): Promise<AutomationRun | undefined> {
  let row = await endRun(dbAdapter, [
    'UPDATE automation_runs SET finished_at = now(),',
    "state = CASE WHEN committed_at IS NOT NULL THEN 'complete' ELSE 'error' END,",
    'error_reason = CASE WHEN committed_at IS NOT NULL THEN NULL ELSE',
    param(reason),
    'END WHERE id =',
    param(id),
    "AND state IN ('pending', 'running') RETURNING *",
  ]);
  let run = row ? runFromRow(row) : undefined;
  if (run) {
    await logAutomationRunEnded(dbAdapter, run);
  }
  return run;
}

// Cancels a pending or running run, for `canceledBy`. A run whose commit was
// claimed can't be canceled, since its writes may already be landing. The
// cancel discards the run's overlay, so nothing it staged lands; the realm
// server refuses the run's next call, and its tab stops the script once the
// realm answers that the run is not running. A person's cancel goes through
// `cancelAutomationRunFor` in `automations.ts`, which checks they may.
export async function cancelAutomationRun(
  dbAdapter: DBAdapter,
  id: string,
  canceledBy: string,
): Promise<AutomationRun | undefined> {
  let run = await dbAdapter.withTransaction((txQuery) =>
    cancelAutomationRunIn(txQuery, id, canceledBy),
  );
  if (run) {
    await logAutomationRunEnded(dbAdapter, run);
  }
  return run;
}

// `cancelAutomationRun` inside the caller's transaction, which then writes
// the run's last log line with `logAutomationRunEnded` once it commits.
export async function cancelAutomationRunIn(
  txQuery: Querier,
  id: string,
  canceledBy: string,
): Promise<AutomationRun | undefined> {
  let [row] = await txQuery([
    "UPDATE automation_runs SET state = 'canceled', finished_at = now(), canceled_by =",
    param(canceledBy),
    'WHERE id =',
    param(id),
    "AND state IN ('pending', 'running') AND commit_started_at IS NULL RETURNING *",
  ]);
  if (!row) {
    return undefined;
  }
  await discardOverlays(txQuery, [String(row.id)]);
  return runFromRow(row);
}

// Cancels every run of the automation that hasn't ended, as pausing or
// removing the automation does, inside the caller's transaction, and returns
// the runs it canceled. A pending run never starts. A running run is
// canceled as `cancelAutomationRun` cancels it: its overlay is discarded, the
// realm server refuses its next call and its tab stops the script. A running
// run whose commit was claimed is left to finish, since its writes may
// already be landing. A person's pause or remove names them in
// `canceled_by`. A pause no person asked for names no one, and records its
// reason (such as `caps-raised`) in `error_reason`. With `pendingOnly`, a
// running run is left to finish and only pending runs are canceled. The caller
// writes each canceled run's last log line with `logAutomationRunEnded` once
// its transaction commits.
export async function cancelUnfinishedAutomationRuns(
  querier: Querier,
  automationId: RealmResourceIdentifier,
  by: { canceledBy: string } | { reason: string },
  { pendingOnly = false }: { pendingOnly?: boolean } = {},
): Promise<AutomationRun[]> {
  let rows = await querier([
    "UPDATE automation_runs SET state = 'canceled', finished_at = now(), canceled_by =",
    param('canceledBy' in by ? by.canceledBy : null),
    ', error_reason =',
    param('reason' in by ? by.reason : null),
    'WHERE automation_id =',
    param(automationId),
    pendingOnly
      ? "AND state = 'pending'"
      : "AND (state = 'pending' OR (state = 'running' AND commit_started_at IS NULL))",
    'RETURNING *',
  ]);
  await discardOverlays(
    querier,
    rows.map((row) => String(row.id)),
  );
  return rows.map(runFromRow);
}

// Adds the prerender tab time one attempt's script took to the run. The tab
// was held whatever state the run is in by then, so the time is added in any
// state, like the counts below.
export async function addAutomationRunTabTime(
  dbAdapter: DBAdapter,
  id: string,
  ms: number,
): Promise<void> {
  let whole = Math.ceil(ms);
  if (!Number.isSafeInteger(whole) || whole < 0) {
    throw new Error(
      `a run's tab time can only grow by 0 ms or more, not ${ms}`,
    );
  }
  if (whole === 0) {
    return;
  }
  await query(dbAdapter, [
    'UPDATE automation_runs SET prerender_tab_ms = prerender_tab_ms +',
    param(whole),
    'WHERE id =',
    param(id),
  ]);
}

// Adds to the run's metered counts. The work they count was done whatever
// state the run is in, so the counts are added in any state.
export async function addAutomationRunCounts(
  dbAdapter: DBAdapter,
  id: string,
  counts: Partial<AutomationRunCounts>,
): Promise<void> {
  let sets: Expression = [];
  for (let [key, column] of Object.entries(COUNT_COLUMNS) as [
    keyof AutomationRunCounts,
    string,
  ][]) {
    let amount = counts[key];
    if (amount === undefined || amount === 0) {
      continue;
    }
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(
        `a run's ${key} count can only grow by a whole number, not ${amount}`,
      );
    }
    sets.push(sets.length ? ',' : '', `${column} = ${column} +`, param(amount));
  }
  if (!sets.length) {
    return;
  }
  await query(dbAdapter, [
    'UPDATE automation_runs SET',
    ...sets,
    'WHERE id =',
    param(id),
  ]);
}

// The counts a run's caps bound one call at a time: each `callApi` and each
// `resolve` is one call against its cap.
export type AutomationRunCallCounter = 'callApiCalls' | 'resolveCalls';

// What came of counting one call against a run's cap:
//
// - `counted`: the call is within the cap and is counted. Make it.
// - `over-cap`: the run has made as many of these calls as its cap allows.
//   Refuse the call.
// - `not-running`: the run is pending, finished or canceled, or another
//   attempt owns it.
// - `missing`: there is no such run.
export type AutomationRunCallCount =
  | { kind: 'counted'; run: AutomationRun }
  | { kind: 'over-cap' | 'not-running'; run: AutomationRun }
  | { kind: 'missing' };

// Counts one call against a running run's cap on `counter`, for the attempt
// that owns it. The check and the count are one statement, so two calls
// racing for a run's last call can't both make it.
export async function countAutomationRunCall(
  dbAdapter: DBAdapter,
  id: string,
  attempt: number,
  counter: AutomationRunCallCounter,
  cap: number,
): Promise<AutomationRunCallCount> {
  if (!Number.isSafeInteger(cap) || cap < 0) {
    throw new Error(
      `a run's ${counter} cap must be a whole number, not ${cap}`,
    );
  }
  let column = COUNT_COLUMNS[counter];
  let run = await updateOwned(
    dbAdapter,
    id,
    attempt,
    [`${column} = ${column} + 1`],
    [`AND ${column} + 1 <=`, param(cap)],
  );
  if (run) {
    return { kind: 'counted', run };
  }
  let current = await getAutomationRun(dbAdapter, id);
  if (!current) {
    return { kind: 'missing' };
  }
  return {
    kind:
      current.state === 'running' && current.attempt === attempt
        ? 'over-cap'
        : 'not-running',
    run: current,
  };
}

// The error reason of a run that a call past one of its caps ended.
export const HIT_A_CAP_REASON = 'hit-a-cap';

// Ends a run that a call past one of its caps stopped: an error with reason
// `hit-a-cap`, whose message names the cap. Owner only, like any finish; a
// run that already finished, or that another attempt took over, is left as
// it is.
export async function endAutomationRunAtCap(
  dbAdapter: DBAdapter,
  id: string,
  attempt: number,
  cap: string,
): Promise<AutomationRun | undefined> {
  return await finishAutomationRun(dbAdapter, id, attempt, {
    state: 'error',
    reason: HIT_A_CAP_REASON,
    message: `The run hit its ${cap} cap`,
  });
}

// Whether the person a run acts as is a direct writer of the run's realm,
// which the run's admission and every one of its calls must find (ADR 026
// §1.5): the realm's calls (`Realm.handleAutomation`), the realm server's
// routes that take run tokens, and the worker's admission all ask it here.
// Permission rows are keyed by served URL, so the realm is resolved to the URL
// it is served at; a realm that resolves to none has no direct writer. One
// primary-key read of the person's permission row, read fresh on each call.
export async function runActsAsDirectWriter(
  {
    dbAdapter,
    virtualNetwork,
    matrixServerName,
  }: {
    dbAdapter: DBAdapter;
    virtualNetwork: VirtualNetwork;
    matrixServerName: string;
  },
  run: { realm: RealmIdentifier; actsAs: string },
): Promise<boolean> {
  let realmURL: URL;
  try {
    realmURL = virtualNetwork.toURL(run.realm);
  } catch {
    return false;
  }
  return await isDirectWriter(
    dbAdapter,
    realmURL,
    run.actsAs,
    matrixServerName,
  );
}

// The error reason of a run whose person was not a direct writer of its
// realm at one of its calls, or at its commit (ADR 026 §1.5).
export const NOT_A_DIRECT_WRITER_REASON = 'not-a-direct-writer';

// Ends a run that a call refused because the person it acts as is not a
// direct writer of its realm: an error with reason `not-a-direct-writer`.
// Ending the run, rather than refusing the call alone, makes every later call
// answer that the run is not running, which is what stops the script in its
// tab, so a run that catches the refusal can't keep its tab busy until its
// time limit. Owner only, like any finish; a run that already finished, or
// that another attempt took over, is left as it is.
export async function endAutomationRunNotADirectWriter(
  dbAdapter: DBAdapter,
  id: string,
  attempt: number,
): Promise<AutomationRun | undefined> {
  return await finishAutomationRun(dbAdapter, id, attempt, {
    state: 'error',
    reason: NOT_A_DIRECT_WRITER_REASON,
    message:
      "The person this run acts as stopped being a direct writer of the automation's workspace, so the run was stopped and its writes were not saved",
  });
}

// What came of asking to reserve credits for one of a run's AI requests:
//
// - `reserved`: the credits count against the run's AI spending cap.
//   Send the request, then settle it with `settleAutomationRunAICredits`.
// - `over-cap`: what the run has spent on AI, plus what its requests in
//   flight have reserved, plus this request's credits, would pass the cap.
//   Refuse the request.
// - `not-running`: the run is pending, finished or canceled.
// - `missing`: there is no such run.
export type AutomationRunAIReservation =
  | { kind: 'reserved'; reservationId: string; run: AutomationRun }
  | { kind: 'over-cap' | 'not-running'; run: AutomationRun }
  | { kind: 'missing' };

// Reserves `credits`, the most an AI request can cost, against a running
// run's AI spending cap, `cap` (ADR 029 §1.5). The check and the reservation
// are one statement, so two requests racing for the last of a run's AI
// credits can't both get them. Each reservation is held on the row under its
// own id (`ai_reservations`) and counts against the cap until
// `settleAutomationRunAICredits` replaces it with what the request cost.
//
// With `attempt`, only that attempt may reserve: a request admitted for an
// attempt a retry has since taken the run over from is refused as
// `not-running`.
export async function reserveAutomationRunAICredits(
  dbAdapter: DBAdapter,
  id: string,
  credits: number,
  cap: number,
  { attempt }: { attempt?: number } = {},
): Promise<AutomationRunAIReservation> {
  assertCredits('reserve', credits);
  assertCredits('cap a run at', cap);
  let reservationId = uuidv4();
  let [row] = await query(dbAdapter, [
    'UPDATE automation_runs SET ai_credits_reserved = ai_credits_reserved +',
    param(credits),
    ', ai_reservations = ai_reservations || jsonb_build_object(CAST(',
    param(reservationId),
    'AS text), CAST(',
    param(credits),
    'AS numeric)) WHERE id =',
    param(id),
    "AND state = 'running'",
    ...(attempt !== undefined ? ['AND attempt =', param(attempt)] : []),
    'AND ai_credits_spent + ai_credits_reserved +',
    param(credits),
    '<=',
    param(cap),
    'RETURNING *',
  ]);
  if (row) {
    return { kind: 'reserved', reservationId, run: runFromRow(row) };
  }
  let run = await getAutomationRun(dbAdapter, id);
  if (!run) {
    return { kind: 'missing' };
  }
  let owned =
    run.state === 'running' &&
    (attempt === undefined || run.attempt === attempt);
  return { kind: owned ? 'over-cap' : 'not-running', run };
}

// Settles the AI request that holds `reservationId`: releases its
// reservation and adds `cost`, what the request cost in credits, to the
// run's AI spending. A request that was never sent, or cost nothing, settles
// with a `cost` of 0. A request whose cost can't be learned settles with an
// undefined `cost`, which spends its whole reservation, the most it could
// have cost. It applies in any state, since the request was paid for whether
// or not the run is still going. The reservation is removed in the same
// statement, so a second settle of it changes nothing and returns false.
export async function settleAutomationRunAICredits(
  dbAdapter: DBAdapter,
  id: string,
  reservationId: string,
  cost: number | undefined,
): Promise<boolean> {
  if (cost !== undefined) {
    assertCredits('spend', cost);
  }
  let held = [
    'CAST(ai_reservations ->> CAST(',
    param(reservationId),
    'AS text) AS numeric)',
  ];
  let rows = await query(dbAdapter, [
    'UPDATE automation_runs SET ai_credits_reserved = ai_credits_reserved -',
    ...held,
    ', ai_credits_spent = ai_credits_spent + COALESCE(CAST(',
    param(cost ?? null),
    'AS numeric),',
    ...held,
    '), ai_reservations = ai_reservations - CAST(',
    param(reservationId),
    'AS text) WHERE id =',
    param(id),
    'AND jsonb_exists(ai_reservations, CAST(',
    param(reservationId),
    'AS text)) RETURNING id',
  ]);
  return rows.length > 0;
}

function assertCredits(action: string, credits: number) {
  if (!Number.isFinite(credits) || credits < 0) {
    throw new Error(
      `a run can only ${action} a finite number of AI credits, 0 or more, not ${credits}`,
    );
  }
}

// Changes a running run that `attempt` owns, and returns it, or returns
// undefined when the run isn't running or `attempt` doesn't own it. With
// `ends`, the change ends the run, and the same statement discards its
// overlay.
async function updateOwned(
  dbAdapter: DBAdapter,
  id: string,
  attempt: number,
  set: Expression,
  where: Expression = [],
  { ends = false }: { ends?: boolean } = {},
): Promise<AutomationRun | undefined> {
  let update: Expression = [
    'UPDATE automation_runs SET',
    ...set,
    'WHERE id =',
    param(id),
    "AND state = 'running' AND attempt =",
    param(attempt),
    ...where,
    'RETURNING *',
  ];
  let row = ends
    ? await endRun(dbAdapter, update)
    : (await query(dbAdapter, update))[0];
  return row ? runFromRow(row) : undefined;
}

// Runs an `UPDATE … RETURNING *` that ends a run, and in the same transaction
// discards the overlay of the run it ended (`run-overlay.ts`), so a run never
// ends with staged files left behind. The discard is its own statement after
// the update: a file staged while the update waited on the run's row lock has
// committed by then, and a later stage waits on the lock and then finds the
// run no longer running.
//
// A Preview that finishes complete first keeps the files its owning attempt
// staged, as the batch it shows (`keepPreviewBatch`).
async function endRun(
  dbAdapter: DBAdapter,
  update: Expression,
): Promise<Record<string, PgPrimitive> | undefined> {
  return await dbAdapter.withTransaction(async (txQuery) => {
    let [row] = await txQuery(update);
    if (row) {
      if (
        row.dry_run === true &&
        row.state === 'complete' &&
        row.attempt != null
      ) {
        await keepPreviewBatch(txQuery, row);
      }
      await discardOverlays(txQuery, [String(row.id)]);
    }
    return row;
  });
}

// Deletes what the runs staged, as a statement of its own after the update
// that ended them (see `endRun`).
async function discardOverlays(querier: Querier, runIds: string[]) {
  for (let runId of runIds) {
    await querier([
      'DELETE FROM run_overlay_files WHERE run_id =',
      param(runId),
    ]);
  }
}

// Copies a complete Preview's staged files into `automation_preview_files`,
// inside the transaction that finishes it. Only a person's latest complete
// Preview of an automation, ordered by when each was asked for, keeps its
// batch: keeping one deletes the batch of every earlier one and records it
// in their `preview_replaced_by`, and a Preview that finishes after a later
// one has completed keeps nothing and records that one. The finishes of one
// person's Previews of one automation take a transaction-scoped advisory
// lock, so two finishing together can't both keep a batch, and each sees
// the other's finish once it has the lock.
async function keepPreviewBatch(
  txQuery: Querier,
  row: Record<string, PgPrimitive>,
): Promise<void> {
  let runId = String(row.id);
  let samePerson: Expression = [
    'automation_id =',
    param(String(row.automation_id)),
    'AND acts_as =',
    param(String(row.acts_as)),
    "AND dry_run AND state = 'complete' AND id <>",
    param(runId),
  ];
  await txQuery([
    'SELECT pg_advisory_xact_lock(hashtext(',
    param(`automation-preview:${row.automation_id}:${row.acts_as}`),
    '))',
  ]);
  let [later] = await txQuery([
    'SELECT id FROM automation_runs WHERE',
    ...samePerson,
    'AND (created_at, id) > (SELECT created_at, id FROM automation_runs WHERE id =',
    param(runId),
    ') ORDER BY created_at DESC, id DESC LIMIT 1',
  ]);
  if (later) {
    await txQuery([
      'UPDATE automation_runs SET preview_replaced_by =',
      param(String(later.id)),
      'WHERE id =',
      param(runId),
    ]);
    return;
  }
  let earlier = [
    'SELECT id FROM automation_runs WHERE',
    ...samePerson,
    'AND preview_replaced_by IS NULL',
  ];
  await txQuery([
    'DELETE FROM automation_preview_files WHERE run_id IN (',
    ...earlier,
    ')',
  ]);
  await txQuery([
    'UPDATE automation_runs SET preview_replaced_by =',
    param(runId),
    'WHERE id IN (',
    ...earlier,
    ')',
  ]);
  await txQuery([
    'INSERT INTO automation_preview_files (run_id, path, content, size) SELECT run_id, path, content, size FROM run_overlay_files WHERE run_id =',
    param(runId),
    'AND attempt =',
    param(Number(row.attempt)),
  ]);
}

function runFromRow(row: Record<string, PgPrimitive>): AutomationRun {
  return {
    id: String(row.id),
    automationId: row.automation_id as RealmResourceIdentifier,
    realm: row.realm as RealmIdentifier,
    trigger: String(row.trigger),
    slot: String(row.slot),
    actsAs: String(row.acts_as),
    dryRun: row.dry_run === true || row.dry_run === 1,
    previewReplacedBy: (row.preview_replaced_by as string | null) ?? null,
    attempt: row.attempt == null ? null : Number(row.attempt),
    scriptId: (row.script_id as RealmResourceIdentifier | null) ?? null,
    scriptHash: (row.script_hash as string | null) ?? null,
    state: row.state as AutomationRunState,
    errorReason: (row.error_reason as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    canceledBy: (row.canceled_by as string | null) ?? null,
    credentialRefusal: credentialRefusalFromRow(row),
    callApiCalls: Number(row.call_api_calls),
    callApiResponseBytes: Number(row.call_api_response_bytes),
    resolveCalls: Number(row.resolve_calls),
    writes: Number(row.writes),
    aiCreditsSpent: Number(row.ai_credits_spent ?? 0),
    aiCreditsReserved: Number(row.ai_credits_reserved ?? 0),
    prerenderTabMs: Number(row.prerender_tab_ms ?? 0),
    costCeilingCredits:
      row.cost_ceiling_credits == null
        ? null
        : Number(row.cost_ceiling_credits),
    creditHoldReleasedAt: iso(row.credit_hold_released_at),
    createdAt: iso(row.created_at)!,
    startedAt: iso(row.started_at),
    admittedAt: iso(row.admitted_at),
    commitStartedAt: iso(row.commit_started_at),
    committedAt: iso(row.committed_at),
    finishedAt: iso(row.finished_at),
  };
}

function credentialRefusalFromRow(
  row: Record<string, PgPrimitive>,
): AutomationRunCredentialRefusal | null {
  let reason = row.credential_reason;
  if (reason !== 'rejected' && reason !== 'needs-admin') {
    return null;
  }
  if (row.credential_share_id != null) {
    return {
      reason,
      subject: { kind: 'share', id: String(row.credential_share_id) },
    };
  }
  if (row.credential_key_id != null) {
    return {
      reason,
      subject: { kind: 'key', id: String(row.credential_key_id) },
    };
  }
  return null;
}

function iso(value: PgPrimitive | undefined): string | null {
  if (value == null) {
    return null;
  }
  return new Date(value as string).toISOString();
}
