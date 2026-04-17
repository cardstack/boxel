/**
 * Lint validation step — runs ESLint + Prettier on lintable files in the
 * target realm via the realm's `_lint` endpoint.
 *
 * For each `.gts`, `.gjs`, `.ts`, `.js` file discovered in the realm,
 * reads the source and posts it to `_lint`. Collects violations and
 * persists a LintResult card as the validation artifact.
 */

import type { ValidationStepResult } from '../factory-agent';
import { deriveIssueSlug } from '../factory-agent-types';

import {
  fetchRealmFilenames,
  getNextValidationSequenceNumber,
  lintFile,
  readFile,
  type LintFileResponse,
  type RealmFetchOptions,
} from '../realm-operations';
import {
  createLintResult,
  completeLintResult,
  type LintFileResultData,
  type LintViolationData,
} from '../lint-result-cards';
import { logger } from '../logger';

import type { ValidationStepRunner } from './validation-pipeline';

let log = logger('lint-validation-step');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LintValidationStepConfig {
  authorization?: string;
  fetch?: typeof globalThis.fetch;
  realmServerUrl: string;
  lintResultsModuleUrl: string;
  issueId?: string;
  /** Injected for testing — defaults to fetchRealmFilenames. */
  fetchFilenames?: (
    realmUrl: string,
    options?: RealmFetchOptions,
  ) => Promise<{ filenames: string[]; error?: string }>;
  /** Injected for testing — defaults to lintFile from realm-operations. */
  lintFileFn?: (
    realmUrl: string,
    source: string,
    filename: string,
    options?: RealmFetchOptions,
  ) => Promise<LintFileResponse>;
  /** Injected for testing — defaults to readFile from realm-operations. */
  readFileFn?: (
    realmUrl: string,
    path: string,
    options?: RealmFetchOptions,
  ) => Promise<{ ok: boolean; content?: string; error?: string }>;
  /** Injected for testing — defaults to getNextValidationSequenceNumber. */
  getNextSequenceNumber?: (
    slug: string,
    targetRealmUrl: string,
  ) => Promise<number>;
}

/** Flattened POJO for lint validation details — not a card, just data. */
export interface LintValidationDetails {
  lintResultId: string;
  filesChecked: number;
  filesWithErrors: number;
  totalViolations: number;
  violations: { rule: string; file: string; line: number; message: string }[];
}

const LINTABLE_EXTENSIONS = ['.gts', '.gjs', '.ts', '.js'];

// ---------------------------------------------------------------------------
// LintValidationStep
// ---------------------------------------------------------------------------

export class LintValidationStep implements ValidationStepRunner {
  readonly step = 'lint' as const;

  private config: LintValidationStepConfig;
  private lastSequenceNumber = 0;

  private fetchFilenamesFn: (
    realmUrl: string,
    options?: RealmFetchOptions,
  ) => Promise<{ filenames: string[]; error?: string }>;
  private lintFileFn: (
    realmUrl: string,
    source: string,
    filename: string,
    options?: RealmFetchOptions,
  ) => Promise<LintFileResponse>;
  private readFileFn: (
    realmUrl: string,
    path: string,
    options?: RealmFetchOptions,
  ) => Promise<{ ok: boolean; content?: string; error?: string }>;
  private getNextSeqFn: (
    slug: string,
    targetRealmUrl: string,
  ) => Promise<number>;

  constructor(config: LintValidationStepConfig) {
    this.config = config;
    this.fetchFilenamesFn = config.fetchFilenames ?? fetchRealmFilenames;
    this.lintFileFn = config.lintFileFn ?? lintFile;
    this.readFileFn = config.readFileFn ?? readFile;
    this.getNextSeqFn =
      config.getNextSequenceNumber ??
      ((slug: string, targetRealmUrl: string) =>
        getNextValidationSequenceNumber(
          slug,
          'Validations/lint_',
          config.lintResultsModuleUrl,
          'LintResult',
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
    // Step 1: Discover lintable files
    let lintableFiles: string[];
    try {
      lintableFiles = await this.discoverLintableFiles(targetRealmUrl);
    } catch (err) {
      return {
        step: 'lint',
        passed: false,
        errors: [
          {
            message: `Failed to discover lintable files: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }

    if (lintableFiles.length === 0) {
      log.info('No lintable files found — nothing to validate');
      return { step: 'lint', passed: true, files: [], errors: [] };
    }

    log.info(
      `Found ${lintableFiles.length} lintable file(s): ${lintableFiles.join(', ')}`,
    );

    // Step 2: Create the LintResult card (status: running)
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
        // Use the higher of realm state vs in-memory floor. The realm index
        // may be stale if the prior lint run just completed (lint is fast),
        // so the floor prevents sequence reuse / artifact overwrite.
        seq = Math.max(realmSeq, this.lastSequenceNumber + 1);
      } catch (err) {
        log.warn(
          `Failed to resolve sequence number, using floor: ${err instanceof Error ? err.message : String(err)}`,
        );
        seq = this.lastSequenceNumber + 1;
      }
    }

    let lintResultId: string;
    let artifactCreated = false;
    try {
      let createResult = await createLintResult(
        slug,
        this.config.lintResultsModuleUrl,
        {
          targetRealmUrl,
          authorization: this.config.authorization,
          fetch: this.config.fetch,
          sequenceNumber: seq,
          issueURL,
        },
      );
      lintResultId = createResult.lintResultId;
      if (!createResult.created) {
        log.warn(
          `LintResult card creation returned created: false: ${createResult.error ?? 'unknown'}`,
        );
      } else {
        artifactCreated = true;
        this.lastSequenceNumber = seq;
      }
    } catch (err) {
      log.warn(
        `Failed to create LintResult card: ${err instanceof Error ? err.message : String(err)}`,
      );
      lintResultId = `Validations/lint_${slug}-${seq}`;
    }

    // Step 3: Lint each file
    let startedAt = Date.now();
    let allFileResults: LintFileResultData[] = [];
    let allViolations: LintValidationDetails['violations'] = [];
    let fetchOpts: RealmFetchOptions = {
      authorization: this.config.authorization,
      fetch: this.config.fetch,
    };

    for (let file of lintableFiles) {
      try {
        let readResult = await this.readFileFn(targetRealmUrl, file, fetchOpts);
        if (!readResult.ok) {
          let message = `Could not read ${file}: ${readResult.error ?? 'read failed'}`;
          log.warn(message);
          allFileResults.push({
            file,
            violations: [
              {
                rule: 'lint-error',
                file,
                line: 0,
                column: 0,
                message,
                severity: 'error',
              },
            ],
          });
          allViolations.push({ rule: 'lint-error', file, line: 0, message });
          continue;
        }
        if (readResult.content == null) {
          let message = `Could not read ${file}: no content`;
          log.warn(message);
          allFileResults.push({
            file,
            violations: [
              {
                rule: 'lint-error',
                file,
                line: 0,
                column: 0,
                message,
                severity: 'error',
              },
            ],
          });
          allViolations.push({ rule: 'lint-error', file, line: 0, message });
          continue;
        }

        let lintResponse = await this.lintFileFn(
          targetRealmUrl,
          readResult.content,
          file,
          fetchOpts,
        );

        let violations: LintViolationData[] = lintResponse.messages.map(
          (msg) => ({
            rule: msg.ruleId ?? 'unknown',
            file,
            line: msg.line,
            column: msg.column,
            message: msg.message,
            severity:
              msg.severity === 2 ? ('error' as const) : ('warning' as const),
          }),
        );

        allFileResults.push({ file, violations });

        for (let v of violations) {
          if (v.severity === 'error') {
            allViolations.push({
              rule: v.rule ?? 'unknown',
              file: v.file,
              line: v.line,
              message: v.message,
            });
          }
        }
      } catch (err) {
        let message = `Lint failed: ${err instanceof Error ? err.message : String(err)}`;
        log.warn(`Error linting ${file}: ${message}`);
        allFileResults.push({
          file,
          violations: [
            {
              rule: 'lint-error',
              file,
              line: 0,
              column: 0,
              message,
              severity: 'error',
            },
          ],
        });
        allViolations.push({ rule: 'lint-error', file, line: 0, message });
      }
    }

    let durationMs = Date.now() - startedAt;
    let passed = allViolations.length === 0;

    // Step 4: Complete the LintResult card
    if (artifactCreated) {
      let completeResult = await completeLintResult(
        lintResultId,
        {
          status: passed ? 'passed' : 'failed',
          durationMs,
          fileResults: allFileResults,
        },
        {
          targetRealmUrl,
          authorization: this.config.authorization,
          fetch: this.config.fetch,
        },
      );
      if (!completeResult.updated) {
        log.warn(
          `Failed to complete LintResult card ${lintResultId}: ${completeResult.error ?? 'unknown'}`,
        );
      }
    }

    // Step 5: Build result
    let details: LintValidationDetails = {
      lintResultId,
      filesChecked: allFileResults.length,
      filesWithErrors: allFileResults.filter((fr) =>
        fr.violations.some((v) => v.severity === 'error'),
      ).length,
      totalViolations: allViolations.length,
      violations: allViolations,
    };

    let errors = allViolations.map((v) => ({
      file: v.file,
      message: `${v.file}:${v.line} [${v.rule}] ${v.message}`,
    }));

    return {
      step: 'lint',
      passed,
      files: lintableFiles,
      errors,
      details: details as unknown as Record<string, unknown>,
    };
  }

  formatForContext(result: ValidationStepResult): string {
    if (result.passed) {
      let details = result.details as unknown as
        | LintValidationDetails
        | undefined;
      if (details && details.filesChecked > 0) {
        return `## Lint Validation: PASSED\n${details.filesChecked} file(s) checked, no lint errors. (LintResult: ${details.lintResultId})`;
      }
      return '';
    }

    let details = result.details as unknown as
      | LintValidationDetails
      | undefined;
    if (!details) {
      let errorLines = result.errors.map((e) => `- ${e.message}`).join('\n');
      return `## Lint Validation: FAILED\n${errorLines}`;
    }

    let lines: string[] = [
      `## Lint Validation: FAILED`,
      `${details.filesChecked} file(s) checked, ${details.totalViolations} violation(s) in ${details.filesWithErrors} file(s) (LintResult: ${details.lintResultId})`,
    ];

    for (let violation of details.violations) {
      lines.push(
        `  ${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`,
      );
    }

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async discoverLintableFiles(
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
      .filter((f) => LINTABLE_EXTENSIONS.some((ext) => f.endsWith(ext)))
      .sort((a, b) => a.localeCompare(b));
  }
}
