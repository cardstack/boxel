import { Sha256 } from '@aws-crypto/sha256-js';

import {
  admitRunIdentity,
  admitRunOperations,
  scriptRefusal,
  type AdmittedRunKind,
  type AutomationAdmissionChecks,
} from '../automation-admission.ts';
import { MAX_RUN_SECONDS } from '../automation-declaration.ts';
import { automationVersion, versionKeyOf } from '../automation-key-approval.ts';
import {
  type AutomationJobInput,
  type AutomationRunTriggerKind,
  type AutomationScriptInput,
  type AutomationScriptOutcome,
  AUTOMATION_COMMAND,
  AUTOMATION_TAB_GRACE_MS,
  automationRunDedupeKey,
  isWebhookDeliverySlot,
  isAutomationScriptOutcome,
  MAX_WEBHOOK_PAYLOAD_CHARS,
  scriptErrorText,
  WEBHOOK_PAYLOAD_TOO_LARGE_REASON,
} from '../automation-run-command.ts';
import type { ReportAutomationChange } from '../automation-change-events.ts';
import type { ReportRunChange } from '../automation-run-events.ts';
import { readRunLimits, readRunDeclaration } from '../automation-run-limits.ts';
import { pauseAfterRepeatedFailures } from '../automations.ts';
import { JOB_LOST_REASON } from '../automation-reconcile.ts';
import { logRunPlatformLine } from '../automation-run-log.ts';
import {
  automationRunLogTag,
  emitAutomationRunEvent,
  type AutomationRunIds,
  type AutomationRunScriptEvent,
} from '../automation-run-telemetry.ts';
import { chargeAutomationRun } from '../automation-run-charge.ts';
import {
  addAutomationRunTabTime,
  finishAutomationRun,
  getAutomationRun,
  recordAutomationRunAdmitted,
  recordAutomationRunScript,
  recordAutomationRunVersion,
  startAutomationRunAttempt,
  type AutomationRun,
  type AutomationRunOutcome,
} from '../automation-runs.ts';
import type { DBAdapter } from '../db.ts';
import type { MeteredCharges } from '../metered-charges.ts';
import type { DefinitionLookup } from '../definition-lookup.ts';
import { param, query } from '../expression.ts';
import {
  ensureTrailingSlash,
  uint8ArrayToHex,
  type Prerenderer,
  type PrerenderResponseMeta,
  type RunCommandResponse,
} from '../index.ts';
import { renderTabMs } from '../run-indexing.ts';
import { RUN_COMMIT_PATH } from '../run-overlay.ts';
import { SupportedMimeType } from '../supported-mime-type.ts';
import type { VirtualNetwork } from '../virtual-network.ts';
import type { JobInfo } from '../worker.ts';

// Mints the token one attempt of a run carries (ADR 026 §1.2). The realm
// server's `mintRunToken` with the process's secret seed; injected because
// signing needs that seed, which only the worker process holds.
export type MintRunToken = (args: {
  run: AutomationRun;
  // The URL the automation's realm is served at.
  realmURL: string;
  readRealms: string[];
  writesCap: number;
  timeLimitSeconds: number;
}) => string;

// The realms a run's cards' modules load from, which its token lets it read.
// Each realm resolves the prefix form through its own mappings.
export const RUN_READ_REALMS = ['@cardstack/base/', '@cardstack/catalog/'];

// How many times a commit is sent again when a write was staged while it
// started (`overlay-changed`).
const MAX_COMMIT_ATTEMPTS = 3;

type Log = {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

export interface AutomationAttemptContext {
  dbAdapter: DBAdapter;
  definitionLookup: DefinitionLookup;
  virtualNetwork: VirtualNetwork;
  prerenderer: Prerenderer;
  mintRunToken: MintRunToken | undefined;
  // The paired Matrix server, whose bot accounts are never direct writers.
  matrixServerName: string | undefined;
  // What admission asks the realm server's side of the worker (see
  // `automation-admission.ts`). A worker without them admits no run.
  admissionChecks: AutomationAdmissionChecks | undefined;
  // Writes the run's compute and network charge once the run has ended.
  // Without it, as in a harness, the run is measured and nothing is charged.
  meteredCharges?: MeteredCharges;
  // How many of an automation's own runs fail in a row before it pauses
  // itself; `AUTOMATION_FAILURES_BEFORE_PAUSE` when absent.
  failuresBeforePause?: number;
  // Told each time the attempt moves the run: it starts it, admits it, or
  // ends it, and when a pause the admission makes cancels other runs.
  reportRunChange?: ReportRunChange;
  // Told when the attempt changes the automation: the admission pauses it or
  // moves it into or out of waiting for credits, or its runs' repeated
  // failures pause it.
  reportAutomationChange?: ReportAutomationChange;
  log: Log;
}

export interface AutomationAttemptResult {
  // What became of the run: the state this attempt left it in, or `left`
  // when this attempt didn't own the run and left it alone.
  state: 'complete' | 'error' | 'left';
  reason?: string;
  message?: string;
}

// Runs one attempt of an automation run (ADR 025, ADR 027 §1.4): takes the
// run through its row, admits it (`automation-admission.ts`), which refuses a
// run that can't go ahead before it costs anything, runs its script in a warm
// prerender tab on the run's own affinity with the run's token, then commits
// the overlay as one batch or, for a script that threw or ran out of time,
// discards it and records the error. The run row is the source of truth:
// every step is refused once a newer attempt owns the run, a person cancels
// it, or it ends at a cap.
//
// The tab time the script takes is added to the run's row (see
// `addTabTime`), and once the attempt is done, a run that has ended (however
// it ended, including one a person canceled while its script ran) is charged
// its compute and network (`chargeAutomationRun`). The charge is written even
// when the attempt throws, since the run may have ended before it did, and
// the queue doesn't run a job again after its handler throws.
export async function runAutomationAttempt(
  ctx: AutomationAttemptContext,
  input: AutomationJobInput,
  dedupeKey: string | null,
  jobInfo: JobInfo | undefined,
): Promise<AutomationAttemptResult> {
  let result: AutomationAttemptResult | undefined;
  try {
    result = await attemptRun(ctx, input, dedupeKey, jobInfo);
    return result;
  } finally {
    if (result?.reason !== NOT_THE_RUNS_JOB) {
      await chargeAutomationRun({
        dbAdapter: ctx.dbAdapter,
        meteredCharges: ctx.meteredCharges,
        runId: input.runId,
        log: ctx.log,
      });
      await pauseIfFailingRepeatedly(ctx, input.runId);
    }
  }
}

// Once the run has ended as an error, however it ended (this attempt's
// finish, a cap or a refused credential that the realm server ended it at,
// or an earlier attempt), pauses its automation if its own runs have now
// failed `failuresBeforePause` times in a row. The streak is read from the
// runs, so an attempt that finds the run already over asks again harmlessly.
// A failure to pause is logged: the run's outcome is recorded already, and the
// next failed run asks again.
async function pauseIfFailingRepeatedly(
  ctx: AutomationAttemptContext,
  runId: string,
): Promise<void> {
  try {
    let run = await getAutomationRun(ctx.dbAdapter, runId);
    if (!run || run.state !== 'error') {
      return;
    }
    let result = await pauseAfterRepeatedFailures(
      ctx.dbAdapter,
      run.automationId,
      {
        ...(ctx.failuresBeforePause !== undefined
          ? { failuresBeforePause: ctx.failuresBeforePause }
          : {}),
      },
      {
        reportRunChange: ctx.reportRunChange,
        reportAutomationChange: ctx.reportAutomationChange,
      },
    );
    if (result?.paused) {
      ctx.log.warn(
        `automation ${run.automationId} paused after repeated failed runs; the last was run ${runId} (${run.errorReason ?? 'error'})`,
      );
    }
  } catch (e: any) {
    ctx.log.error(
      `could not check whether automation run ${runId}'s failure pauses its automation: ${e?.message ?? e}`,
    );
  }
}

const NOT_THE_RUNS_JOB = 'not-the-runs-job';

async function attemptRun(
  ctx: AutomationAttemptContext,
  input: AutomationJobInput,
  dedupeKey: string | null,
  jobInfo: JobInfo | undefined,
): Promise<AutomationAttemptResult> {
  let { dbAdapter, log } = ctx;
  let { runId } = input;
  if (!jobInfo) {
    throw new Error(`run ${runId} needs a queue attempt to own it`);
  }
  let attempt = jobInfo.reservationId;
  // Only the run's own job runs it: one whose key names the run's
  // automation, trigger and slot. Any other job naming the run touches
  // nothing.
  let named = await getAutomationRun(dbAdapter, runId);
  // Every line this attempt logs, and every telemetry event it writes,
  // carries the run's automation, the run, its queue job and the attempt.
  let ids: AutomationRunIds = {
    automation: named?.automationId ?? 'unknown',
    run: runId,
    job: jobInfo.jobId,
    attempt,
  };
  let tag = automationRunLogTag(ids);
  if (!named || dedupeKey !== automationRunDedupeKey(named)) {
    log.warn(
      `${tag} refused: the job's key ${JSON.stringify(dedupeKey)} isn't the run's`,
    );
    return { state: 'left', reason: NOT_THE_RUNS_JOB };
  }

  let start = await startAutomationRunAttempt(dbAdapter, runId, attempt);
  let claimedAt = Date.now();
  // An attempt that takes the run claims it, whether it runs the script or
  // finishes a run an earlier attempt committed; one that leaves the run
  // alone claims nothing.
  if (
    start.kind === 'run' ||
    start.kind === 'committed' ||
    start.kind === 'commit-interrupted'
  ) {
    emitAutomationRunEvent({
      kind: 'claimed',
      ...ids,
      claimedAt: new Date(claimedAt).toISOString(),
      ...(jobInfo.queueWaitMs != null
        ? { queueWaitMs: jobInfo.queueWaitMs }
        : {}),
      ...(jobInfo.concurrencyGroup ? { lane: jobInfo.concurrencyGroup } : {}),
      priority: jobInfo.priority,
    });
    await ctx.reportRunChange?.(runId);
  }
  switch (start.kind) {
    case 'committed':
      return await finish(ctx, tag, runId, attempt, { state: 'complete' });
    case 'commit-interrupted':
      return await finish(ctx, tag, runId, attempt, {
        state: 'error',
        reason: 'commit-interrupted',
        message:
          'An earlier attempt claimed the commit and stopped before recording whether it landed',
      });
    case 'superseded':
    case 'over':
    case 'missing':
      log.info(`${tag} left alone: the run is ${start.kind}`);
      return { state: 'left', reason: start.kind };
  }
  let run = start.run;
  let fail = (reason: string, message: string) =>
    finish(ctx, tag, runId, attempt, { state: 'error', reason, message });
  let admitted = (reason?: string) =>
    emitAutomationRunEvent({
      kind: 'admitted',
      ...ids,
      admitted: reason === undefined,
      ...(reason !== undefined ? { reason } : {}),
      at: new Date().toISOString(),
      admissionMs: Date.now() - claimedAt,
    });
  // A refusal at admission: the run ends with the refusal's code, and its
  // log says admission refused it.
  let refuse = async (reason: string, message: string) => {
    admitted(reason);
    await logRunPlatformLine(dbAdapter, runId, {
      kind: 'admission',
      level: 'error',
      message: `Admission refused the run (${reason}): ${message}`,
      data: { admitted: false, reason, actsAs: run.actsAs },
    });
    return await fail(reason, message);
  };
  // The row decides whether the run is a Preview, since everything after
  // the run (its kept batch, its report, `lastSuccessAt`) reads the row. A
  // job that says otherwise runs nothing, so a run its job calls a Preview
  // never commits.
  let dryRun = run.dryRun;
  if (input.dryRun !== dryRun) {
    return await fail(
      'dry-run-mismatch',
      `The run's job ${input.dryRun ? 'is' : "isn't"} a Preview and its row ${dryRun ? 'is' : "isn't"}, so the run didn't start`,
    );
  }

  // A delivery whose body was too large to send to the tab ends its run
  // before anything else, so a redelivery of the same body ends the same way.
  if (input.webhookPayloadChars !== undefined) {
    return await fail(
      WEBHOOK_PAYLOAD_TOO_LARGE_REASON,
      `The webhook delivery's body is ${input.webhookPayloadChars} characters, more than the ${MAX_WEBHOOK_PAYLOAD_CHARS} a run takes, so the script didn't run`,
    );
  }

  // A webhook delivery's run needs the delivery's payload, which only its
  // job carries. A job without one (made again by something other than the
  // delivery) would run the script on nothing, so the run ends as lost, as
  // reconcile ends a webhook run whose job is gone.
  if (
    input.triggerKind === undefined &&
    isWebhookDeliverySlot(run.slot) &&
    input.webhookPayload === undefined
  ) {
    return await fail(
      JOB_LOST_REASON,
      "The webhook delivery's run has no payload in its job, so it didn't start",
    );
  }

  let realmURL = ensureTrailingSlash(ctx.virtualNetwork.toURLHref(run.realm));
  let [limits, declaration] = await Promise.all([
    readRunLimits({ ...ctx, automationId: run.automationId }),
    readRunDeclaration({ ...ctx, automationId: run.automationId }),
  ]);
  if (!limits.ok || !declaration.ok) {
    return await refuse(
      'not-an-automation',
      !limits.ok
        ? limits.message
        : (declaration as { message: string }).message,
    );
  }
  // The job says how the run was started; a run without a `triggerKind` is
  // a trigger's, even when the card no longer names its trigger.
  let kind: AdmittedRunKind =
    input.triggerKind === 'manual'
      ? 'manual'
      : input.triggerKind === 'batch'
        ? 'batch'
        : 'trigger';
  let admission = {
    dbAdapter,
    virtualNetwork: ctx.virtualNetwork,
    matrixServerName: ctx.matrixServerName,
    checks: ctx.admissionChecks,
    reportRunChange: ctx.reportRunChange,
    reportAutomationChange: ctx.reportAutomationChange,
  };
  let identity = await admitRunIdentity(admission, run, { kind });
  if (!identity.ok) {
    let refused = await refuse(identity.reason, identity.message);
    // The payer lost access: the automation pauses, which cancels its other
    // unfinished runs, once this one has ended with its refusal's code. The
    // run's outcome is already recorded, so a pause that fails is logged and
    // the next run's admission pauses it.
    try {
      await identity.pause?.();
    } catch (e: any) {
      log.error(
        `${tag} couldn't pause the automation after its payer lost access: ${e?.message ?? e}`,
      );
    }
    return refused;
  }

  let { caps } = limits;
  let timeLimitSeconds = Math.min(caps.seconds, MAX_RUN_SECONDS);
  // A retry keeps the run's first start, so it gets what is left of the
  // run's time, never a fresh limit.
  let deadline = Date.parse(run.startedAt!) + timeLimitSeconds * 1000;
  let remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    return await fail(
      'timed-out',
      `The automation run reached its time limit of ${timeLimitSeconds} s (its seconds cap) before this attempt started`,
    );
  }
  if (!ctx.mintRunToken) {
    return await fail(
      'run-failed',
      'This worker has no way to mint a run token, so it runs no automation',
    );
  }
  let token = ctx.mintRunToken({
    run,
    realmURL,
    readRealms: RUN_READ_REALMS,
    writesCap: caps.writes,
    timeLimitSeconds,
  });
  let redact = (text: string) => text.split(token).join('[REDACTED]');

  // The script: read with the run's token, so the read is the run's own and
  // takes the realm's check as the run's identity.
  let scriptURL = ctx.virtualNetwork.toURLHref(declaration.declaration.script);
  let code: string;
  try {
    let response = await ctx.virtualNetwork.fetch(scriptURL, {
      headers: {
        Accept: SupportedMimeType.CardSource,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      return await refuse(
        'missing-script',
        `The script ${scriptURL} could not be read: ${response.status}`,
      );
    }
    code = await response.text();
  } catch (e: any) {
    return await refuse(
      'missing-script',
      redact(`The script ${scriptURL} could not be read: ${e?.message ?? e}`),
    );
  }
  let unrunnable = scriptRefusal(code, scriptURL);
  if (unrunnable) {
    return await refuse(unrunnable.reason, unrunnable.message);
  }
  // The automation's version as this attempt read its card and script, with
  // the run's identity as payer, and the operations the card declared: the
  // realm admits those operations and compares each binding's automation
  // approval with that version, at admission and at every call the run
  // makes, so an edit landing after these reads never decides what the run
  // is served by.
  let version = await versionKeyOf(
    await automationVersion(declaration.declaration, {
      payer: run.actsAs,
      script: code,
    }),
  );
  if (
    !(await recordAutomationRunVersion(
      dbAdapter,
      runId,
      attempt,
      version,
      declaration.declaration.operations,
    ))
  ) {
    log.info(`${tag} left alone: another attempt owns the run, or it ended`);
    return { state: 'left', reason: 'superseded' };
  }
  let operationsAdmitted = await admitRunOperations(admission, run, {
    automation: identity.automation,
    caps,
    kind,
    realmURL,
    token,
  });
  if (!operationsAdmitted.ok) {
    return await refuse(operationsAdmitted.reason, operationsAdmitted.message);
  }
  if (!(await recordAutomationRunAdmitted(dbAdapter, runId, attempt))) {
    log.info(`${tag} left alone: another attempt owns the run, or it ended`);
    return { state: 'left', reason: 'superseded' };
  }
  admitted();
  await ctx.reportRunChange?.(runId);
  await logRunPlatformLine(dbAdapter, runId, {
    kind: 'admission',
    level: 'info',
    message: `Admitted the run as ${run.actsAs}, with ${operationsAdmitted.operations} declared ${operationsAdmitted.operations === 1 ? 'operation' : 'operations'} checked`,
    data: {
      admitted: true,
      actsAs: run.actsAs,
      operations: operationsAdmitted.operations,
    },
  });
  let recorded = await recordAutomationRunScript(dbAdapter, runId, attempt, {
    scriptId: declaration.declaration.script,
    scriptHash: await scriptHash(code),
  });
  if (!recorded) {
    log.info(`${tag} left alone: another attempt owns the run, or it ended`);
    return { state: 'left', reason: 'superseded' };
  }

  let scriptInput: AutomationScriptInput = {
    code,
    realmURL,
    automation: {
      url: ctx.virtualNetwork.toURLHref(run.automationId),
      trigger: {
        label: run.trigger,
        kind: triggerKind(input, run, declaration.declaration.triggers),
      },
      scheduledAt: input.scheduledAt,
      ...(await lastSuccessAt(dbAdapter, run)),
      params: declaration.declaration.params,
      ...(input.webhookPayload !== undefined
        ? { webhookPayload: input.webhookPayload }
        : {}),
      dryRun,
    },
    secondsCap: remainingMs / 1000,
    endsAt: new Date(deadline).toISOString(),
    batchDeadlineMinutes: declaration.declaration.batchDeadlineMinutes,
  };

  let outcome: AutomationScriptOutcome;
  let tabStartedAt = Date.now();
  let tabMs = 0;
  let result: RunCommandResponse | undefined;
  try {
    result = await ctx.prerenderer.runCommand({
      userId: run.actsAs,
      runRealm: realmURL,
      auth: JSON.stringify({ [realmURL]: token }),
      command: AUTOMATION_COMMAND,
      commandInput: { json: scriptInput },
      priority: jobInfo.priority,
      timeoutMs: remainingMs + AUTOMATION_TAB_GRACE_MS,
    });
    tabMs = Math.max(
      0,
      Math.min(renderTabMs(result?.meta, tabStartedAt), remainingMs),
    );
    await addTabTime(ctx, runId, tabMs);
    outcome = outcomeOf(result, redact);
  } catch (e: any) {
    // A call that throws carries no measure from a prerender server, and
    // may never have reached a tab (the request found no server, or every
    // try was refused), so it adds no tab time.
    outcome = {
      state: 'error',
      reason: 'run-failed',
      message: redact(`The run's tab failed: ${e?.message ?? e}`),
    };
  }
  let answered = outcome;
  let answer = result;
  emitAutomationRunEvent(() =>
    scriptEvent(ids, tabStartedAt, tabMs, answered, answer),
  );
  if (outcome.state === 'error') {
    // The finish discards the overlay, so nothing the script staged lands.
    return await fail(
      outcome.reason,
      scriptErrorText(outcome.message, outcome.line),
    );
  }
  if (dryRun) {
    // A Preview stops before the commit. Its finish keeps a copy of what it
    // staged as the batch it shows, discards the overlay, and nothing
    // reaches the realm.
    return await finish(ctx, tag, runId, attempt, { state: 'complete' });
  }
  return await commit(ctx, tag, ids, run, attempt, realmURL, token);
}

// Records the tab time the script took on the run's row, where the run's
// charge reads it. The caller holds the time to what was left of the run's
// time limit when the script started: the tab call's grace past the limit
// (`AUTOMATION_TAB_GRACE_MS`) lets the tab answer, and isn't charged, so a
// run's compute never costs more than its seconds cap prices it at in the
// minimum balance and the switch-on estimate. A failure to record it is
// logged rather than failing the run, whose script has already run.
async function addTabTime(
  ctx: AutomationAttemptContext,
  runId: string,
  ms: number,
): Promise<void> {
  try {
    await addAutomationRunTabTime(ctx.dbAdapter, runId, ms);
  } catch (e) {
    ctx.log.error(`could not record ${ms} ms of tab time on run ${runId}`, e);
  }
}

async function commit(
  ctx: AutomationAttemptContext,
  tag: string,
  ids: AutomationRunIds,
  run: AutomationRun,
  attempt: number,
  realmURL: string,
  token: string,
): Promise<AutomationAttemptResult> {
  let commitURL = new URL(RUN_COMMIT_PATH.replace(/^\//, ''), realmURL).href;
  let sentAt = Date.now();
  let answered = (
    tries: number,
    outcome: 'committed' | 'refused' | 'failed',
    details: { code?: string; status?: number } = {},
  ) => {
    let answeredAt = Date.now();
    emitAutomationRunEvent({
      kind: 'commit',
      ...ids,
      outcome,
      ...(details.code ? { code: details.code } : {}),
      ...(details.status !== undefined ? { status: details.status } : {}),
      commitSentAt: new Date(sentAt).toISOString(),
      answeredAt: new Date(answeredAt).toISOString(),
      ms: answeredAt - sentAt,
      tries,
    });
  };
  for (let tries = 1; ; tries++) {
    let response: Response;
    try {
      response = await ctx.virtualNetwork.fetch(commitURL, {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.JSONAPI,
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (e: any) {
      // Whether the batch landed is unknown. The realm answers this
      // attempt's commit again with the same success once it has landed, so
      // it is sent again; when every try fails, the run's row says whether
      // it landed.
      if (tries < MAX_COMMIT_ATTEMPTS) {
        continue;
      }
      answered(tries, 'failed');
      return await finishAfterCommit(ctx, tag, run.id, attempt, {
        state: 'error',
        reason: 'commit-failed',
        message: `The commit could not be sent: ${e?.message ?? e}`,
      });
    }
    if (response.ok) {
      answered(tries, 'committed', { status: response.status });
      return await finish(ctx, tag, run.id, attempt, { state: 'complete' });
    }
    let { code, detail } = await refusalOf(response);
    if (code === 'overlay-changed' && tries < MAX_COMMIT_ATTEMPTS) {
      continue;
    }
    answered(tries, 'refused', { code, status: response.status });
    // A 401 means the run stopped running (a cancel, a cap, a newer
    // attempt) or its time ran out; the finish below is refused unless this
    // attempt still owns a running run.
    return await finishAfterCommit(ctx, tag, run.id, attempt, {
      state: 'error',
      reason:
        code ?? (response.status === 401 ? 'not-running' : 'commit-failed'),
      message: `The commit was refused (${response.status}): ${detail}`,
    });
  }
}

// Finishes a run whose commit was sent as an error, unless its batch landed
// after all: a run whose commit landed can't finish as an error, so it
// finishes as complete instead of staying running.
async function finishAfterCommit(
  ctx: AutomationAttemptContext,
  tag: string,
  runId: string,
  attempt: number,
  outcome: AutomationRunOutcome,
): Promise<AutomationAttemptResult> {
  let run = await getAutomationRun(ctx.dbAdapter, runId);
  if (run?.committedAt) {
    return await finish(ctx, tag, runId, attempt, { state: 'complete' });
  }
  return await finish(ctx, tag, runId, attempt, outcome);
}

async function finish(
  ctx: AutomationAttemptContext,
  tag: string,
  runId: string,
  attempt: number,
  outcome: AutomationRunOutcome,
): Promise<AutomationAttemptResult> {
  let finished = await finishAutomationRun(
    ctx.dbAdapter,
    runId,
    attempt,
    outcome,
  );
  if (!finished) {
    // Another attempt owns the run, it was canceled, or it already ended
    // (at a cap, say). The row says how; this attempt changes nothing.
    ctx.log.info(
      `${tag} could not finish the run as ${outcome.state}: it no longer owns a running run`,
    );
    return { state: 'left' };
  }
  await ctx.reportRunChange?.(runId);
  if (outcome.state === 'error') {
    ctx.log.warn(
      `${tag} ended as an error (${outcome.reason}): ${outcome.message ?? ''}`,
    );
    return {
      state: 'error',
      reason: outcome.reason,
      message: outcome.message,
    };
  }
  ctx.log.info(`${tag} complete`);
  return { state: 'complete' };
}

// The run's `script` telemetry event: when the tab was asked for and
// answered, by the worker's clock; when the script started and ended, by the
// tab's (`AutomationScriptOutcome.timing`); and how long the prerender server
// took to give the call a tab, by its own measure.
function scriptEvent(
  ids: AutomationRunIds,
  requestedAt: number,
  tabMs: number,
  outcome: AutomationScriptOutcome,
  result?: RunCommandResponse,
): AutomationRunScriptEvent {
  let answeredAt = Date.now();
  let diagnostics = (result?.meta as PrerenderResponseMeta | undefined)
    ?.diagnostics;
  let launchMs =
    typeof diagnostics?.launchMs === 'number'
      ? diagnostics.launchMs
      : undefined;
  let timing = scriptTimingOf(outcome);
  let tab = diagnostics?.tabMemory;
  let iso = (ms: number) => new Date(ms).toISOString();
  return {
    kind: 'script',
    ...ids,
    outcome: outcome.state,
    ...(outcome.state === 'error' ? { reason: outcome.reason } : {}),
    tabRequestedAt: iso(requestedAt),
    ...(launchMs !== undefined ? { tabLaunchMs: launchMs } : {}),
    tabAnsweredAt: iso(answeredAt),
    ...(timing
      ? {
          scriptStartedAt: iso(timing.startedAt),
          scriptEndedAt: iso(timing.endedAt),
          scriptMs: Math.max(0, timing.endedAt - timing.startedAt),
        }
      : {}),
    ...(diagnostics?.waits?.tabQueueMs !== undefined
      ? { tabQueueMs: diagnostics.waits.tabQueueMs }
      : {}),
    ...(diagnostics?.waits?.tabStartupMs !== undefined
      ? { tabStartupMs: diagnostics.waits.tabStartupMs }
      : {}),
    ...(diagnostics?.tabReused !== undefined
      ? { tabReused: diagnostics.tabReused }
      : {}),
    tabMs,
    ...(result?.meta?.requestId
      ? { prerenderRequestId: result.meta.requestId }
      : diagnostics?.requestId
        ? { prerenderRequestId: diagnostics.requestId }
        : {}),
    ...(tab
      ? {
          tabJsHeapUsedMB: tab.jsUsedMB,
          tabJsHeapTotalMB: tab.jsTotalMB,
          tabDomMB: tab.domMB,
          tabBuffersMB: tab.buffersMB,
        }
      : {}),
  };
}

// When the script started and ended in its tab, as the automation command
// answered them on its outcome. Absent from a tab that never answered.
function scriptTimingOf(
  outcome: AutomationScriptOutcome,
): { startedAt: number; endedAt: number } | undefined {
  let timing = outcome.timing;
  return typeof timing?.startedAt === 'number' &&
    typeof timing?.endedAt === 'number' &&
    Number.isFinite(timing.startedAt) &&
    Number.isFinite(timing.endedAt)
    ? { startedAt: timing.startedAt, endedAt: timing.endedAt }
    : undefined;
}

// What the tab answered. The command answers a script's own failure as an
// `error` outcome; a command that failed outright, or a tab that never
// answered, is the run failing around the script.
function outcomeOf(
  result: RunCommandResponse,
  redact: (text: string) => string,
): AutomationScriptOutcome {
  if (result.status === 'unusable') {
    return {
      state: 'error',
      reason: 'timed-out',
      message: redact(
        `The run's tab didn't answer within the run's time limit${result.error ? `: ${result.error}` : ''}`,
      ),
    };
  }
  if (result.status !== 'ready') {
    return {
      state: 'error',
      reason: 'run-failed',
      message: redact(`The automation command failed: ${result.error ?? ''}`),
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(result.cardResultString ?? '')?.data?.attributes?.json;
  } catch {
    json = undefined;
  }
  if (!isAutomationScriptOutcome(json)) {
    return {
      state: 'error',
      reason: 'run-failed',
      message: 'The automation command answered without an outcome',
    };
  }
  return json.state === 'error'
    ? { ...json, message: redact(json.message) }
    : json;
}

async function refusalOf(
  response: Response,
): Promise<{ code: string | undefined; detail: string }> {
  let text = await response.text().catch(() => '');
  try {
    let error = JSON.parse(text)?.errors?.[0];
    if (error && typeof error === 'object') {
      return {
        code: typeof error.code === 'string' ? error.code : undefined,
        detail: String(error.detail ?? error.title ?? text),
      };
    }
  } catch {
    // not JSON:API
  }
  return { code: undefined, detail: text };
}

function triggerKind(
  input: AutomationJobInput,
  run: AutomationRun,
  triggers: { label: string; kind: 'cron' | 'once' | 'webhook' }[],
): AutomationRunTriggerKind {
  if (input.triggerKind) {
    return input.triggerKind;
  }
  return triggers.find((t) => t.label === run.trigger)?.kind ?? 'manual';
}

// When the automation's last complete run started, other than this one. A
// Preview wrote nothing, so it never counts.
async function lastSuccessAt(
  dbAdapter: DBAdapter,
  run: AutomationRun,
): Promise<{ lastSuccessAt?: string }> {
  let [row] = await query(dbAdapter, [
    'SELECT started_at FROM automation_runs WHERE automation_id =',
    param(run.automationId),
    "AND state = 'complete' AND NOT dry_run AND started_at IS NOT NULL AND id <>",
    param(run.id),
    'ORDER BY started_at DESC LIMIT 1',
  ]);
  let startedAt = row?.started_at;
  if (startedAt == null) {
    return {};
  }
  let date =
    startedAt instanceof Date
      ? startedAt
      : new Date(typeof startedAt === 'number' ? startedAt : String(startedAt));
  return Number.isNaN(date.getTime())
    ? {}
    : { lastSuccessAt: date.toISOString() };
}

async function scriptHash(code: string): Promise<string> {
  let hash = new Sha256();
  hash.update(new TextEncoder().encode(code));
  return uint8ArrayToHex(await hash.digest());
}
