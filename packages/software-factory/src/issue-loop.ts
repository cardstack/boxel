/**
 * Issue-driven execution loop.
 *
 * Two-level loop structure:
 * - Outer loop: iterates over unblocked issues via IssueScheduler
 * - Inner loop: iterates on each issue with validation after every agent turn
 *
 * The inner loop does NOT inspect AgentRunResult.status — it reads
 * issue state from the realm via refreshIssueState(). The agent writes
 * status changes via tool calls; the orchestrator only reads.
 *
 * Phase 1's runFactoryLoop() remains unchanged and coexists with this.
 */

import type {
  AgentContext,
  IssueData,
  SchedulableIssue,
  ValidationResults,
  ValidationStepResult,
} from './factory-agent/index.ts';

import type { LoopAgent } from './factory-agent/index.ts';
import type { FactoryTool, ToolCallEntry } from './factory-tool-builder.ts';
import type { IssueStore } from './issue-scheduler.ts';

import { IssueScheduler } from './issue-scheduler.ts';
import { logger } from './logger.ts';
import {
  type RunLogWriter,
  designEntriesFromToolCalls,
  cardPathsFromToolCalls,
} from './run-log.ts';
import { retryWithPoll } from './retry-with-poll.ts';

let log = logger('issue-loop');

// ---------------------------------------------------------------------------
// Validator interface
// ---------------------------------------------------------------------------

/**
 * Runs the post-iteration validation pipeline.
 * Steps: parse, lint, evaluate, instantiate, run tests.
 * See ValidationPipeline for the real implementation.
 */
export interface Validator {
  validate(targetRealm: string, iteration: number): Promise<ValidationResults>;
  /** Format validation results for LLM context and issue descriptions. */
  formatForContext(results: ValidationResults): string;
}

/**
 * No-op validator that always passes. Used for bootstrap issues
 * or when validation is not needed.
 */
export class NoOpValidator implements Validator {
  async validate(): Promise<ValidationResults> {
    return { passed: true, steps: [] };
  }

  formatForContext(_results: ValidationResults): string {
    return 'All validation steps passed.';
  }
}

// ---------------------------------------------------------------------------
// Re-exports from validators/
// ---------------------------------------------------------------------------

export {
  ValidationPipeline,
  createDefaultPipeline,
  type ValidationStepRunner,
  type ValidationPipelineConfig,
} from './validators/validation-pipeline.ts';

// ---------------------------------------------------------------------------
// Context builder interface for issue-driven loop
// ---------------------------------------------------------------------------

/**
 * Matches ContextBuilder.buildForIssue() signature.
 * Defined here to avoid coupling to the concrete class.
 */
export interface IssueContextBuilderLike {
  buildForIssue(params: {
    issue: IssueData;
    targetRealm: string;
    darkfactoryModuleUrl?: string;
    validationResults?: ValidationResults;
    /** Pre-formatted validation context from Validator.formatForContext(). */
    validationContext?: string;
    briefUrl?: string;
  }): Promise<AgentContext>;
}

// ---------------------------------------------------------------------------
// Config and result types
// ---------------------------------------------------------------------------

export interface IssueLoopConfig {
  agent: LoopAgent;
  contextBuilder: IssueContextBuilderLike;
  tools: FactoryTool[];
  issueStore: IssueStore;
  /**
   * Factory that creates a fresh Validator for each issue.
   * Receives the issue ID so the validator can scope artifacts (e.g. TestRun
   * slugs) to the specific issue being validated.
   */
  createValidator: (issueId: string) => Validator;
  targetRealm: string;
  /**
   * Module URL for the tracker schema (Project / Issue / KnowledgeArticle).
   * Surfaced in the system prompt so the agent can hand-write the correct
   * `meta.adoptsFrom.module` when constructing tracker JSON via native `Write`.
   */
  darkfactoryModuleUrl?: string;
  /**
   * Local workspace directory mirroring the target realm. Passed to the
   * loop so it can interleave sync calls with agent turns and validation.
   */
  workspaceDir: string;
  /**
   * Push the workspace to the realm (prefer-local). Invoked after each
   * agent turn — before validation runs — and again after validation
   * writes its artifact cards. Factored out of the loop so tests can
   * stub it without spinning up a real CLI client.
   *
   * Returns `{ ok: true }` on success, or `{ ok: false, error }` when
   * the sync reported errors. The loop uses this to refuse to mark an
   * issue done if the agent's writes didn't actually reach the realm
   * (e.g. atomic batch rejected by the realm server).
   */
  syncWorkspace: () => Promise<{ ok: boolean; error?: string }>;
  briefUrl?: string;
  /** Live-blog writer (v2): appends run events to Runs/<slug>.json in the target realm. */
  runLog?: RunLogWriter;
  /**
   * Context forking (v2): before the first implementation issue, run one
   * priming turn (read skills/design-language/precedent, write
   * design/DESIGN-NOTES.md) and fork every implementation issue's session
   * from it — shared provider-cached prefix instead of per-issue context
   * rebuilds.
   */
  forkContext?: boolean;
  /** Maximum inner-loop iterations per issue. Default: 8. */
  maxIterationsPerIssue?: number;
  /** Maximum outer-loop cycles (safety guard). Default: 50. */
  maxOuterCycles?: number;
  /**
   * Emit the timing instrumentation — per-phase durations on the agent /
   * validation lines, the per-issue `Timing:` line, and the end-of-run
   * summary table. Off by default so normal runs stay clean; the CLI sets it
   * from `--debug`. (The accompanying per-line timestamps are gated
   * separately in logger.ts via the same flag.)
   */
  debug?: boolean;
  /**
   * Cumulative milliseconds spent in `syncWorkspace()` across the whole run,
   * read on demand. Must time EVERY sync — both the loop's own syncs and the
   * realm-touching `run_*` tool syncs that fire inside `agent.run` — so the
   * loop can attribute tool-triggered sync time to sync rather than agent time
   * in the debug timing summary. Defaults to a no-op (0) when not wired.
   */
  getSyncElapsedMs?: () => number;
  /**
   * Invoked once, right after the `bootstrap` issue's cycle completes — the
   * earliest point at which the IssueTracker board exists on the realm. The
   * entrypoint wires this to link the realm index's `board` relationship
   * here, so the link no longer waits for the whole backlog to drain: a run
   * that is interrupted, crashes, or whose implementation issues stall would
   * otherwise leave the board unlinked even though it has existed since the
   * first outer cycle. Best-effort — a thrown error is logged, not
   * propagated, so a link failure never aborts the loop.
   */
  onBootstrapComplete?: () => Promise<void>;
}

export type IssueLoopOutcome =
  | 'all_issues_done'
  | 'no_unblocked_issues'
  | 'max_outer_cycles';

export interface IssueIterationResult {
  issueId: string;
  issueSummary: string;
  exitReason: 'done' | 'blocked' | 'max_iterations';
  innerIterations: number;
  toolCallLog: ToolCallEntry[];
  lastValidation?: ValidationResults;
  /** Wall-clock attribution for this issue. See {@link IssueTiming}. */
  timing?: IssueTiming;
}

/**
 * Per-issue wall-clock attribution. The factory's runtime is dominated by
 * three buckets — LLM agent turns, the validation pipeline (esp. browser
 * test runs), and workspace↔realm syncs — and a run otherwise gives no way
 * to tell which one cost the hour. `totalMs` is the issue's wall clock; the
 * gap between it and (agent+validation+sync) is scheduler/index-poll overhead.
 */
export interface IssueTiming {
  agentMs: number;
  validationMs: number;
  syncMs: number;
  totalMs: number;
}

function fmtSecs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export interface IssueLoopResult {
  outcome: IssueLoopOutcome;
  outerCycles: number;
  issueResults: IssueIterationResult[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ITERATIONS_PER_ISSUE = 8;
const DEFAULT_MAX_OUTER_CYCLES = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function issueSummaryLabel(issue: SchedulableIssue): string {
  let summary = issue.summary ?? (issue as Record<string, unknown>).title;
  return summary ? `"${issue.id}" — "${summary}"` : `"${issue.id}"`;
}

/** Realm-relative card path for an issue (for run-log show-me links). */
function issueCardPath(
  issue: SchedulableIssue,
  targetRealm: string,
): string | undefined {
  if (typeof issue.id === 'string' && issue.id.startsWith(targetRealm)) {
    return issue.id.slice(targetRealm.length).replace(/\.json$/, '');
  }
  return undefined;
}

/** Human-facing issue title for the run log (no quoting/id noise). */
function issueDisplayTitle(issue: SchedulableIssue): string {
  let summary = issue.summary ?? (issue as Record<string, unknown>).title;
  return typeof summary === 'string' && summary.trim() !== ''
    ? summary
    : issue.id;
}

function formatValidation(results: ValidationResults): string {
  if (results.passed) {
    let stepCount = results.steps.length;
    return `passed (${stepCount} step${stepCount !== 1 ? 's' : ''})`;
  }

  let failures = results.steps
    .filter((s: ValidationStepResult) => !s.passed)
    .map(
      (s: ValidationStepResult) =>
        `${s.step} (${s.errors.length} error${s.errors.length !== 1 ? 's' : ''})`,
    );
  return `FAILED — ${failures.join(', ')}`;
}

/**
 * Build the comment body for an issue blocked due to max iterations with
 * failing validation, including the formatted failure context.
 */
function buildMaxIterationBlockedComment(
  maxIterations: number,
  validationResults: ValidationResults,
  validator: Validator,
): string {
  let lines = [
    `**Blocked: max iteration limit reached (${maxIterations} turns) with failing validation.**`,
    '',
    `The agent was unable to resolve validation failures within the allowed number of iterations.`,
    '',
    `### Last Validation Results`,
    '',
  ];

  lines.push(validator.formatForContext(validationResults));

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

export async function runIssueLoop(
  config: IssueLoopConfig,
): Promise<IssueLoopResult> {
  let {
    agent,
    contextBuilder,
    tools,
    issueStore,
    createValidator,
    targetRealm,
    darkfactoryModuleUrl,
    syncWorkspace,
    briefUrl,
    runLog,
    forkContext = false,
    maxIterationsPerIssue = DEFAULT_MAX_ITERATIONS_PER_ISSUE,
    maxOuterCycles = DEFAULT_MAX_OUTER_CYCLES,
    debug = false,
    getSyncElapsedMs = () => 0,
    onBootstrapComplete,
  } = config;

  let scheduler = new IssueScheduler(issueStore);
  await scheduler.loadIssues();

  let issueResults: IssueIterationResult[] = [];
  let outerCycles = 0;
  let exhaustedIssues = new Set<string>();

  // Wall-clock attribution. `grand`/`cur` accumulate the three cost buckets
  // across the whole run and within the current outer cycle respectively;
  // `cur` is reset when each issue is picked up. Sync time is read from the
  // shared `getSyncElapsedMs` counter (a delta around each window), which times
  // EVERY `syncWorkspace()` call — both the loop's own syncs and the realm-
  // touching `run_*` tool syncs that fire inside `agent.run`. Tracking sync
  // centrally lets us subtract tool-sync time from `agentMs`, so the timing
  // summary doesn't blame the model for sync/index work a tool triggered.
  let loopStartMs = Date.now();
  let loopSyncStartMs = getSyncElapsedMs();
  let grand: IssueTiming = {
    agentMs: 0,
    validationMs: 0,
    syncMs: 0,
    totalMs: 0,
  };
  let cur = { agentMs: 0, validationMs: 0, syncMs: 0 };

  log.info(
    `Starting issue loop: targetRealm=${targetRealm}, maxIterationsPerIssue=${maxIterationsPerIssue}`,
  );

  if (!scheduler.hasUnblockedIssues()) {
    // Distinguish "no issues at all" from "issues exist but all blocked"
    let hasAnyIssues = scheduler.hasAnyIssues();
    if (hasAnyIssues) {
      log.info('All issues are blocked — nothing to do');
      return {
        outcome: 'no_unblocked_issues',
        outerCycles: 0,
        issueResults: [],
      };
    }
    log.info('No issues found — nothing to do');
    return { outcome: 'all_issues_done', outerCycles: 0, issueResults: [] };
  }

  // -------------------------------------------------------------------------
  // Outer loop: iterate over unblocked issues
  // -------------------------------------------------------------------------

  if (runLog) {
    await runLog.start();
  }

  // fork-context mode: undefined = not yet primed; null = priming failed
  // (run without forking); string = fork seed session id.
  let primeSessionId: string | null | undefined;

  while (
    scheduler.hasUnblockedIssues(exhaustedIssues) &&
    outerCycles < maxOuterCycles
  ) {
    outerCycles++;

    log.info(`Outer cycle ${outerCycles}: picking next issue...`);
    let issue = scheduler.pickNextIssue(exhaustedIssues);

    if (!issue) {
      log.info('No unblocked issues remain — exiting outer loop');
      break;
    }

    if (runLog) {
      let issueTitle = issueDisplayTitle(issue);
      await runLog.append(
        [
          {
            kind: 'issue-picked',
            headline: `Started: ${issueTitle}`,
            body:
              issue.status !== 'in_progress'
                ? 'Issue status: backlog → in progress'
                : undefined,
            cardPath: issueCardPath(issue, targetRealm),
          },
        ],
        { nowWorkingOn: issueTitle },
      );
    }

    // Context forking (v2): one priming turn before the first
    // implementation issue. The prime reads skills + design language +
    // precedent and writes design/DESIGN-NOTES.md; its session id seeds a
    // fork for every implementation turn that follows.
    if (
      forkContext &&
      primeSessionId === undefined &&
      issue.issueType !== 'bootstrap'
    ) {
      try {
        log.info('Priming shared context session (fork-context mode)...');
        let primeContext = await contextBuilder.buildForIssue({
          issue,
          targetRealm,
          darkfactoryModuleUrl,
        });
        primeContext.primeTurn = true;
        let primeResult = await agent.run(primeContext, tools);
        if (primeResult.sessionId) {
          primeSessionId = primeResult.sessionId;
          log.info(
            `Prime session captured: ${primeSessionId} (${primeResult.toolCalls.length} tool calls)`,
          );
          if (runLog) {
            await runLog.append([
              {
                kind: 'phase',
                headline: 'Shared design context primed',
                body: 'Skills, design language, and precedent loaded once — every card build forks from here.',
              },
            ]);
          }
        } else {
          log.warn('Prime turn returned no session id — forking disabled');
          primeSessionId = null;
        }
      } catch (error) {
        log.warn(`Prime turn failed (${String(error)}) — forking disabled`);
        primeSessionId = null;
      }
    }

    // Reset per-issue timing accumulators; `cycleStartMs` anchors this
    // issue's total wall clock and `cycleSyncStartMs` its sync baseline.
    cur = { agentMs: 0, validationMs: 0, syncMs: 0 };
    let cycleStartMs = Date.now();
    let cycleSyncStartMs = getSyncElapsedMs();

    log.info(
      `Outer cycle ${outerCycles}: picked issue ${issueSummaryLabel(issue)} (status=${issue.status}, priority=${issue.priority})`,
    );

    // Mark the issue as in_progress when the loop picks it up. The update
    // writes to the local workspace, so sync it to the realm immediately
    // — otherwise a failing agent turn (e.g. missing API key) would leave
    // the realm showing `backlog` while the workspace has `in_progress`,
    // and observers querying the realm would see stale state.
    if (issue.status !== 'in_progress') {
      try {
        await issueStore.updateIssue(issue.id, { status: 'in_progress' });
        let pickupSync = await syncWorkspace();
        if (!pickupSync.ok) {
          // The status flip is local until sync lands. If the sync
          // failed, the realm is still showing `backlog` and a
          // refresh would mask the divergence — log and skip the
          // refresh so the next iteration's sync surfaces the same
          // error in agent context (where it can be reacted to)
          // rather than burying it under a stale state.
          log.warn(
            `  in_progress flip didn't sync to realm — realm still shows ${issue.status}; sync error: ${pickupSync.error ?? 'unknown'}`,
          );
        } else {
          // The realm's source POST returns once writes are durable,
          // but the search index that refreshIssueState consults
          // settles asynchronously. Bound-poll until the index reflects
          // the status flip we just synced; fall through to whatever
          // the index shows after the deadline.
          let pickupIssue: SchedulableIssue = issue;
          issue = await retryWithPoll(
            () => scheduler.refreshIssueState(pickupIssue),
            (r) => r.status !== 'in_progress',
          );
        }
      } catch (err) {
        log.warn(
          `  Failed to set issue to in_progress: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Create a fresh validator scoped to this issue so that artifacts
    // (e.g. TestRun cards) are named per-issue rather than shared.
    // Bootstrap issues create Project/Board/Knowledge-Article/Issue cards,
    // never a Catalog Spec — so `instantiate` structurally can never pass
    // for them (see CS-12185). Skip straight to NoOpValidator (already
    // built for exactly this per its own docstring) instead of burning
    // maxIterationsPerIssue on an unwinnable validation.
    let validator =
      issue.issueType === 'bootstrap'
        ? new NoOpValidator()
        : createValidator(issue.id);

    // -----------------------------------------------------------------------
    // Inner loop: iterate on a single issue with validation
    // -----------------------------------------------------------------------

    let allToolCalls: ToolCallEntry[] = [];
    let validationResults: ValidationResults | undefined;
    let validationContext: string | undefined;
    let exitReason: IssueIterationResult['exitReason'] = 'max_iterations';
    let innerIterations = 0;

    for (let iteration = 1; iteration <= maxIterationsPerIssue; iteration++) {
      innerIterations = iteration;

      log.info(
        `  Inner iteration ${iteration}/${maxIterationsPerIssue} for issue ${issueSummaryLabel(issue)}`,
      );

      if (runLog && iteration > 1) {
        await runLog.append([
          {
            kind: 'iteration',
            headline: `Iteration ${iteration} of ${maxIterationsPerIssue} — revising after validation feedback`,
          },
        ]);
      }

      // Build context — includes pre-formatted validation context from prior iteration
      let context = await contextBuilder.buildForIssue({
        issue,
        targetRealm,
        darkfactoryModuleUrl,
        validationResults,
        validationContext,
        briefUrl,
      });

      // fork-context mode: every implementation turn forks the primed
      // session — inheriting skills/design-language/precedent as a shared
      // provider-cached prefix.
      if (
        typeof primeSessionId === 'string' &&
        issue.issueType !== 'bootstrap'
      ) {
        context.resumeSession = { sessionId: primeSessionId, fork: true };
      }

      // Run the agent — it calls tools during its turn. Realm-touching `run_*`
      // tools sync the workspace before executing, so subtract that tool-sync
      // time from the agent's wall clock: it's attributed to sync (via the
      // shared counter), not to the model.
      let agentStartMs = Date.now();
      let agentSyncStartMs = getSyncElapsedMs();
      let result = await agent.run(context, tools);
      let toolSyncMs = getSyncElapsedMs() - agentSyncStartMs;
      let agentMs = Math.max(0, Date.now() - agentStartMs - toolSyncMs);
      cur.agentMs += agentMs;
      grand.agentMs += agentMs;
      allToolCalls.push(...result.toolCalls);

      log.info(
        `  Agent returned ${result.toolCalls.length} tool call(s)${debug ? ` in ${fmtSecs(agentMs)}` : ''}`,
      );

      if (runLog) {
        let designEntries = designEntriesFromToolCalls(
          result.toolCalls,
          targetRealm,
        );
        if (designEntries.length > 0) {
          await runLog.append(designEntries);
        }
      }

      // The agent itself reports "I cannot proceed" via two paths:
      // calling `request_clarification` (clarification.message), or
      // an unrecoverable backend error (e.g. session.error from
      // opencode on a 401). Both surface as `result.status === 'blocked'`.
      // Mark the issue blocked and exit the inner loop — validation and
      // further iterations would just spin without making progress.
      if (result.status === 'blocked') {
        let blockMessage =
          result.message?.trim() || 'agent reported it could not proceed';
        log.info(`  Agent reported blocked: ${blockMessage}`);
        if (runLog) {
          await runLog.append([
            {
              kind: 'blocked',
              headline: `Blocked: ${issueDisplayTitle(issue)}`,
              body: blockMessage,
              cardPath: issueCardPath(issue, targetRealm),
            },
          ]);
        }
        try {
          await issueStore.updateIssue(issue.id, { status: 'blocked' });
          await syncWorkspace();
        } catch (err) {
          log.warn(
            `  Failed to mark issue as blocked after agent block: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        exitReason = 'blocked';
        break;
      }

      // Push the agent's workspace writes to the realm so the prerenderer-
      // backed validators (eval / instantiate / test-step's QUnit run) see
      // the latest source when they execute against the realm.
      let preValidationSync = await syncWorkspace();

      // Validation — runs after every agent turn.
      // Pass the iteration number so all steps use it as the sequence
      // number in artifact filenames (parse_slug-1, lint_slug-1, etc.)
      let validationStartMs = Date.now();
      validationResults = await validator.validate(targetRealm, iteration);
      let validationMs = Date.now() - validationStartMs;
      cur.validationMs += validationMs;
      grand.validationMs += validationMs;

      // Push the validator's artifact cards (ParseResult / LintResult /
      // EvalResult / InstantiateResult / TestRun) to the realm so they
      // appear in the Boxel UI.
      let postValidationSync = await syncWorkspace();

      let syncFailed = !preValidationSync.ok || !postValidationSync.ok;
      let syncError = preValidationSync.error ?? postValidationSync.error;

      // If either sync failed, the agent's writes didn't land on the
      // realm. Validators will have seen an empty/stale realm so a
      // "passed" result is vacuous. Surface the sync error into the
      // next iteration's context so the agent can react (retry,
      // simplify, split the batch).
      let validationSummary =
        validationResults && !validationResults.passed
          ? validator.formatForContext(validationResults)
          : undefined;
      if (syncFailed) {
        let syncNotice = [
          'Workspace sync to the realm FAILED — your file writes are still only on local disk.',
          `Reason: ${syncError ?? '(unknown)'}`,
          'Common causes: the realm server rejected the atomic batch (500),',
          'a file has a syntax/index error, or an instance references a module',
          "that isn't included in the same batch. Inspect your writes and try",
          'again. Until the sync succeeds, the issue will not be marked done.',
        ].join('\n');
        validationContext = validationSummary
          ? `${syncNotice}\n\n${validationSummary}`
          : syncNotice;
      } else {
        validationContext = validationSummary;
      }
      log.info(
        `  Validation: ${formatValidation(validationResults)}${debug ? ` in ${fmtSecs(validationMs)}` : ''}${
          syncFailed ? ' (sync failed — ignoring validation pass/fail)' : ''
        }`,
      );

      if (runLog && validationResults) {
        await runLog.append([
          {
            kind: 'validation',
            headline: validationResults.passed
              ? 'Validation passed'
              : 'Validation failed — revising',
            body: formatValidation(validationResults),
          },
        ]);
      }

      // The loop owns issue status transitions. The agent signals
      // completion via signal_done; the loop promotes to "done" only
      // when signal_done is called, validation passes, AND the sync
      // succeeded. A failed sync means the realm doesn't have the
      // agent's writes, so marking the issue done would claim
      // completion for work that isn't actually delivered.
      let agentSignaledDone = result.toolCalls.some(
        (tc) => tc.tool === 'signal_done',
      );

      if (agentSignaledDone && validationResults?.passed && !syncFailed) {
        try {
          await issueStore.updateIssue(issue.id, { status: 'done' });
          if (runLog) {
            await runLog.append([
              {
                kind: 'status',
                headline: `Issue status: in progress → done`,
                cardPath: issueCardPath(issue, targetRealm),
              },
            ]);
          }
          // updateIssue writes the status flip to the local workspace.
          // refreshIssueState below queries the realm's search index, so
          // the flip has to reach the realm before the refresh — otherwise
          // the loop reads stale `in_progress` and runs another inner
          // iteration (or, with a low maxIterationsPerIssue, exits as
          // max_iterations instead of done).
          let doneSync = await syncWorkspace();
          if (!doneSync.ok) {
            log.warn(
              `  Marked issue done locally but sync failed (${doneSync.error ?? 'unknown'}); refresh may still see prior status`,
            );
          }
          log.info(
            `  Issue marked done (agent called signal_done, validation passed, sync succeeded)`,
          );
        } catch (err) {
          log.warn(
            `  Failed to mark issue as done: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else if (agentSignaledDone && syncFailed) {
        log.info(
          `  Agent signaled done but workspace sync failed — work isn't on the realm yet, continuing iteration`,
        );
      } else if (agentSignaledDone && !validationResults?.passed) {
        log.info(
          `  Agent signaled done but validation failed — continuing iteration`,
        );
      }

      // Refresh issue state from realm. When the agent signal_done'd and
      // we just synced status='done' to the realm, bound-poll until the
      // search index reflects that — otherwise we'd read stale
      // `in_progress` here, run a wasted inner iteration, and only
      // settle on the next pass. Other paths (sync failed, validation
      // failed) refresh once and trust whatever the index shows.
      let expectedDoneSync =
        agentSignaledDone && validationResults?.passed && !syncFailed;
      let currentIssue: SchedulableIssue = issue;
      issue = expectedDoneSync
        ? await retryWithPoll(
            () => scheduler.refreshIssueState(currentIssue),
            (r) => r.status !== 'done',
          )
        : await scheduler.refreshIssueState(currentIssue);
      log.info(`  Issue state after refresh: status=${issue.status}`);

      // Check exit conditions
      if (issue.status === 'done') {
        log.info(
          `  Exiting inner loop: issue ${issueSummaryLabel(issue)} status is done`,
        );
        exitReason = 'done';
        break;
      }

      if (issue.status === 'blocked') {
        log.info(
          `  Exiting inner loop: issue ${issueSummaryLabel(issue)} status is blocked`,
        );
        exitReason = 'blocked';
        break;
      }
    }

    if (exitReason === 'max_iterations') {
      log.info(
        `  Max iterations (${maxIterationsPerIssue}) reached for issue ${issueSummaryLabel(issue)}`,
      );

      // If validation still failing at max iterations, block the issue with
      // the reason and failure context so it's visible in the realm.
      if (validationResults && !validationResults.passed) {
        log.info(
          `  Validation still failing — blocking issue with failure context`,
        );

        // Comment is best-effort context; status transition is critical.
        try {
          let commentBody = buildMaxIterationBlockedComment(
            maxIterationsPerIssue,
            validationResults,
            validator,
          );
          await issueStore.addComment(issue.id, {
            body: commentBody,
            author: 'orchestrator',
          });
        } catch (err) {
          log.warn(
            `  Failed to add blocking comment to issue: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        try {
          await issueStore.updateIssue(issue.id, {
            status: 'blocked',
          });
          exitReason = 'blocked';
          if (runLog) {
            await runLog.append([
              {
                kind: 'blocked',
                headline: `Issue status: in progress → blocked (max iterations)`,
                body: `Validation still failing after ${maxIterationsPerIssue} iterations — orchestrator comment added to the issue with the failure context.`,
                cardPath: issueCardPath(issue, targetRealm),
              },
            ]);
          }
        } catch (err) {
          log.warn(
            `  Failed to update issue status to blocked: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      exhaustedIssues.add(issue.id);
    }

    // All syncs during this issue (loop-owned + tool-triggered) accrued to the
    // shared counter; the delta is this issue's sync time.
    cur.syncMs = getSyncElapsedMs() - cycleSyncStartMs;
    let issueTiming: IssueTiming = {
      agentMs: cur.agentMs,
      validationMs: cur.validationMs,
      syncMs: cur.syncMs,
      totalMs: Date.now() - cycleStartMs,
    };

    log.info(
      `Outer cycle ${outerCycles}: issue ${issueSummaryLabel(issue)} completed — exitReason=${exitReason}, iterations=${innerIterations}`,
    );

    if (runLog && exitReason === 'done') {
      let cardEntries = cardPathsFromToolCalls(allToolCalls).map(
        (cardPath) => ({
          kind: 'card-ready' as const,
          headline: `Card ready: ${cardPath}`,
          cardPath,
        }),
      );
      await runLog.append([
        ...cardEntries,
        {
          kind: 'issue-done',
          headline: `Done: ${issueDisplayTitle(issue)}`,
        },
      ]);
    }
    if (debug) {
      log.info(
        `  Timing: agent ${fmtSecs(issueTiming.agentMs)}, validation ${fmtSecs(issueTiming.validationMs)}, sync ${fmtSecs(issueTiming.syncMs)}, total ${fmtSecs(issueTiming.totalMs)}`,
      );
    }

    issueResults.push({
      issueId: issue.id,
      issueSummary: issue.summary ?? issue.id,
      exitReason,
      innerIterations,
      toolCallLog: allToolCalls,
      lastValidation: validationResults,
      timing: issueTiming,
    });

    // The bootstrap issue is what creates (and syncs) the IssueTracker
    // board. Fire the hook the moment its cycle finishes successfully so the
    // realm index can be linked to the board now — rather than after the whole
    // backlog drains, which a stalled or interrupted implementation issue may
    // never reach. Gated on `exitReason === 'done'`: a bootstrap that ended
    // blocked or out of iterations may never have created the board, so wiring
    // it would be premature. There is only ever one bootstrap issue, so this
    // fires at most once. The link is best-effort and must not abort the loop.
    if (
      onBootstrapComplete &&
      issue.issueType === 'bootstrap' &&
      exitReason === 'done'
    ) {
      try {
        await onBootstrapComplete();
      } catch (err) {
        log.warn(
          `onBootstrapComplete hook failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Reload issues to pick up new issues the agent may have created
    await scheduler.loadIssues();
  }

  // -------------------------------------------------------------------------
  // Determine outcome
  // -------------------------------------------------------------------------

  let outcome: IssueLoopOutcome;

  if (outerCycles >= maxOuterCycles) {
    outcome = 'max_outer_cycles';
  } else {
    let allDone = issueResults.every((r) => r.exitReason === 'done');
    let hasExhausted = exhaustedIssues.size > 0;

    if (allDone && !hasExhausted) {
      outcome = 'all_issues_done';
    } else {
      // Some issues are blocked, exhausted, or otherwise unresolved
      outcome = 'no_unblocked_issues';
    }
  }

  log.info(`Outer loop finished: outcome=${outcome}, cycles=${outerCycles}`);

  if (runLog) {
    await runLog.finish(outcome === 'all_issues_done' ? 'completed' : 'stopped');
  }

  // Mark the project as completed only when ALL issues in the realm are done
  // (not just the ones we processed). This prevents marking complete when
  // pre-existing blocked issues still exist.
  if (outcome === 'all_issues_done' && issueStore.updateProjectStatus) {
    let allIssues = await issueStore.listIssues();
    let allRealmIssuesDone =
      allIssues.length > 0 && allIssues.every((i) => i.status === 'done');
    if (allRealmIssuesDone) {
      try {
        await issueStore.updateProjectStatus('completed');
        // updateProjectStatus writes the new status to the workspace
        // mirror but doesn't push — without this sync the realm-side
        // Project card keeps its bootstrap "active" status forever
        // (catalog UI shows it as ACTIVE even after every issue is
        // marked done). Same syncWorkspace the orchestrator uses
        // elsewhere; failure logs but doesn't block.
        let projectSync = await syncWorkspace();
        if (!projectSync.ok) {
          log.warn(
            `Failed to sync project status update: ${projectSync.error ?? 'unknown error'}`,
          );
        }
      } catch (err) {
        log.warn(
          `Failed to update project status to completed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      log.info(`Not marking project completed — some issues are not done`);
    }
  }

  // Total sync across the whole run (per-issue syncs + loop-level syncs such
  // as the post-loop project-status sync), read from the shared counter.
  grand.syncMs = getSyncElapsedMs() - loopSyncStartMs;
  grand.totalMs = Date.now() - loopStartMs;
  if (debug) {
    logTimingSummary(issueResults, grand);
  }

  return { outcome, outerCycles, issueResults };
}

/**
 * Log a per-issue + grand-total wall-clock attribution table at the end of a
 * run. Answers "where did the hour go" by splitting time across agent turns,
 * the validation pipeline, and workspace syncs. The unattributed remainder
 * (total minus the three buckets) is scheduler + index-poll overhead.
 */
function logTimingSummary(
  issueResults: IssueIterationResult[],
  grand: IssueTiming,
): void {
  let timed = issueResults.filter(
    (r): r is IssueIterationResult & { timing: IssueTiming } =>
      r.timing != null,
  );
  if (timed.length === 0) {
    return;
  }

  log.info('Run timing summary (where the time went):');
  log.info(
    `  ${'issue'.padEnd(36)} ${'agent'.padStart(8)} ${'valid'.padStart(8)} ${'sync'.padStart(8)} ${'total'.padStart(8)}`,
  );
  for (let r of timed) {
    let label = (r.issueSummary || r.issueId).slice(0, 36).padEnd(36);
    log.info(
      `  ${label} ${fmtSecs(r.timing.agentMs).padStart(8)} ${fmtSecs(r.timing.validationMs).padStart(8)} ${fmtSecs(r.timing.syncMs).padStart(8)} ${fmtSecs(r.timing.totalMs).padStart(8)}`,
    );
  }
  let attributed = grand.agentMs + grand.validationMs + grand.syncMs;
  let overheadMs = Math.max(0, grand.totalMs - attributed);
  log.info(
    `  ${'TOTAL'.padEnd(36)} ${fmtSecs(grand.agentMs).padStart(8)} ${fmtSecs(grand.validationMs).padStart(8)} ${fmtSecs(grand.syncMs).padStart(8)} ${fmtSecs(grand.totalMs).padStart(8)}`,
  );
  log.info(
    `  Unattributed (scheduling + index polling): ${fmtSecs(overheadMs)} of ${fmtSecs(grand.totalMs)} wall clock`,
  );
}
