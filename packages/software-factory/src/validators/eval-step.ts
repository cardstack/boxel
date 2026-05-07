/**
 * Eval validation step — evaluates non-test ESM modules in the target
 * realm via the prerenderer sandbox to ensure they load without runtime
 * errors.
 *
 * Discovery and per-module evaluation are delegated to the shared
 * `eval-execution` engine; this step owns the `EvalResult` card artifact
 * lifecycle (create → complete) and sequence-number bookkeeping.
 *
 * Files matching `*.test.{gts,gjs,ts,js}` are excluded — test files are
 * the responsibility of the test validation step.
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import type { ValidationStepResult } from '../factory-agent';
import { deriveIssueSlug } from '../factory-agent';
import {
  discoverEvaluableFiles,
  evaluateRealmModules,
  type EvalModuleResult,
  type EvalModuleRecord,
} from '../eval-execution';
import { getNextValidationSequenceNumber } from '../realm-operations';
import {
  createEvalResult,
  completeEvalResult,
  type EvalModuleErrorData,
} from '../eval-result-cards';
import { logger } from '../logger';

import type { ValidationStepRunner } from './validation-pipeline';

let log = logger('eval-validation-step');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Re-exported for consumers that imported EvalModuleResult from this module.
export type { EvalModuleResult };

export interface EvalValidationStepConfig {
  client: BoxelCLIClient;
  realmServerUrl: string;
  evalResultsModuleUrl: string;
  /**
   * Local workspace directory mirroring the target realm. EvalResult
   * cards are written here for the orchestrator to sync. (Eval itself
   * reads modules via the prerenderer, which fetches them from the realm.)
   */
  workspaceDir: string;
  issueId?: string;
  /** Injected for testing — defaults to client.listFiles. */
  fetchFilenames?: (
    realmUrl: string,
  ) => Promise<{ filenames: string[]; error?: string }>;
  /** Injected for testing — defaults to client.runCommand calling the evaluate-module host command. */
  evaluateModuleFn?: (
    moduleUrl: string,
    realmUrl: string,
  ) => Promise<EvalModuleResult>;
  /** Injected for testing — defaults to getNextValidationSequenceNumber. */
  getNextSequenceNumber?: (
    slug: string,
    targetRealm: string,
  ) => Promise<number>;
}

/** Flattened POJO for eval validation details — not a card, just data. */
export interface EvalValidationDetails {
  evalResultId: string;
  modulesChecked: number;
  modulesWithErrors: number;
  modules: { path: string; error: string; stackTrace?: string }[];
}

// ---------------------------------------------------------------------------
// EvalValidationStep
// ---------------------------------------------------------------------------

export class EvalValidationStep implements ValidationStepRunner {
  readonly step = 'evaluate' as const;

  private config: EvalValidationStepConfig;
  private lastSequenceNumber = 0;

  private getNextSeqFn: (slug: string, targetRealm: string) => Promise<number>;

  constructor(config: EvalValidationStepConfig) {
    this.config = config;
    this.getNextSeqFn =
      config.getNextSequenceNumber ??
      ((slug: string, targetRealm: string) =>
        getNextValidationSequenceNumber(
          config.client,
          slug,
          'Validations/eval_',
          config.evalResultsModuleUrl,
          'EvalResult',
          targetRealm,
        ));
  }

  async run(
    targetRealm: string,
    iteration?: number,
  ): Promise<ValidationStepResult> {
    // Step 1: Discover evaluable files (shared engine)
    let evaluableFiles: string[];
    try {
      evaluableFiles = await discoverEvaluableFiles({
        targetRealm,
        client: this.config.client,
        fetchFilenames: this.config.fetchFilenames,
      });
    } catch (err) {
      return {
        step: 'evaluate',
        passed: false,
        errors: [
          {
            message: `Failed to discover evaluable files: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }

    if (evaluableFiles.length === 0) {
      log.info('No evaluable modules found — nothing to validate');
      return { step: 'evaluate', passed: true, files: [], errors: [] };
    }

    log.info(
      `Found ${evaluableFiles.length} evaluable file(s): ${evaluableFiles.join(', ')}`,
    );

    // Step 2: Create the EvalResult card (status: running)
    let slug = this.config.issueId
      ? deriveIssueSlug(this.config.issueId)
      : 'validation';

    let issueURL = this.config.issueId
      ? new URL(this.config.issueId, targetRealm).href
      : undefined;

    let seq: number;
    if (iteration != null) {
      seq = iteration;
    } else {
      try {
        let realmSeq = await this.getNextSeqFn(slug, targetRealm);
        seq = Math.max(realmSeq, this.lastSequenceNumber + 1);
      } catch (err) {
        log.warn(
          `Failed to resolve sequence number, using floor: ${err instanceof Error ? err.message : String(err)}`,
        );
        seq = this.lastSequenceNumber + 1;
      }
    }

    let evalResultId: string;
    let artifactCreated = false;
    try {
      let createResult = await createEvalResult(
        slug,
        this.config.evalResultsModuleUrl,
        {
          targetRealm,
          client: this.config.client,
          workspaceDir: this.config.workspaceDir,
          sequenceNumber: seq,
          issueURL,
        },
      );
      evalResultId = createResult.evalResultId;
      if (!createResult.created) {
        log.warn(
          `EvalResult card creation returned created: false: ${createResult.error ?? 'unknown'}`,
        );
      } else {
        artifactCreated = true;
        this.lastSequenceNumber = seq;
      }
    } catch (err) {
      log.warn(
        `Failed to create EvalResult card: ${err instanceof Error ? err.message : String(err)}`,
      );
      evalResultId = `Validations/eval_${slug}-${seq}`;
    }

    // Step 3: Evaluate each module via the shared engine
    let {
      moduleResults: allModuleResults,
      failedModules,
      durationMs,
    } = await evaluateRealmModules(
      {
        targetRealm,
        client: this.config.client,
        realmServerUrl: this.config.realmServerUrl,
        evaluateModuleFn: this.config.evaluateModuleFn,
      },
      evaluableFiles,
    );

    let passed = failedModules.length === 0;

    // Step 4: Complete the EvalResult card
    if (artifactCreated) {
      let moduleResultsForCard: EvalModuleErrorData[] = allModuleResults.map(
        (m) => ({ path: m.path, error: m.error, stackTrace: m.stackTrace }),
      );
      let completeResult = await completeEvalResult(
        evalResultId,
        {
          status: passed ? 'passed' : 'failed',
          durationMs,
          moduleResults: moduleResultsForCard,
        },
        {
          targetRealm,
          client: this.config.client,
          workspaceDir: this.config.workspaceDir,
        },
      );
      if (!completeResult.updated) {
        log.warn(
          `Failed to complete EvalResult card ${evalResultId}: ${completeResult.error ?? 'unknown'}`,
        );
      }
    }

    // Step 5: Build result
    let details: EvalValidationDetails = {
      evalResultId,
      modulesChecked: allModuleResults.length,
      modulesWithErrors: failedModules.length,
      modules: failedModules.map((m: EvalModuleRecord) => ({
        path: m.path,
        error: m.error,
        stackTrace: m.stackTrace,
      })),
    };

    let errors = failedModules.map((m: EvalModuleRecord) => ({
      file: m.path,
      message: `${m.path}: ${m.error}`,
    }));

    return {
      step: 'evaluate',
      passed,
      files: evaluableFiles,
      errors,
      details: details as unknown as Record<string, unknown>,
    };
  }

  formatForContext(result: ValidationStepResult): string {
    if (result.passed) {
      let details = result.details as unknown as
        | EvalValidationDetails
        | undefined;
      if (details && details.modulesChecked > 0) {
        return `## Eval Validation: PASSED\n${details.modulesChecked} module(s) checked, no evaluation errors. (EvalResult: ${details.evalResultId})`;
      }
      return '';
    }

    let details = result.details as unknown as
      | EvalValidationDetails
      | undefined;
    if (!details) {
      let errorLines = result.errors.map((e) => `- ${e.message}`).join('\n');
      return `## Eval Validation: FAILED\n${errorLines}`;
    }

    let lines: string[] = [
      `## Eval Validation: FAILED`,
      `${details.modulesChecked} module(s) checked, ${details.modulesWithErrors} module(s) with errors (EvalResult: ${details.evalResultId})`,
    ];

    for (let mod of details.modules) {
      lines.push(`  ${mod.path}: ${mod.error}`);
    }

    return lines.join('\n');
  }
}
