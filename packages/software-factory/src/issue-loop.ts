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

import type { LoopAgent } from './factory-agent-types';
import type { FactoryTool, ToolCallEntry } from './factory-tool-builder';
import type { IssueStore } from './issue-scheduler';

import { IssueScheduler } from './issue-scheduler';
import { logger } from './logger';

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
  validate(targetRealmUrl: string): Promise<ValidationResults>;
  /** Format validation results for LLM context or issue descriptions. */
  formatForContext?(results: ValidationResults): string;
}

/**
 * No-op validator that always passes. Used for bootstrap issues
 * or when validation is not needed.
 */
export class NoOpValidator implements Validator {
  async validate(): Promise<ValidationResults> {
    return { passed: true, steps: [] };
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
  /**
   * Factory that creates a fresh Validator for each issue.
   * Receives the issue ID so the validator can scope artifacts (e.g. TestRun
   * slugs) to the specific issue being validated.
   */
  createValidator: (issueId: string) => Validator;
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

/**
 * Build a description for an issue blocked due to max iterations with
 * failing validation, including the formatted failure context.
 */
function buildMaxIterationBlockedDescription(
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

  if (validator.formatForContext) {
    lines.push(validator.formatForContext(validationResults));
  } else {
    // Fallback: format from the raw results
    for (let step of validationResults.steps) {
      if (!step.passed) {
        lines.push(`**${step.step}**: FAILED`);
        for (let error of step.errors) {
          lines.push(`- ${error.message}`);
        }
        lines.push('');
      }
    }
  }

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

    // Mark the issue as in_progress when the loop picks it up
    if (issue.status !== 'in_progress') {
      try {
        await issueStore.updateIssue(issue.id, { status: 'in_progress' });
        issue = await scheduler.refreshIssueState(issue);
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

      // The loop owns issue status transitions. The agent signals
      // completion via signal_done; the loop promotes to "done" only
      // when signal_done is called AND validation passes.
      let agentSignaledDone = result.toolCalls.some(
        (tc) => tc.tool === 'signal_done',
      );

      if (agentSignaledDone && validationResults?.passed) {
        try {
          await issueStore.updateIssue(issue.id, { status: 'done' });
          log.info(
            `  Issue marked done (agent called signal_done, validation passed)`,
          );
        } catch (err) {
          log.warn(
            `  Failed to mark issue as done: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else if (agentSignaledDone && !validationResults?.passed) {
        log.info(
          `  Agent signaled done but validation failed — continuing iteration`,
        );
      }

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
        `  Max iterations (${maxIterationsPerIssue}) reached for issue ${issueSummaryLabel(issue)}`,
      );

      // If validation still failing at max iterations, block the issue with
      // the reason and failure context so it's visible in the realm.
      if (validationResults && !validationResults.passed) {
        log.info(
          `  Validation still failing — blocking issue with failure context`,
        );

        try {
          let description = buildMaxIterationBlockedDescription(
            maxIterationsPerIssue,
            validationResults,
            validator,
          );
          await issueStore.updateIssue(issue.id, {
            status: 'blocked',
            description,
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

  // Mark the project as completed when all issues are done
  if (outcome === 'all_issues_done' && issueStore.updateProjectStatus) {
    try {
      await issueStore.updateProjectStatus('completed');
    } catch (err) {
      log.warn(
        `Failed to update project status to completed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { outcome, outerCycles, issueResults };
}
