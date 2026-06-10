/**
 * Modular validation pipeline for the issue-driven loop.
 *
 * Each validation step is a separate module implementing `ValidationStepRunner`.
 * The pipeline runs all steps concurrently via `Promise.allSettled()` and
 * aggregates results. Adding a new step = creating a new module + one line
 * in `createDefaultPipeline()`.
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import type {
  ValidationStep,
  ValidationStepResult,
  ValidationResults,
} from '../factory-agent';

import type { Validator } from '../issue-loop';

import { TestValidationStep } from './test-step';
import { LintValidationStep } from './lint-step';
import { EvalValidationStep } from './eval-step';
import { InstantiateValidationStep } from './instantiate-step';
import { ParseValidationStep } from './parse-step';

import type { TestValidationStepConfig } from './test-step';
import type { LintValidationStepConfig } from './lint-step';
import type { EvalValidationStepConfig } from './eval-step';
import type { InstantiateValidationStepConfig } from './instantiate-step';
import type { ParseValidationStepConfig } from './parse-step';

import { logger } from '../logger';

let log = logger('validation-pipeline');

// ---------------------------------------------------------------------------
// ValidationStepRunner interface
// ---------------------------------------------------------------------------

/**
 * Contract that every validation step module must implement.
 *
 * Each step:
 * - Returns a result even when there's nothing to validate (passed: true)
 * - Provides step-specific `details` on the result for context formatting
 * - Implements `formatForContext()` to produce LLM-friendly output
 */
export interface ValidationStepRunner {
  readonly step: ValidationStep;
  run(targetRealm: string, iteration?: number): Promise<ValidationStepResult>;
  /** Format step results for LLM context. Returns human-readable string, empty if nothing to report. */
  formatForContext(result: ValidationStepResult): string;
}

// ---------------------------------------------------------------------------
// ValidationPipeline
// ---------------------------------------------------------------------------

/**
 * Implements the `Validator` interface from issue-loop.ts.
 * Runs all step runners concurrently via `Promise.allSettled()`.
 * A failure or exception in one step does not prevent others from completing.
 */
export class ValidationPipeline implements Validator {
  private runners: ValidationStepRunner[];

  constructor(runners: ValidationStepRunner[]) {
    this.runners = runners;
  }

  async validate(
    targetRealm: string,
    iteration?: number,
  ): Promise<ValidationResults> {
    if (this.runners.length === 0) {
      return { passed: true, steps: [] };
    }

    let settled = await Promise.allSettled(
      this.runners.map((runner) => runner.run(targetRealm, iteration)),
    );

    let stepResults: ValidationStepResult[] = [];
    let allPassed = true;

    for (let i = 0; i < settled.length; i++) {
      let outcome = settled[i];
      if (outcome.status === 'fulfilled') {
        stepResults.push(outcome.value);
        if (!outcome.value.passed) {
          allPassed = false;
        }
      } else {
        // Step threw an exception — capture as a failed result
        let reason = outcome.reason;
        let message = reason instanceof Error ? reason.message : String(reason);
        log.error(
          `Validation step "${this.runners[i].step}" threw: ${message}`,
        );
        stepResults.push({
          step: this.runners[i].step,
          passed: false,
          errors: [{ message }],
        });
        allPassed = false;
      }
    }

    return { passed: allPassed, steps: stepResults };
  }

  /**
   * Format all validation results for LLM context.
   * Delegates to each step runner's `formatForContext()`.
   * Returns a combined markdown string suitable for inclusion in the agent prompt.
   */
  formatForContext(results: ValidationResults): string {
    if (results.passed && results.steps.every((s) => s.passed)) {
      return 'All validation steps passed.';
    }

    let sections: string[] = [];

    // Summary line
    let failedSteps = results.steps.filter((s) => !s.passed);
    let passedSteps = results.steps.filter((s) => s.passed);
    sections.push(
      `Validation: ${failedSteps.length} step(s) failed, ${passedSteps.length} passed.`,
    );

    // Per-step details from runners
    for (let i = 0; i < this.runners.length; i++) {
      let runner = this.runners[i];
      let stepResult = results.steps.find((s) => s.step === runner.step);
      if (!stepResult) {
        continue;
      }

      let formatted = runner.formatForContext(stepResult);
      if (formatted) {
        sections.push(formatted);
      }
    }

    return sections.join('\n\n');
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export interface ValidationPipelineConfig {
  client: BoxelCLIClient;
  realmServerUrl: string;
  hostAppUrl: string;
  testResultsModuleUrl: string;
  lintResultsModuleUrl: string;
  evalResultsModuleUrl: string;
  instantiateResultsModuleUrl: string;
  parseResultsModuleUrl: string;
  /**
   * Local workspace directory mirroring the target realm. Validator steps
   * read source cards and write artifact cards (ParseResult, LintResult,
   * EvalResult, InstantiateResult, TestRun) against this directory.
   */
  workspaceDir: string;
  issueId?: string;
  /**
   * Shared with the agent's run_* tools — lets each step reuse an engine
   * run already executed against the same workspace state instead of
   * re-running it. Artifact cards are still written per step.
   */
  cache?: import('../validation-run-cache').ValidationRunCache;
  /** Injected for testing — passed through to TestValidationStep, LintValidationStep, EvalValidationStep, and ParseValidationStep. */
  fetchFilenames?: TestValidationStepConfig['fetchFilenames'];
  /** Injected for testing — passed through to InstantiateValidationStep and ParseValidationStep. */
  searchSpecsFn?: InstantiateValidationStepConfig['searchSpecsFn'];
  /** Injected for testing — passed through to ParseValidationStep. */
  parseSearchSpecsFn?: ParseValidationStepConfig['searchSpecsFn'];
}

/**
 * Create the default validation pipeline with all 5 steps.
 */
export function createDefaultPipeline(
  config: ValidationPipelineConfig,
): ValidationPipeline {
  let parseConfig: ParseValidationStepConfig = {
    client: config.client,
    cache: config.cache,
    realmServerUrl: config.realmServerUrl,
    parseResultsModuleUrl: config.parseResultsModuleUrl,
    workspaceDir: config.workspaceDir,
    issueId: config.issueId,
    fetchFilenames: config.fetchFilenames,
    searchSpecsFn: config.parseSearchSpecsFn,
  };

  let testConfig: TestValidationStepConfig = {
    client: config.client,
    cache: config.cache,
    realmServerUrl: config.realmServerUrl,
    hostAppUrl: config.hostAppUrl,
    testResultsModuleUrl: config.testResultsModuleUrl,
    workspaceDir: config.workspaceDir,
    issueId: config.issueId,
    fetchFilenames: config.fetchFilenames,
  };

  let lintConfig: LintValidationStepConfig = {
    client: config.client,
    cache: config.cache,
    realmServerUrl: config.realmServerUrl,
    lintResultsModuleUrl: config.lintResultsModuleUrl,
    workspaceDir: config.workspaceDir,
    issueId: config.issueId,
    fetchFilenames: config.fetchFilenames,
  };

  let evalConfig: EvalValidationStepConfig = {
    client: config.client,
    cache: config.cache,
    realmServerUrl: config.realmServerUrl,
    evalResultsModuleUrl: config.evalResultsModuleUrl,
    workspaceDir: config.workspaceDir,
    issueId: config.issueId,
    fetchFilenames: config.fetchFilenames,
  };

  let instantiateConfig: InstantiateValidationStepConfig = {
    client: config.client,
    cache: config.cache,
    realmServerUrl: config.realmServerUrl,
    instantiateResultsModuleUrl: config.instantiateResultsModuleUrl,
    workspaceDir: config.workspaceDir,
    issueId: config.issueId,
    searchSpecsFn: config.searchSpecsFn,
    fetchFilenames: config.fetchFilenames,
  };

  return new ValidationPipeline([
    new ParseValidationStep(parseConfig),
    new LintValidationStep(lintConfig),
    new EvalValidationStep(evalConfig),
    new InstantiateValidationStep(instantiateConfig),
    new TestValidationStep(testConfig),
  ]);
}
