/**
 * Test validation step — runs QUnit tests in the target realm
 * and reads back detailed results from the completed TestRun card.
 *
 * Wraps `executeTestRunFromRealm()` for the actual test execution,
 * then reads the TestRun card from the realm to get detailed failure
 * data (individual test names, assertions, stack traces).
 *
 * Per phase-2-plan.md, realm reads will eventually become local filesystem
 * reads after boxel-cli integration — cheap rather than HTTP round-trips.
 */

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import type { ValidationStepResult } from '../factory-agent';
import { deriveIssueSlug } from '../factory-agent';
import { executeTestRunFromRealm } from '../test-run-execution';
import type { ExecuteTestRunOptions, TestRunHandle } from '../test-run-types';
import { logger } from '../logger';
import { readCard } from '../workspace-fs';

import type { ValidationStepRunner } from './validation-pipeline';

let log = logger('test-validation-step');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestValidationStepConfig {
  client: BoxelCLIClient;
  realmServerUrl: string;
  hostAppUrl: string;
  testResultsModuleUrl: string;
  /**
   * Local workspace directory mirroring the target realm. The step reads
   * back the TestRun card from here after execution; it also passes this
   * through to the test-run writer so the initial/updated TestRun card is
   * persisted locally and synced by the orchestrator.
   */
  workspaceDir: string;
  issueId?: string;
  /** Injected for testing — defaults to executeTestRunFromRealm. */
  executeTestRun?: (options: ExecuteTestRunOptions) => Promise<TestRunHandle>;
  /** Injected for testing — defaults to client.listFiles. */
  fetchFilenames?: (
    realmUrl: string,
  ) => Promise<{ filenames: string[]; error?: string }>;
  /**
   * Injected for testing — defaults to reading from the workspace.
   * `realmUrl` is ignored by the default; retained so tests can mock
   * realm-URL-keyed reads if they wish.
   */
  readCard?: (
    realmUrl: string,
    path: string,
  ) => Promise<{
    ok: boolean;
    document?: LooseSingleCardDocument;
    error?: string;
  }>;
}

/** Flattened POJO for test validation details — not a card, just data. */
export interface TestValidationDetails {
  testRunId: string;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  durationMs: number;
  failures: TestValidationFailure[];
}

export interface TestValidationFailure {
  testName: string;
  module: string;
  message: string;
  stackTrace?: string;
}

// ---------------------------------------------------------------------------
// TestValidationStep
// ---------------------------------------------------------------------------

export class TestValidationStep implements ValidationStepRunner {
  readonly step = 'test' as const;

  private config: TestValidationStepConfig;
  private lastSequenceNumber = 0;

  private executeTestRunFn: (
    options: ExecuteTestRunOptions,
  ) => Promise<TestRunHandle>;
  private fetchFilenamesFn: (
    realmUrl: string,
  ) => Promise<{ filenames: string[]; error?: string }>;
  private readCardFn: (
    realmUrl: string,
    path: string,
  ) => Promise<{
    ok: boolean;
    document?: LooseSingleCardDocument;
    error?: string;
  }>;

  constructor(config: TestValidationStepConfig) {
    this.config = config;
    this.executeTestRunFn = config.executeTestRun ?? executeTestRunFromRealm;
    this.fetchFilenamesFn =
      config.fetchFilenames ??
      ((realmUrl: string) => config.client.listFiles(realmUrl));
    this.readCardFn =
      config.readCard ??
      (async (_realmUrl: string, path: string) => {
        let result = await readCard(
          config.workspaceDir,
          path.endsWith('.json') ? path : `${path}.json`,
        );
        return {
          ok: result.ok,
          document: result.document as LooseSingleCardDocument | undefined,
          error: result.error,
        };
      });
  }

  async run(
    targetRealm: string,
    iteration?: number,
  ): Promise<ValidationStepResult> {
    // Step 1: Discover .test.gts files in the realm
    let testFiles: string[];
    try {
      testFiles = await this.discoverTestFiles(targetRealm);
    } catch (err) {
      return {
        step: 'test',
        passed: false,
        errors: [
          {
            message: `Failed to discover test files: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }

    if (testFiles.length === 0) {
      log.info('No .test.gts files found — nothing to validate');
      return { step: 'test', passed: true, files: [], errors: [] };
    }

    log.info(`Found ${testFiles.length} test file(s): ${testFiles.join(', ')}`);

    // Step 2: Execute tests
    let handle: TestRunHandle;
    try {
      let slug = this.config.issueId
        ? deriveIssueSlug(this.config.issueId)
        : 'validation';

      // Build the issue card URL for the TestRun → Issue linksTo relationship.
      // issueId is a realm-relative path like "Issues/sticky-note-define-core".
      let issueURL = this.config.issueId
        ? new URL(this.config.issueId, targetRealm).href
        : undefined;

      handle = await this.executeTestRunFn({
        targetRealm,
        testResultsModuleUrl: this.config.testResultsModuleUrl,
        slug,
        testNames: [],
        client: this.config.client,
        workspaceDir: this.config.workspaceDir,
        realmServerUrl: this.config.realmServerUrl,
        hostAppUrl: this.config.hostAppUrl,
        forceNew: true,
        lastSequenceNumber: this.lastSequenceNumber,
        issueURL,
        iteration,
      });

      if (handle.sequenceNumber != null) {
        this.lastSequenceNumber = handle.sequenceNumber;
      }
    } catch (err) {
      return {
        step: 'test',
        passed: false,
        files: testFiles,
        errors: [
          {
            message: `Test execution failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }

    // Step 3: Read back the completed TestRun card for detailed results
    let details = await this.readTestRunDetails(targetRealm, handle.testRunId);

    if (handle.status === 'error') {
      log.info(
        `Test run error${handle.errorMessage ? `: ${handle.errorMessage}` : ''}`,
      );
    } else if (details) {
      let skippedNote =
        details.skippedCount > 0 ? `, ${details.skippedCount} skipped` : '';
      log.info(
        `${details.passedCount} passed, ${details.failedCount} failed${skippedNote}`,
      );
    } else {
      log.info(`Test run ${handle.status}`);
    }

    // Step 4: Map to ValidationStepResult
    if (handle.status === 'passed') {
      return {
        step: 'test',
        passed: true,
        files: testFiles,
        errors: [],
        details: details as unknown as Record<string, unknown>,
      };
    }

    let errors =
      details && details.failures.length > 0
        ? details.failures.map((f) => ({
            file: f.module,
            message: `${f.testName}: ${f.message}`,
            stackTrace: f.stackTrace,
          }))
        : [
            {
              message: handle.errorMessage ?? `Tests ${handle.status}`,
            },
          ];

    return {
      step: 'test',
      passed: false,
      files: testFiles,
      errors,
      details: details as unknown as Record<string, unknown>,
    };
  }

  formatForContext(result: ValidationStepResult): string {
    if (result.passed) {
      let details = result.details as unknown as
        | TestValidationDetails
        | undefined;
      if (details && details.passedCount > 0) {
        let skippedNote =
          details.skippedCount > 0 ? `, ${details.skippedCount} skipped` : '';
        return `## Test Validation: PASSED\n${details.passedCount} test(s) passed${skippedNote} (TestRun: ${details.testRunId})`;
      }
      return '';
    }

    let details = result.details as unknown as
      | TestValidationDetails
      | undefined;
    if (!details) {
      // No detailed data — format from errors array
      let errorLines = result.errors.map((e) => `- ${e.message}`).join('\n');
      return `## Test Validation: FAILED\n${errorLines}`;
    }

    let lines: string[] = [
      `## Test Validation: FAILED`,
      `${details.passedCount} passed, ${details.failedCount} failed${details.skippedCount > 0 ? `, ${details.skippedCount} skipped` : ''} (TestRun: ${details.testRunId})`,
    ];

    for (let failure of details.failures) {
      lines.push('');
      lines.push(`FAILED: "${failure.testName}" (${failure.module})`);
      lines.push(`  ${failure.message}`);
      if (failure.stackTrace) {
        lines.push(`  ${failure.stackTrace.slice(0, 300)}`);
      }
    }

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async discoverTestFiles(targetRealm: string): Promise<string[]> {
    let result = await this.fetchFilenamesFn(targetRealm);

    if (result.error) {
      log.warn(`Failed to fetch realm filenames: ${result.error}`);
      throw new Error(result.error);
    }

    return result.filenames.filter((f) => f.endsWith('.test.gts'));
  }

  private async readTestRunDetails(
    targetRealm: string,
    testRunId: string,
  ): Promise<TestValidationDetails | undefined> {
    try {
      let result = await this.readCardFn(targetRealm, testRunId);

      if (!result.ok || !result.document) {
        log.warn(
          `Could not read TestRun card ${testRunId}: ${result.error ?? 'unknown error'}`,
        );
        return undefined;
      }

      return extractTestDetails(testRunId, result.document);
    } catch (err) {
      log.warn(
        `Error reading TestRun card ${testRunId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestRunCardAttributes {
  status?: string;
  passedCount?: number;
  failedCount?: number;
  durationMs?: number;
  errorMessage?: string;
  moduleResults?: {
    moduleRef?: { module: string; name: string };
    results?: {
      testName?: string;
      status?: string;
      message?: string;
      stackTrace?: string;
      durationMs?: number;
    }[];
  }[];
}

/**
 * Extract test validation details from a TestRun card document.
 * Handles the JSON:API document shape returned by `readFile()`.
 */
function extractTestDetails(
  testRunId: string,
  document: LooseSingleCardDocument,
): TestValidationDetails {
  let attrs = (document.data?.attributes ?? {}) as TestRunCardAttributes;

  let failures: TestValidationFailure[] = [];
  let passedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (let moduleResult of attrs.moduleResults ?? []) {
    let moduleName = moduleResult.moduleRef?.module ?? 'unknown';
    for (let result of moduleResult.results ?? []) {
      if (result.status === 'passed') {
        passedCount++;
      } else if (result.status === 'failed' || result.status === 'error') {
        failedCount++;
        failures.push({
          testName: result.testName ?? 'unknown test',
          module: moduleName,
          message: result.message ?? `Test ${result.status}`,
          stackTrace: result.stackTrace,
        });
      } else if (result.status === 'skipped') {
        skippedCount++;
      }
    }
  }

  // Prefer the card's computed counts if available
  if (attrs.passedCount != null) {
    passedCount = attrs.passedCount;
  }
  if (attrs.failedCount != null) {
    failedCount = attrs.failedCount;
  }
  if ((attrs as Record<string, unknown>).skippedCount != null) {
    skippedCount = (attrs as Record<string, unknown>).skippedCount as number;
  }

  return {
    testRunId,
    passedCount,
    failedCount,
    skippedCount,
    durationMs: attrs.durationMs ?? 0,
    failures,
  };
}
