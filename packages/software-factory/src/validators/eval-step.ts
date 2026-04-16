/**
 * Eval validation step — evaluates .gts modules in the target realm
 * via the prerenderer sandbox to ensure they load without runtime errors.
 *
 * For each non-test `.gts` file discovered in the realm, invokes the
 * `evaluate-module` host command via `_run-command`. The host command
 * calls `/_prerender-module` which runs evaluation in headless Chrome.
 *
 * Files matching `*.test.gts` are excluded — test files are the
 * responsibility of the test validation step.
 */

import type { ValidationStepResult } from '../factory-agent';
import { deriveIssueSlug } from '../factory-agent-types';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import {
  fetchRealmFilenames,
  getNextValidationSequenceNumber,
  runRealmCommand,
  type RealmFetchOptions,
} from '../realm-operations';
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

export interface EvalModuleResult {
  passed: boolean;
  error?: string;
  stackTrace?: string;
}

export interface EvalValidationStepConfig {
  /** Realm-scoped authorization token for realm API calls (readFile, writeFile, _search). */
  authorization?: string;
  /** Realm server token for _run-command calls (prerenderer). Distinct from realm-scoped authorization. */
  serverToken?: string;
  fetch?: typeof globalThis.fetch;
  realmServerUrl: string;
  evalResultsModuleUrl: string;
  issueId?: string;
  /** Injected for testing — defaults to fetchRealmFilenames. */
  fetchFilenames?: (
    realmUrl: string,
    options?: RealmFetchOptions,
  ) => Promise<{ filenames: string[]; error?: string }>;
  /** Injected for testing — defaults to runRealmCommand calling the evaluate-module host command. */
  evaluateModuleFn?: (
    moduleUrl: string,
    realmUrl: string,
  ) => Promise<EvalModuleResult>;
  /** Injected for testing — defaults to getNextValidationSequenceNumber. */
  getNextSequenceNumber?: (
    slug: string,
    targetRealmUrl: string,
  ) => Promise<number>;
}

/** Flattened POJO for eval validation details — not a card, just data. */
export interface EvalValidationDetails {
  evalResultId: string;
  modulesChecked: number;
  modulesWithErrors: number;
  modules: { path: string; error: string; stackTrace?: string }[];
}

const EVALUATE_MODULE_COMMAND =
  '@cardstack/boxel-host/commands/evaluate-module/default';

// ---------------------------------------------------------------------------
// EvalValidationStep
// ---------------------------------------------------------------------------

export class EvalValidationStep implements ValidationStepRunner {
  readonly step = 'evaluate' as const;

  private config: EvalValidationStepConfig;
  private lastSequenceNumber = 0;

  private fetchFilenamesFn: (
    realmUrl: string,
    options?: RealmFetchOptions,
  ) => Promise<{ filenames: string[]; error?: string }>;
  private evaluateModuleFn: (
    moduleUrl: string,
    realmUrl: string,
  ) => Promise<EvalModuleResult>;
  private getNextSeqFn: (
    slug: string,
    targetRealmUrl: string,
  ) => Promise<number>;

  constructor(config: EvalValidationStepConfig) {
    this.config = config;
    this.fetchFilenamesFn = config.fetchFilenames ?? fetchRealmFilenames;
    this.evaluateModuleFn =
      config.evaluateModuleFn ??
      ((moduleUrl: string, realmUrl: string) =>
        this.defaultEvaluateModule(moduleUrl, realmUrl));
    this.getNextSeqFn =
      config.getNextSequenceNumber ??
      ((slug: string, targetRealmUrl: string) =>
        getNextValidationSequenceNumber(
          slug,
          'Validations/eval_',
          config.evalResultsModuleUrl,
          'EvalResult',
          {
            targetRealmUrl,
            authorization: config.authorization,
            fetch: config.fetch,
          },
        ));
  }

  async run(
    targetRealmUrl: string,
    iteration?: number,
  ): Promise<ValidationStepResult> {
    // Step 1: Discover evaluable files
    let evaluableFiles: string[];
    try {
      evaluableFiles = await this.discoverEvaluableFiles(targetRealmUrl);
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
      log.info('No evaluable .gts files found — nothing to validate');
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
      ? new URL(this.config.issueId, targetRealmUrl).href
      : undefined;

    let seq: number;
    if (iteration != null) {
      seq = iteration;
    } else {
      try {
        let realmSeq = await this.getNextSeqFn(slug, targetRealmUrl);
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
          targetRealmUrl,
          authorization: this.config.authorization,
          fetch: this.config.fetch,
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

    // Step 3: Evaluate each module via sandbox (_run-command → host command)
    let startedAt = Date.now();
    let allModuleResults: EvalModuleErrorData[] = [];
    let failedModules: EvalValidationDetails['modules'] = [];

    for (let file of evaluableFiles) {
      let moduleUrl = new URL(
        file.replace(/\.gts$/, ''),
        ensureTrailingSlash(targetRealmUrl),
      ).href;

      try {
        let result = await this.evaluateModuleFn(moduleUrl, targetRealmUrl);

        allModuleResults.push({
          path: file,
          error: result.error ?? '',
          stackTrace: result.stackTrace,
        });

        if (!result.passed) {
          failedModules.push({
            path: file,
            error: result.error ?? 'Module evaluation failed',
            stackTrace: result.stackTrace,
          });
        }
      } catch (err) {
        let message = `Eval failed: ${err instanceof Error ? err.message : String(err)}`;
        log.warn(`Error evaluating ${file}: ${message}`);
        allModuleResults.push({
          path: file,
          error: message,
        });
        failedModules.push({
          path: file,
          error: message,
        });
      }
    }

    let durationMs = Date.now() - startedAt;
    let passed = failedModules.length === 0;

    // Step 4: Complete the EvalResult card
    if (artifactCreated) {
      let completeResult = await completeEvalResult(
        evalResultId,
        {
          status: passed ? 'passed' : 'failed',
          durationMs,
          moduleResults: allModuleResults,
        },
        {
          targetRealmUrl,
          authorization: this.config.authorization,
          fetch: this.config.fetch,
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
      modules: failedModules,
    };

    let errors = failedModules.map((m) => ({
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

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async discoverEvaluableFiles(
    targetRealmUrl: string,
  ): Promise<string[]> {
    let result = await this.fetchFilenamesFn(targetRealmUrl, {
      authorization: this.config.authorization,
      fetch: this.config.fetch,
    });

    if (result.error) {
      log.warn(`Failed to fetch realm filenames: ${result.error}`);
      throw new Error(result.error);
    }

    return result.filenames
      .filter((f) => f.endsWith('.gts') && !f.endsWith('.test.gts'))
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * Default evaluateModuleFn: calls the evaluate-module host command
   * via `_run-command` on the realm server.
   */
  private async defaultEvaluateModule(
    moduleUrl: string,
    realmUrl: string,
  ): Promise<EvalModuleResult> {
    if (!this.config.serverToken) {
      return {
        passed: false,
        error: 'serverToken is required for eval validation via _run-command',
      };
    }

    let response = await runRealmCommand(
      this.config.realmServerUrl,
      realmUrl,
      EVALUATE_MODULE_COMMAND,
      { moduleUrl, realmUrl },
      {
        authorization: this.config.serverToken,
        fetch: this.config.fetch,
      },
    );

    log.info(
      `run-command response for ${moduleUrl}: status=${response.status}, error=${response.error}, result=${response.result?.slice(0, 300)}`,
    );

    if (response.status !== 'ready') {
      return {
        passed: false,
        error:
          response.error ?? `run-command returned ${response.status} status`,
      };
    }

    // Parse the cardResultString to extract EvaluateModuleResult fields
    if (response.result) {
      try {
        let cardDoc = JSON.parse(response.result);
        let attrs = cardDoc?.data?.attributes ?? cardDoc;
        if (attrs.passed === false) {
          return {
            passed: false,
            error: attrs.error ?? 'Module evaluation failed',
            stackTrace: attrs.stackTrace,
          };
        }
        return { passed: true };
      } catch {
        log.warn(
          `Failed to parse run-command result for ${moduleUrl}: ${response.result?.slice(0, 200)}`,
        );
        return {
          passed: false,
          error:
            'run-command returned an unparsable result — treating as failure',
        };
      }
    }

    return {
      passed: false,
      error: 'run-command did not return a result — treating as failure',
    };
  }
}
