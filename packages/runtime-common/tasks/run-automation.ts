import { Sha256 } from '@aws-crypto/sha256-js';

import { MAX_RUN_SECONDS } from '../automation-declaration.ts';
import {
  type AutomationJobInput,
  type AutomationRunTriggerKind,
  type AutomationScriptInput,
  type AutomationScriptOutcome,
  AUTOMATION_COMMAND,
  AUTOMATION_TAB_GRACE_MS,
  MAX_AUTOMATION_SCRIPT_CHARS,
  automationRunDedupeKey,
  isAutomationScriptOutcome,
} from '../automation-run-command.ts';
import { readRunLimits, readRunDeclaration } from '../automation-run-limits.ts';
import {
  finishAutomationRun,
  getAutomationRun,
  recordAutomationRunScript,
  startAutomationRunAttempt,
  type AutomationRun,
  type AutomationRunOutcome,
} from '../automation-runs.ts';
import type { DBAdapter } from '../db.ts';
import type { DefinitionLookup } from '../definition-lookup.ts';
import { param, query } from '../expression.ts';
import {
  ensureTrailingSlash,
  uint8ArrayToHex,
  type Prerenderer,
  type RunCommandResponse,
} from '../index.ts';
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
// run through its row, runs its script in a warm prerender tab on the run's
// own affinity with the run's token, then commits the overlay as one batch
// or, for a script that threw or ran out of time, discards it and records the
// error. The run row is the source of truth: every step is refused once a
// newer attempt owns the run, a person cancels it, or it ends at a cap.
export async function runAutomationAttempt(
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
  let tag = `automation run ${runId} attempt ${attempt}`;

  // Only the run's own job runs it: one whose key names the run's
  // automation, trigger and slot. Any other job naming the run touches
  // nothing.
  let named = await getAutomationRun(dbAdapter, runId);
  if (!named || dedupeKey !== automationRunDedupeKey(named)) {
    log.warn(
      `${tag} refused: the job's key ${JSON.stringify(dedupeKey)} isn't the run's`,
    );
    return { state: 'left', reason: 'not-the-runs-job' };
  }

  let start = await startAutomationRunAttempt(dbAdapter, runId, attempt);
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

  let realmURL = ensureTrailingSlash(ctx.virtualNetwork.toURLHref(run.realm));
  let [limits, declaration] = await Promise.all([
    readRunLimits({ ...ctx, automationId: run.automationId }),
    readRunDeclaration({ ...ctx, automationId: run.automationId }),
  ]);
  if (!limits.ok || !declaration.ok) {
    return await fail(
      'not-an-automation',
      !limits.ok
        ? limits.message
        : (declaration as { message: string }).message,
    );
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
      return await fail(
        'missing-script',
        `The script ${scriptURL} could not be read: ${response.status}`,
      );
    }
    code = await response.text();
  } catch (e: any) {
    return await fail(
      'missing-script',
      redact(`The script ${scriptURL} could not be read: ${e?.message ?? e}`),
    );
  }
  if (!code.trim() || code.length > MAX_AUTOMATION_SCRIPT_CHARS) {
    return await fail(
      'script-error',
      `The script ${scriptURL} must be between 1 and ${MAX_AUTOMATION_SCRIPT_CHARS} characters`,
    );
  }
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
      dryRun: input.dryRun,
    },
    secondsCap: remainingMs / 1000,
    endsAt: new Date(deadline).toISOString(),
  };

  let outcome: AutomationScriptOutcome;
  try {
    let result = await ctx.prerenderer.runCommand({
      userId: run.actsAs,
      runRealm: realmURL,
      auth: JSON.stringify({ [realmURL]: token }),
      command: AUTOMATION_COMMAND,
      commandInput: { json: scriptInput },
      priority: jobInfo.priority,
      timeoutMs: remainingMs + AUTOMATION_TAB_GRACE_MS,
    });
    outcome = outcomeOf(result, redact);
  } catch (e: any) {
    outcome = {
      state: 'error',
      reason: 'run-failed',
      message: redact(`The run's tab failed: ${e?.message ?? e}`),
    };
  }
  if (outcome.state === 'error') {
    // The finish discards the overlay, so nothing the script staged lands.
    let message =
      outcome.line !== undefined
        ? `line ${outcome.line}: ${outcome.message}`
        : outcome.message;
    return await fail(outcome.reason, message);
  }
  if (input.dryRun) {
    // A Preview stops before the commit; its finish discards the overlay.
    return await finish(ctx, tag, runId, attempt, { state: 'complete' });
  }
  return await commit(ctx, tag, run, attempt, realmURL, token);
}

async function commit(
  ctx: AutomationAttemptContext,
  tag: string,
  run: AutomationRun,
  attempt: number,
  realmURL: string,
  token: string,
): Promise<AutomationAttemptResult> {
  let commitURL = new URL(RUN_COMMIT_PATH.replace(/^\//, ''), realmURL).href;
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
      return await finishAfterCommit(ctx, tag, run.id, attempt, {
        state: 'error',
        reason: 'commit-failed',
        message: `The commit could not be sent: ${e?.message ?? e}`,
      });
    }
    if (response.ok) {
      return await finish(ctx, tag, run.id, attempt, { state: 'complete' });
    }
    let { code, detail } = await refusalOf(response);
    if (code === 'overlay-changed' && tries < MAX_COMMIT_ATTEMPTS) {
      continue;
    }
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

// When the automation's last complete run started, other than this one.
async function lastSuccessAt(
  dbAdapter: DBAdapter,
  run: AutomationRun,
): Promise<{ lastSuccessAt?: string }> {
  let [row] = await query(dbAdapter, [
    'SELECT started_at FROM automation_runs WHERE automation_id =',
    param(run.automationId),
    "AND state = 'complete' AND started_at IS NOT NULL AND id <>",
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
