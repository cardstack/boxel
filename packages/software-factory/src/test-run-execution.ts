import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import { runRealmQunit } from '@cardstack/boxel-cli/api';

import { logger } from './logger.ts';

import { getNextValidationSequenceNumber } from './realm-operations.ts';
import { createTestRun, completeTestRun } from './test-run-cards.ts';
import { parseQunitResults } from './test-run-parsing.ts';
import type {
  ExecuteTestRunOptions,
  QunitResults,
  RunTestsFailure,
  RunTestsInMemoryOptions,
  RunTestsResult,
  TestRunHandle,
  TestRunRealmOptions,
} from './test-run-types.ts';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import {
  cacheKeyForInputs,
  type ValidationRunCache,
} from './validation-run-cache.ts';

let log = logger('test-run-execution');

// How long to wait for the in-browser QUnit suite to reach `runEnd` before
// giving up. A hung test page (boot error, infinite loop, never-resolving
// promise) would otherwise block for boxel-cli's full 300s default with no
// signal. Default 60s; override via FACTORY_TEST_TIMEOUT_MS for a heavy suite.
const DEFAULT_QUNIT_TIMEOUT_MS = 60_000;

function qunitTimeoutMs(): number {
  let raw = process.env.FACTORY_TEST_TIMEOUT_MS;
  let parsed = raw != null && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_QUNIT_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Resume Logic
// ---------------------------------------------------------------------------

interface ResumableTestRun {
  testRunId: string;
  sequenceNumber: number;
  pendingTests: string[];
}

/**
 * Resolve whether to resume an existing TestRun or create a new one.
 * Exported for unit testing the resume logic without the harness.
 */
export async function resolveTestRun(
  options: ExecuteTestRunOptions,
): Promise<TestRunHandle & { resumed: boolean; pendingTests?: string[] }> {
  let realmOptions: TestRunRealmOptions = {
    targetRealm: options.targetRealm,
    testResultsModuleUrl: options.testResultsModuleUrl,
    client: options.client,
    workspaceDir: options.workspaceDir,
  };

  let resumeResult = options.forceNew
    ? undefined
    : await findResumableTestRun(realmOptions);

  if (resumeResult) {
    return {
      testRunId: resumeResult.testRunId,
      sequenceNumber: resumeResult.sequenceNumber,
      status: 'running',
      resumed: true,
      pendingTests: resumeResult.pendingTests,
    };
  }

  let sequenceNumber: number;
  if (options.iteration != null) {
    sequenceNumber = options.iteration;
  } else {
    sequenceNumber = await getNextSequenceNumber(
      options.slug,
      realmOptions,
      options.lastSequenceNumber,
    );
  }

  let createResult = await createTestRun(options.slug, options.testNames, {
    ...realmOptions,
    sequenceNumber,
    issueURL: options.issueURL,
    projectCardUrl: options.projectCardUrl,
  });

  if (!createResult.created) {
    return {
      testRunId: createResult.testRunId,
      sequenceNumber,
      status: 'error',
      errorMessage: `Failed to create TestRun: ${createResult.error}`,
      resumed: false,
    };
  }

  return {
    testRunId: createResult.testRunId,
    sequenceNumber,
    status: 'running',
    resumed: false,
  };
}

async function findResumableTestRun(
  options: TestRunRealmOptions,
): Promise<ResumableTestRun | undefined> {
  let targetRealm = ensureTrailingSlash(options.targetRealm);

  let result = await options.client.search(options.targetRealm, {
    filter: {
      on: { module: options.testResultsModuleUrl, name: 'TestRun' },
    },
    sort: [{ by: 'sequenceNumber', direction: 'desc' }],
    page: { size: 1 },
  });

  if (!result?.ok) {
    return undefined;
  }

  let latest = result.data?.[0] as
    | {
        id?: string;
        attributes?: {
          status?: string;
          sequenceNumber?: number;
          moduleResults?: {
            results?: { testName?: string; status?: string }[];
          }[];
        };
      }
    | undefined;

  if (!latest || latest.attributes?.status !== 'running') {
    return undefined;
  }

  let pendingTests = (latest.attributes.moduleResults ?? [])
    .flatMap((mr) => mr.results ?? [])
    .filter((r) => r.status === 'pending')
    .map((r) => r.testName ?? '');

  let cardId = latest.id ?? '';
  let relativePath = cardId.startsWith(targetRealm)
    ? cardId.slice(targetRealm.length)
    : cardId;

  return {
    testRunId: relativePath,
    sequenceNumber: latest.attributes.sequenceNumber ?? 1,
    pendingTests,
  };
}

/**
 * Get the next sequence number for a given slug by searching existing
 * TestRun cards in the realm. Delegates to the shared utility in
 * realm-operations.ts.
 */
async function getNextSequenceNumber(
  slug: string,
  options: TestRunRealmOptions,
  minSequenceNumber = 0,
): Promise<number> {
  let seq = await getNextValidationSequenceNumber(
    options.client,
    slug,
    'Validations/test_',
    options.testResultsModuleUrl,
    'TestRun',
    options.targetRealm,
  );
  return Math.max(seq, minSequenceNumber + 1);
}

// ---------------------------------------------------------------------------
// Pure QUnit Runner
// ---------------------------------------------------------------------------

interface QunitRunnerOptions {
  targetRealm: string;
  client: BoxelCLIClient;
  hostAppUrl: string;
  hostDistDir?: string;
  debug?: boolean;
  /**
   * When set, the browser run is memoized per workspace fingerprint, so the
   * agent's mid-turn `run_tests` and the pipeline's test step don't both
   * drive the same QUnit suite over an unchanged realm.
   */
  cache?: ValidationRunCache;
}

interface QunitRunnerOutput {
  qunitResults: QunitResults;
  durationMs: number;
}

/**
 * Serve the QUnit test page, drive Chromium, and collect QUnit results.
 * Has no realm-artifact side effects — callers own TestRun card creation
 * (validation pipeline) or result flattening (in-memory tool).
 */
async function runQunitInBrowser(
  options: QunitRunnerOptions,
): Promise<QunitRunnerOutput> {
  if (options.cache) {
    // Key by the run inputs so a cache instance shared across realms or
    // runner configurations can never serve another run's results.
    let key = `qunit:${cacheKeyForInputs([
      options.targetRealm,
      options.hostAppUrl,
      options.hostDistDir ?? '',
    ])}`;
    return options.cache.getOrRun(key, () =>
      runQunitInBrowserUncached(options),
    );
  }
  return runQunitInBrowserUncached(options);
}

async function runQunitInBrowserUncached(
  options: QunitRunnerOptions,
): Promise<QunitRunnerOutput> {
  // Delegate to boxel-cli's QUnit engine (CS-11579). The factory no longer
  // maintains its own host-dist-bound runner: boxel-cli owns the browser
  // plumbing and the test harness (its bundled copy), so the factory has no
  // dependency on a live `packages/host/dist` build. We pass the realm token
  // we already hold so boxel-cli authenticates without needing a CLI profile
  // for the target realm.
  // boxel-cli matches the realm token by normalized (trailing-slashed) URL and
  // keys its caches the same way, so normalize before fetching the token AND
  // running — otherwise a non-normalized realm URL misses auth on a private
  // realm and splits cache keys.
  let realmUrl = ensureTrailingSlash(options.targetRealm);
  let authorization =
    (await options.client.getRealmToken(realmUrl)) ?? undefined;
  // The factory owns the timeout value (boxel-cli only exposes the knob) so a
  // hung test page fails fast instead of blocking the full 300s default.
  let timeoutMs = qunitTimeoutMs();
  let start = Date.now();
  let qunitResults: QunitResults;
  let durationMs: number;
  try {
    let run = await runRealmQunit(realmUrl, {
      hostAppUrl: options.hostAppUrl,
      timeoutMs,
      ...(options.hostDistDir ? { hostDistDir: options.hostDistDir } : {}),
      ...(options.debug ? { debug: options.debug } : {}),
      ...(authorization ? { authorization } : {}),
    });
    // Direct assignment (no cast) so the compiler enforces that boxel-cli's
    // QunitResults stays structurally compatible with the factory's.
    qunitResults = run.qunitResults;
    durationMs = run.durationMs;
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    // boxel-cli labels *only* the run-end wait timeout with this marker; a
    // page.goto / asset-fetch stall surfaces as its own Playwright error and is
    // rethrown untouched below. Translate just the run-end case into an
    // actionable diagnostic, preserving the original error as `cause`.
    if (/did not reach runEnd within/i.test(message)) {
      let waited = Date.now() - start;
      throw new Error(
        `QUnit suite did not finish within ${timeoutMs}ms (waited ${waited}ms). ` +
          `The page never reached runEnd — likely an Ember boot error, a hanging ` +
          `test, or a never-resolving promise. Re-run with --debug for browser ` +
          `console output, or raise FACTORY_TEST_TIMEOUT_MS for a heavier suite.`,
        { cause: err },
      );
    }
    throw err;
  }
  log.debug(
    `QUnit completed in ${durationMs}ms: ${qunitResults.runEnd?.testCounts?.total ?? 0} test(s)`,
  );
  return { qunitResults, durationMs };
}

// ---------------------------------------------------------------------------
// Test Execution Orchestration
// ---------------------------------------------------------------------------

/**
 * Orchestrate a full test run: create TestRun card → drive QUnit in browser →
 * update TestRun card → return handle.
 */
export async function executeTestRunFromRealm(
  options: ExecuteTestRunOptions,
): Promise<TestRunHandle> {
  let realmOptions: TestRunRealmOptions = {
    targetRealm: options.targetRealm,
    testResultsModuleUrl: options.testResultsModuleUrl,
    client: options.client,
    workspaceDir: options.workspaceDir,
  };
  let completeOptions = {
    ...realmOptions,
    projectCardUrl: options.projectCardUrl,
  };

  let resolved = await resolveTestRun(options);
  if (resolved.status === 'error') {
    return resolved;
  }
  let testRunId = resolved.testRunId;
  let sequenceNumber = resolved.sequenceNumber;

  let runnerStart = Date.now();
  try {
    let { qunitResults, durationMs } = await runQunitInBrowser({
      targetRealm: options.targetRealm,
      client: options.client,
      hostAppUrl: options.hostAppUrl,
      hostDistDir: options.hostDistDir,
      debug: options.debug,
      cache: options.cache,
    });

    let attrs = parseQunitResults(qunitResults);
    attrs.durationMs = durationMs;

    let completeResult = await completeTestRun(
      testRunId,
      attrs,
      completeOptions,
    );

    return {
      testRunId,
      sequenceNumber,
      status: attrs.status,
      ...(attrs.errorMessage ? { errorMessage: attrs.errorMessage } : {}),
      ...(completeResult.error ? { error: completeResult.error } : {}),
    };
  } catch (err) {
    let durationMs = Date.now() - runnerStart;
    let errorMessage = err instanceof Error ? err.message : String(err);
    log.error(`Error: ${errorMessage} (${durationMs}ms)`);
    try {
      await completeTestRun(
        testRunId,
        {
          status: 'error',
          passedCount: 0,
          failedCount: 0,
          durationMs,
          errorMessage,
          moduleResults: [],
        },
        completeOptions,
      );
    } catch {
      // Best-effort
    }
    return { testRunId, sequenceNumber, status: 'error', errorMessage };
  }
}

// ---------------------------------------------------------------------------
// In-Memory Test Runner (agent tool)
// ---------------------------------------------------------------------------

/**
 * Run the realm's QUnit tests and return a flat in-memory result object.
 * Unlike `executeTestRunFromRealm`, this does NOT create or update a
 * `TestRun` card — the result is consumed by the agent directly for
 * mid-turn self-validation. The orchestrator's validation pipeline still
 * writes a `TestRun` artifact after `signal_done`.
 */
export async function runTestsInMemory(
  options: RunTestsInMemoryOptions,
): Promise<RunTestsResult> {
  let testFiles: string[];
  try {
    let listing = await options.client.listFiles(options.targetRealm);
    if (listing.error) {
      return emptyErrorResult(
        `Failed to discover test files: ${listing.error}`,
      );
    }
    testFiles = (listing.filenames ?? []).filter((f) =>
      f.endsWith('.test.gts'),
    );
  } catch (err) {
    return emptyErrorResult(
      `Failed to discover test files: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (testFiles.length === 0) {
    return {
      status: 'passed',
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 0,
      testFiles: [],
      failures: [],
    };
  }

  try {
    let { qunitResults, durationMs } = await runQunitInBrowser({
      targetRealm: options.targetRealm,
      client: options.client,
      hostAppUrl: options.hostAppUrl,
      hostDistDir: options.hostDistDir,
      debug: options.debug,
      cache: options.cache,
    });

    let attrs = parseQunitResults(qunitResults);
    let failures: RunTestsFailure[] = [];
    for (let moduleResult of attrs.moduleResults) {
      let moduleName = moduleResult.moduleRef?.module ?? 'unknown';
      for (let entry of moduleResult.results) {
        if (entry.status === 'failed' || entry.status === 'error') {
          failures.push({
            testName: entry.testName,
            module: moduleName,
            message: entry.message ?? `Test ${entry.status}`,
            ...(entry.stackTrace ? { stackTrace: entry.stackTrace } : {}),
          });
        }
      }
    }

    // parseQunitResults only ever returns passed/failed/error terminally;
    // defensively coerce the 'running' branch of the union away.
    let status: RunTestsResult['status'] =
      attrs.status === 'running' ? 'error' : attrs.status;

    return {
      status,
      passedCount: attrs.passedCount,
      failedCount: attrs.failedCount,
      skippedCount: attrs.skippedCount ?? 0,
      durationMs,
      testFiles,
      failures,
      ...(attrs.errorMessage ? { errorMessage: attrs.errorMessage } : {}),
    };
  } catch (err) {
    let errorMessage = err instanceof Error ? err.message : String(err);
    log.error(`runTestsInMemory error: ${errorMessage}`);
    return {
      status: 'error',
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 0,
      testFiles,
      failures: [],
      errorMessage,
    };
  }
}

function emptyErrorResult(errorMessage: string): RunTestsResult {
  return {
    status: 'error',
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    durationMs: 0,
    testFiles: [],
    failures: [],
    errorMessage,
  };
}
