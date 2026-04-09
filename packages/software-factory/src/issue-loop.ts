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

import type { FactoryTool, ToolCallEntry } from './factory-tool-builder';
import type { LoopAgent } from './factory-loop';
import type { IssueStore } from './issue-scheduler';

import { IssueScheduler } from './issue-scheduler';
import { logger } from './logger';

let log = logger('issue-loop');

// ---------------------------------------------------------------------------
// Validator interface (placeholder for CS-10675)
// ---------------------------------------------------------------------------

/**
 * Runs the post-iteration validation pipeline.
 * Steps: parse, lint, evaluate, instantiate, run tests.
 * CS-10675 provides the real implementation.
 */
export interface Validator {
  validate(targetRealmUrl: string): Promise<ValidationResults>;
}

/**
 * No-op validator that always passes. Used for bootstrap issues
 * or when CS-10675 validation is not yet available.
 */
export class NoOpValidator implements Validator {
  async validate(): Promise<ValidationResults> {
    return { passed: true, steps: [] };
  }
}

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
    targetRealmUrl: string;
    validationResults?: ValidationResults;
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
  validator: Validator;
  targetRealmUrl: string;
  briefUrl?: string;
  /** Maximum inner-loop iterations per issue. Default: 5. */
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

const DEFAULT_MAX_ITERATIONS_PER_ISSUE = 5;
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
    validator,
    targetRealmUrl,
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
    `Starting issue loop: targetRealm=${targetRealmUrl}, maxIterationsPerIssue=${maxIterationsPerIssue}`,
  );

  if (!scheduler.hasUnblockedIssues()) {
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

    // -----------------------------------------------------------------------
    // Inner loop: iterate on a single issue with validation
    // -----------------------------------------------------------------------

    let allToolCalls: ToolCallEntry[] = [];
    let validationResults: ValidationResults | undefined;
    let exitReason: IssueIterationResult['exitReason'] = 'max_iterations';
    let innerIterations = 0;

    for (let iteration = 1; iteration <= maxIterationsPerIssue; iteration++) {
      innerIterations = iteration;

      log.info(
        `  Inner iteration ${iteration}/${maxIterationsPerIssue} for issue ${issueSummaryLabel(issue)}`,
      );

      // Build context — includes validation results from prior iteration
      let context = await contextBuilder.buildForIssue({
        issue,
        targetRealmUrl,
        validationResults,
        briefUrl,
      });

      // Run the agent — it calls tools during its turn
      let result = await agent.run(context, tools);
      allToolCalls.push(...result.toolCalls);

      log.info(`  Agent returned ${result.toolCalls.length} tool call(s)`);

      // Validation — runs after every agent turn
      validationResults = await validator.validate(targetRealmUrl);
      log.info(`  Validation: ${formatValidation(validationResults)}`);

      // Refresh issue state from realm
      issue = await scheduler.refreshIssueState(issue);
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
        `  Max iterations (${maxIterationsPerIssue}) reached for issue ${issueSummaryLabel(issue)} — exiting inner loop`,
      );
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
    log.info(
      `Outer loop finished: outcome=max_outer_cycles, cycles=${outerCycles}`,
    );
  } else if (!scheduler.hasUnblockedIssues()) {
    // Check if all issues are done or if some are still blocked
    let hasNonDone = issueResults.some((r) => r.exitReason !== 'done');
    outcome = hasNonDone ? 'no_unblocked_issues' : 'all_issues_done';
    log.info(`Outer loop finished: outcome=${outcome}, cycles=${outerCycles}`);
  } else {
    outcome = 'all_issues_done';
    log.info(
      `Outer loop finished: outcome=all_issues_done, cycles=${outerCycles}`,
    );
  }

  return { outcome, outerCycles, issueResults };
}
