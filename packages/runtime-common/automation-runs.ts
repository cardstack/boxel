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

import type { DBAdapter } from './db.ts';
import { param, query, type Expression } from './expression.ts';
import type { PgPrimitive } from './index.ts';
import type {
  RealmIdentifier,
  RealmResourceIdentifier,
} from './realm-identifiers.ts';

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
  // The queue attempt (the job's reservation id) that owns the run, once one
  // has started it.
  attempt: number | null;
  scriptId: RealmResourceIdentifier | null;
  scriptHash: string | null;
  state: AutomationRunState;
  errorReason: string | null;
  errorMessage: string | null;
  canceledBy: string | null;
  // Credits the run's finished AI requests cost, and the most its AI requests
  // in flight can cost: the sum of the reservations it holds (see
  // `reserveAutomationRunAICredits`).
  aiCreditsSpent: number;
  aiCreditsReserved: number;
  createdAt: string;
  startedAt: string | null;
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
  | { state: 'error'; reason: string; message?: string };

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
  let [created] = await query(dbAdapter, [
    'INSERT INTO automation_runs (automation_id, realm, trigger, slot, acts_as) VALUES (',
    param(run.automationId),
    ',',
    param(run.realm),
    ',',
    param(run.trigger),
    ',',
    param(run.slot),
    ',',
    param(run.actsAs),
    ') ON CONFLICT ON CONSTRAINT automation_runs_slot_key DO NOTHING RETURNING *',
  ]);
  if (created) {
    return runFromRow(created);
  }
  let [existing] = await query(dbAdapter, [
    'SELECT * FROM automation_runs WHERE automation_id =',
    param(run.automationId),
    'AND trigger =',
    param(run.trigger),
    'AND slot =',
    param(run.slot),
  ]);
  return runFromRow(existing);
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

// Makes `attempt` the owner of a pending or running run, and says what it must
// do next. A running run is taken over by an attempt at least as new as its
// owner: the attempt that owned it is refused from then on. `started_at` keeps
// the first attempt's start.
export async function startAutomationRunAttempt(
  dbAdapter: DBAdapter,
  id: string,
  attempt: number,
): Promise<AutomationRunAttemptStart> {
  let [row] = await query(dbAdapter, [
    "UPDATE automation_runs SET state = 'running', attempt =",
    param(attempt),
    ', started_at = COALESCE(started_at, now()) WHERE id =',
    param(id),
    "AND state IN ('pending', 'running') AND (attempt IS NULL OR attempt <=",
    param(attempt),
    ') RETURNING *',
  ]);
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
    "AND state IN ('running', 'error') AND commit_started_at IS NOT NULL AND committed_at IS NULL RETURNING *",
  ]);
  return row ? runFromRow(row) : undefined;
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
  if (outcome.state === 'complete') {
    return await updateOwned(
      dbAdapter,
      id,
      attempt,
      ["state = 'complete', finished_at = now()"],
      ['AND (commit_started_at IS NULL OR committed_at IS NOT NULL)'],
    );
  }
  return await updateOwned(
    dbAdapter,
    id,
    attempt,
    [
      "state = 'error', finished_at = now(), error_reason =",
      param(outcome.reason),
      ', error_message =',
      param(outcome.message ?? null),
    ],
    ['AND committed_at IS NULL'],
  );
}

// Closes a pending or running run whose job is gone, such as one whose job ran
// out of retries, whoever owned it. A run whose commit landed finishes as
// complete. Any other run finishes as an error with `reason`, including one
// whose commit was claimed but never recorded as landed.
export async function abandonAutomationRun(
  dbAdapter: DBAdapter,
  id: string,
  reason: string,
): Promise<AutomationRun | undefined> {
  let [row] = await query(dbAdapter, [
    'UPDATE automation_runs SET finished_at = now(),',
    "state = CASE WHEN committed_at IS NOT NULL THEN 'complete' ELSE 'error' END,",
    'error_reason = CASE WHEN committed_at IS NOT NULL THEN NULL ELSE',
    param(reason),
    'END WHERE id =',
    param(id),
    "AND state IN ('pending', 'running') RETURNING *",
  ]);
  return row ? runFromRow(row) : undefined;
}

// Cancels a pending or running run, for `canceledBy`. A run whose commit was
// claimed can't be canceled, since its writes may already be landing.
export async function cancelAutomationRun(
  dbAdapter: DBAdapter,
  id: string,
  canceledBy: string,
): Promise<AutomationRun | undefined> {
  let [row] = await query(dbAdapter, [
    "UPDATE automation_runs SET state = 'canceled', finished_at = now(), canceled_by =",
    param(canceledBy),
    'WHERE id =',
    param(id),
    "AND state IN ('pending', 'running') AND commit_started_at IS NULL RETURNING *",
  ]);
  return row ? runFromRow(row) : undefined;
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
export async function reserveAutomationRunAICredits(
  dbAdapter: DBAdapter,
  id: string,
  credits: number,
  cap: number,
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
  return { kind: run.state === 'running' ? 'over-cap' : 'not-running', run };
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
// undefined when the run isn't running or `attempt` doesn't own it.
async function updateOwned(
  dbAdapter: DBAdapter,
  id: string,
  attempt: number,
  set: Expression,
  where: Expression = [],
): Promise<AutomationRun | undefined> {
  let [row] = await query(dbAdapter, [
    'UPDATE automation_runs SET',
    ...set,
    'WHERE id =',
    param(id),
    "AND state = 'running' AND attempt =",
    param(attempt),
    ...where,
    'RETURNING *',
  ]);
  return row ? runFromRow(row) : undefined;
}

function runFromRow(row: Record<string, PgPrimitive>): AutomationRun {
  return {
    id: String(row.id),
    automationId: row.automation_id as RealmResourceIdentifier,
    realm: row.realm as RealmIdentifier,
    trigger: String(row.trigger),
    slot: String(row.slot),
    actsAs: String(row.acts_as),
    attempt: row.attempt == null ? null : Number(row.attempt),
    scriptId: (row.script_id as RealmResourceIdentifier | null) ?? null,
    scriptHash: (row.script_hash as string | null) ?? null,
    state: row.state as AutomationRunState,
    errorReason: (row.error_reason as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    canceledBy: (row.canceled_by as string | null) ?? null,
    callApiCalls: Number(row.call_api_calls),
    callApiResponseBytes: Number(row.call_api_response_bytes),
    resolveCalls: Number(row.resolve_calls),
    writes: Number(row.writes),
    aiCreditsSpent: Number(row.ai_credits_spent ?? 0),
    aiCreditsReserved: Number(row.ai_credits_reserved ?? 0),
    createdAt: iso(row.created_at)!,
    startedAt: iso(row.started_at),
    commitStartedAt: iso(row.commit_started_at),
    committedAt: iso(row.committed_at),
    finishedAt: iso(row.finished_at),
  };
}

function iso(value: PgPrimitive | undefined): string | null {
  if (value == null) {
    return null;
  }
  return new Date(value as string).toISOString();
}
