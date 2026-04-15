/**
 * Modular validation pipeline for the issue-driven loop.
 *
 * Each validation step is a separate module implementing `ValidationStepRunner`.
 * The pipeline runs all steps concurrently via `Promise.allSettled()` and
 * aggregates results. Adding a new step = creating a new module + one line
 * in `createDefaultPipeline()`.
 */

import type {
  ValidationStep,
  ValidationStepResult,
  ValidationResults,
} from '../factory-agent';

import type { Validator } from '../issue-loop';

import { NoOpStepRunner } from './noop-step';
import { TestValidationStep } from './test-step';
import { LintValidationStep } from './lint-step';
import { EvalValidationStep } from './eval-step';

import type { TestValidationStepConfig } from './test-step';
import type { LintValidationStepConfig } from './lint-step';
import type { EvalValidationStepConfig } from './eval-step';

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
  run(targetRealmUrl: string): Promise<ValidationStepResult>;
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

  async validate(targetRealmUrl: string): Promise<ValidationResults> {
    if (this.runners.length === 0) {
      return { passed: true, steps: [] };
    }

    let settled = await Promise.allSettled(
      this.runners.map((runner) => runner.run(targetRealmUrl)),
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
  /** Realm-scoped authorization token for realm API calls (readFile, writeFile, _lint, _search). */
  authorization?: string;
  /** Realm server token for _run-command calls (prerenderer). Distinct from realm-scoped authorization. */
  serverToken?: string;
  fetch?: typeof globalThis.fetch;
  realmServerUrl: string;
  hostAppUrl: string;
  testResultsModuleUrl: string;
  lintResultsModuleUrl: string;
  evalResultsModuleUrl: string;
  issueId?: string;
  /** Injected for testing — passed through to TestValidationStep, LintValidationStep, and EvalValidationStep. */
  fetchFilenames?: TestValidationStepConfig['fetchFilenames'];
}

/**
 * Create the default validation pipeline with all 5 steps.
 * Currently only the test step is implemented; others are NoOp placeholders.
 */
export function createDefaultPipeline(
  config: ValidationPipelineConfig,
): ValidationPipeline {
  let testConfig: TestValidationStepConfig = {
    authorization: config.authorization,
    fetch: config.fetch,
    realmServerUrl: config.realmServerUrl,
    hostAppUrl: config.hostAppUrl,
    testResultsModuleUrl: config.testResultsModuleUrl,
    issueId: config.issueId,
    fetchFilenames: config.fetchFilenames,
  };

  let lintConfig: LintValidationStepConfig = {
    authorization: config.authorization,
    fetch: config.fetch,
    realmServerUrl: config.realmServerUrl,
    lintResultsModuleUrl: config.lintResultsModuleUrl,
    issueId: config.issueId,
    fetchFilenames: config.fetchFilenames,
  };

  let evalConfig: EvalValidationStepConfig = {
    authorization: config.authorization,
    serverToken: config.serverToken,
    fetch: config.fetch,
    realmServerUrl: config.realmServerUrl,
    evalResultsModuleUrl: config.evalResultsModuleUrl,
    issueId: config.issueId,
    fetchFilenames: config.fetchFilenames,
  };

  return new ValidationPipeline([
    new NoOpStepRunner('parse'),
    new LintValidationStep(lintConfig),
    new EvalValidationStep(evalConfig),
    new NoOpStepRunner('instantiate'),
    new TestValidationStep(testConfig),
  ]);
}
