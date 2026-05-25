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
} from './factory-agent';

import type { LoopAgent } from './factory-agent';
import type { FactoryTool, ToolCallEntry } from './factory-tool-builder';
import type { IssueStore } from './issue-scheduler';

import { IssueScheduler } from './issue-scheduler';
import { logger } from './logger';
import { retryWithPoll } from './retry-with-poll';

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
} from './validators/validation-pipeline';

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
  /** Maximum inner-loop iterations per issue. Default: 8. */
  maxIterationsPerIssue?: number;
  /** Maximum outer-loop cycles (safety guard). Default: 50. */
  maxOuterCycles?: number;
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
    maxIterationsPerIssue = DEFAULT_MAX_ITERATIONS_PER_ISSUE,
    maxOuterCycles = DEFAULT_MAX_OUTER_CYCLES,
  } = config;

  let scheduler = new IssueScheduler(issueStore);
  await scheduler.loadIssues();

  let issueResults: IssueIterationResult[] = [];
  let outerCycles = 0;
  let exhaustedIssues = new Set<string>();

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
    let validator = createValidator(issue.id);

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

      // Build context — includes pre-formatted validation context from prior iteration
      let context = await contextBuilder.buildForIssue({
        issue,
        targetRealm,
        darkfactoryModuleUrl,
        validationResults,
        validationContext,
        briefUrl,
      });

      // Run the agent — it calls tools during its turn
      let result = await agent.run(context, tools);
      allToolCalls.push(...result.toolCalls);

      log.info(`  Agent returned ${result.toolCalls.length} tool call(s)`);

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
      validationResults = await validator.validate(targetRealm, iteration);

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
        `  Validation: ${formatValidation(validationResults)}${
          syncFailed ? ' (sync failed — ignoring validation pass/fail)' : ''
        }`,
      );

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
        } catch (err) {
          log.warn(
            `  Failed to update issue status to blocked: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      exhaustedIssues.add(issue.id);
    }

    log.info(
      `Outer cycle ${outerCycles}: issue ${issueSummaryLabel(issue)} completed — exitReason=${exitReason}, iterations=${innerIterations}`,
    );

    issueResults.push({
      issueId: issue.id,
      issueSummary: issue.summary ?? issue.id,
      exitReason,
      innerIterations,
      toolCallLog: allToolCalls,
      lastValidation: validationResults,
    });

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

  return { outcome, outerCycles, issueResults };
}
