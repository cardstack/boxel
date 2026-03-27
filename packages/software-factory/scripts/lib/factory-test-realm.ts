import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import type {
  LooseSingleCardDocument,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';

import type { TestResult } from './factory-agent';
import {
  cancelAllIndexingJobs,
  ensureTrailingSlash,
  pullRealmFiles,
  readCardSource,
  searchRealm,
  writeCardSource,
} from './realm-operations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of the JSON summary emitted by `scripts/run-realm-tests.ts`.
 * This is the `output` field of the ToolResult when the `run-realm-tests`
 * script tool is invoked via the ToolExecutor.
 */
export interface RunRealmTestsOutput {
  sourceRealmPath?: string;
  sourceRealmUrl?: string;
  scratchPath?: string;
  scratchRealmUrl?: string;
  specFiles?: string[];
  copiedFixtures?: string[];
  expected?: number;
  unexpected?: number;
  skipped?: number;
  failures?: RunRealmTestsFailure[];
}

export interface RunRealmTestsFailure {
  title: string;
  outcome: string;
  error: string;
}

/** Realm connection options shared by createTestRun and completeTestRun. */
export interface TestRunRealmOptions {
  testRealmUrl: string;
  /** URL to the test-results module in the source realm. Required, never inferred. */
  testResultsModuleUrl: string;
  authorization?: string;
  fetch?: typeof globalThis.fetch;
}

/** Additional options for creating a new TestRun card. */
export interface CreateTestRunOptions {
  sequenceNumber?: number;
  ticketURL?: string;
  specRef?: ResolvedCodeRef;
}

/** The primary return type from test execution — the card ID + status signal. */
export interface TestRunHandle {
  testRunId: string;
  status: 'running' | 'passed' | 'failed' | 'error';
  errorMessage?: string;
}

/**
 * Serialized attributes for a TestRun card. This is the shape that maps
 * directly to the TestRun card definition in test-results.gts.
 */
export interface TestRunAttributes {
  sequenceNumber?: number;
  runAt?: string;
  completedAt?: string;
  status: 'running' | 'passed' | 'failed' | 'error';
  passedCount: number;
  failedCount: number;
  durationMs?: number;
  errorMessage?: string;
  results: TestResultEntryData[];
}

/** Shape of a single test result entry within a TestRun card. */
export interface TestResultEntryData {
  testName: string;
  status: 'pending' | 'passed' | 'failed' | 'error';
  message?: string;
  stackTrace?: string;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Result Parsing
// ---------------------------------------------------------------------------

/**
 * Convert the raw JSON output from `run-realm-tests` into `TestRunAttributes`
 * — the serialized form of a TestRun card. This can be used directly as
 * card attributes when creating or updating a TestRun card instance.
 *
 * @param output  The parsed JSON summary from `run-realm-tests`.
 * @param durationMs  Total wall-clock time for the test run.
 */
export function parseRunRealmTestsOutput(
  output: RunRealmTestsOutput,
  durationMs: number,
): TestRunAttributes {
  let expected = output.expected ?? 0;
  let unexpected = output.unexpected ?? 0;
  let rawFailures = output.failures ?? [];

  let results: TestResultEntryData[] = rawFailures.map((f) => {
    let { message, stackTrace } = splitErrorAndStack(f.error);
    return {
      testName: f.title,
      status: 'failed' as const,
      message,
      ...(stackTrace ? { stackTrace: stackTrace.slice(0, 500) } : {}),
    };
  });

  let status: TestRunAttributes['status'] =
    unexpected > 0 || results.length > 0 ? 'failed' : 'passed';

  // When the script produced no stats at all (e.g., crashed before running
  // any tests), treat it as an error.
  if (expected === 0 && unexpected === 0 && rawFailures.length === 0) {
    status = 'error';
  }

  return {
    status,
    passedCount: expected,
    failedCount: unexpected,
    durationMs,
    results,
  };
}

/**
 * Parse a `ToolResult.output` from the `run-realm-tests` script tool.
 *
 * The ToolExecutor returns the script's stdout parsed as JSON when the
 * output format is 'json'. If parsing failed it wraps the raw text in
 * `{ raw: string }`. This helper handles both cases gracefully.
 *
 * Returns `TestRunAttributes` — the serialized form of a TestRun card.
 */
export function parseToolResultOutput(
  toolOutput: unknown,
  durationMs: number,
): TestRunAttributes {
  if (
    toolOutput &&
    typeof toolOutput === 'object' &&
    !Array.isArray(toolOutput)
  ) {
    if ('error' in toolOutput) {
      let errorMsg =
        typeof (toolOutput as Record<string, unknown>).error === 'string'
          ? ((toolOutput as Record<string, unknown>).error as string)
          : JSON.stringify(toolOutput);
      return {
        status: 'error',
        passedCount: 0,
        failedCount: 0,
        durationMs,
        errorMessage: errorMsg,
        results: [
          { testName: '(test harness)', status: 'error', message: errorMsg },
        ],
      };
    }

    if ('raw' in toolOutput) {
      let raw = String((toolOutput as Record<string, unknown>).raw);
      let msg = `Unparseable output: ${raw.slice(0, 500)}`;
      return {
        status: 'error',
        passedCount: 0,
        failedCount: 0,
        durationMs,
        errorMessage: msg,
        results: [
          { testName: '(test harness)', status: 'error', message: msg },
        ],
      };
    }

    return parseRunRealmTestsOutput(
      toolOutput as RunRealmTestsOutput,
      durationMs,
    );
  }

  let msg = `Unexpected tool output type: ${typeof toolOutput}`;
  return {
    status: 'error',
    passedCount: 0,
    failedCount: 0,
    durationMs,
    errorMessage: msg,
    results: [{ testName: '(test harness)', status: 'error', message: msg }],
  };
}

// ---------------------------------------------------------------------------
// TestRun Card Lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a `TestRun` card in the test realm with `status: running` and
 * pre-populated `pending` result entries. Returns the card path as the handle.
 *
 * @param slug  Ticket slug used to derive the card path (e.g. "define-sticky-note-core")
 * @param testNames  Names of all tests to be run (pre-populated as `pending`)
 * @param options  Realm connection options including the required testResultsModuleUrl
 * @param options  Realm connection options + optional sequenceNumber, ticketURL, specRef
 */
export async function createTestRun(
  slug: string,
  testNames: string[],
  options: TestRunRealmOptions & CreateTestRunOptions,
): Promise<{ testRunId: string; created: boolean; error?: string }> {
  let seq = options.sequenceNumber ?? 1;
  let testRunId = `Test Runs/${slug}-${seq}`;

  let document = buildTestRunCardDocument(
    testNames,
    options.testResultsModuleUrl,
    {
      sequenceNumber: seq,
      ticketURL: options.ticketURL,
      specRef: options.specRef,
    },
  );

  let result = await writeCardSource(
    options.testRealmUrl,
    `${testRunId}.json`,
    document,
    { authorization: options.authorization, fetch: options.fetch },
  );

  if (!result.ok) {
    return { testRunId, created: false, error: result.error };
  }

  return { testRunId, created: true };
}

/**
 * Update an existing `TestRun` card with test results and final status.
 * Accepts `TestRunAttributes` directly — the same shape returned by
 * `parseRunRealmTestsOutput`.
 */
export async function completeTestRun(
  testRunId: string,
  attrs: TestRunAttributes,
  options: TestRunRealmOptions,
): Promise<{ updated: boolean; error?: string }> {
  let fetchOptions = {
    authorization: options.authorization,
    fetch: options.fetch,
  };

  // Read the existing card.
  let readResult = await readCardSource(
    options.testRealmUrl,
    testRunId,
    fetchOptions,
  );

  if (!readResult.ok || !readResult.document) {
    return {
      updated: false,
      error: `Failed to read TestRun: ${readResult.error}`,
    };
  }

  // Merge completion attributes into the existing document.
  let completionAttrs: Record<string, unknown> = {
    status: attrs.status,
    completedAt: new Date().toISOString(),
    passedCount: attrs.passedCount,
    failedCount: attrs.failedCount,
    durationMs: attrs.durationMs,
    results: attrs.results,
  };
  if (attrs.errorMessage) {
    completionAttrs.errorMessage = attrs.errorMessage;
  }

  readResult.document.data.attributes = {
    ...readResult.document.data.attributes,
    ...completionAttrs,
  };

  let writeResult = await writeCardSource(
    options.testRealmUrl,
    `${testRunId}.json`,
    readResult.document,
    fetchOptions,
  );

  if (!writeResult.ok) {
    return {
      updated: false,
      error: `Failed to update TestRun: ${writeResult.error}`,
    };
  }

  return { updated: true };
}

// ---------------------------------------------------------------------------
// Card Document Builders (pure functions, testable)
// ---------------------------------------------------------------------------

/**
 * Build the initial card document for a TestRun with `status: running`
 * and pre-populated `pending` result entries.
 *
 * Returns a `LooseSingleCardDocument` from `@cardstack/runtime-common` —
 * the standard card document shape for realm HTTP API writes.
 */
export function buildTestRunCardDocument(
  testNames: string[],
  testResultsModuleUrl: string,
  options?: CreateTestRunOptions,
): LooseSingleCardDocument {
  let results: TestResultEntryData[] = testNames.map((name) => ({
    testName: name,
    status: 'pending' as const,
  }));

  let attributes: Record<string, unknown> = {
    sequenceNumber: options?.sequenceNumber ?? 1,
    runAt: new Date().toISOString(),
    status: 'running',
    passedCount: 0,
    failedCount: 0,
    results,
  };

  if (options?.specRef) {
    attributes.specRef = options.specRef;
  }

  let relationships:
    | Record<string, { links: { self: string | null } }>
    | undefined;
  if (options?.ticketURL) {
    relationships = {
      ticket: { links: { self: options.ticketURL } },
    };
  }

  return {
    data: {
      type: 'card',
      attributes,
      ...(relationships ? { relationships } : {}),
      meta: {
        adoptsFrom: {
          module: testResultsModuleUrl,
          name: 'TestRun',
        },
      },
    },
  } as LooseSingleCardDocument;
}


// ---------------------------------------------------------------------------
// Test Artifacts Realm Management
// ---------------------------------------------------------------------------

/**
 * Ensure a test artifacts realm exists for the given project.
 * Reads the Project card's `testArtifactsRealmUrl` field. If already set,
 * returns it. Otherwise creates a new realm and saves the URL back to the card.
 */
export async function ensureTestArtifactsRealm(
  projectCardUrl: string,
  options: {
    authorization?: string;
    fetch?: typeof globalThis.fetch;
    realmServerUrl: string;
    darkfactoryModuleUrl: string;
  },
): Promise<{ testArtifactsRealmUrl: string; created: boolean; error?: string }> {
  let fetchOptions = {
    authorization: options.authorization,
    fetch: options.fetch,
  };

  // Read the Project card.
  let readResult = await readCardSource(
    new URL(projectCardUrl).origin + '/',
    new URL(projectCardUrl).pathname.slice(1),
    fetchOptions,
  );

  if (!readResult.ok || !readResult.document) {
    return {
      testArtifactsRealmUrl: '',
      created: false,
      error: `Failed to read Project card: ${readResult.error}`,
    };
  }

  let existingUrl = readResult.document.data.attributes?.testArtifactsRealmUrl;
  if (typeof existingUrl === 'string' && existingUrl.length > 0) {
    return { testArtifactsRealmUrl: existingUrl, created: false };
  }

  // Derive realm name from project.
  let projectName =
    (readResult.document.data.attributes?.projectName as string) ?? 'Project';
  let slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let realmName = `${projectName} Test Artifacts`;
  let endpoint = `${slug}-test-artifacts`;

  // Try creating the realm, incrementing on collision.
  let testArtifactsRealmUrl = '';
  let created = false;
  let fetchImpl = options.fetch ?? globalThis.fetch;
  let serverUrl = ensureTrailingSlash(options.realmServerUrl);

  for (let attempt = 0; attempt < 5; attempt++) {
    let tryEndpoint = attempt === 0 ? endpoint : `${endpoint}-${attempt + 1}`;
    let headers: Record<string, string> = {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
    };
    if (options.authorization) {
      headers['Authorization'] = options.authorization;
    }

    try {
      let response = await fetchImpl(`${serverUrl}_create-realm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: {
            type: 'realm',
            attributes: {
              name: realmName,
              endpoint: tryEndpoint,
            },
          },
        }),
      });

      if (response.ok) {
        let result = (await response.json()) as {
          data?: { id?: string };
        };
        testArtifactsRealmUrl = result.data?.id ?? '';
        created = true;
        break;
      }

      let body = await response.text();
      if (response.status === 400 && body.includes('already exists')) {
        continue; // Try next endpoint
      }

      return {
        testArtifactsRealmUrl: '',
        created: false,
        error: `Failed to create test artifacts realm: HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    } catch (err) {
      return {
        testArtifactsRealmUrl: '',
        created: false,
        error: `Failed to create test artifacts realm: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  if (!testArtifactsRealmUrl) {
    return {
      testArtifactsRealmUrl: '',
      created: false,
      error: 'Failed to create test artifacts realm after 5 attempts',
    };
  }

  // Save the URL back to the Project card.
  readResult.document.data.attributes = {
    ...readResult.document.data.attributes,
    testArtifactsRealmUrl,
  };

  let realmUrl = new URL(projectCardUrl).origin + '/';
  let cardPath = new URL(projectCardUrl).pathname.slice(1);
  await writeCardSource(realmUrl, `${cardPath}.json`, readResult.document, fetchOptions);

  return { testArtifactsRealmUrl, created };
}

// ---------------------------------------------------------------------------
// Test Execution Orchestration
// ---------------------------------------------------------------------------

export interface ExecuteTestRunOptions {
  targetRealmUrl: string;
  testResultsModuleUrl: string;
  slug: string;
  specPaths: string[];
  testNames: string[];
  authorization?: string;
  fetch?: typeof globalThis.fetch;
  forceNew?: boolean;
  ticketURL?: string;
  specRef?: ResolvedCodeRef;
  /** URL to the Project card — used to read/write testArtifactsRealmUrl. */
  projectCardUrl?: string;
  /** Explicit test realm URL. If not set, derived from Project card. */
  testRealmUrl?: string;
}

/**
 * Resolve whether to resume an existing TestRun or create a new one.
 * Returns the testRunId and whether this is a resumed run.
 *
 * Exported for unit testing the resume logic without the harness.
 */
export async function resolveTestRun(
  options: ExecuteTestRunOptions,
): Promise<TestRunHandle & { resumed: boolean; pendingTests?: string[] }> {
  // TestRun cards live in the target realm.
  let realmOptions: TestRunRealmOptions = {
    testRealmUrl: options.targetRealmUrl,
    testResultsModuleUrl: options.testResultsModuleUrl,
    authorization: options.authorization,
    fetch: options.fetch,
  };

  let resumeResult = options.forceNew
    ? undefined
    : await findResumableTestRun(realmOptions);

  if (resumeResult) {
    return {
      testRunId: resumeResult.testRunId,
      status: 'running',
      resumed: true,
      pendingTests: resumeResult.pendingTests,
    };
  }

  let sequenceNumber = await getNextSequenceNumber(realmOptions);

  let createResult = await createTestRun(
    options.slug,
    options.testNames,
    {
      ...realmOptions,
      sequenceNumber,
      ticketURL: options.ticketURL,
      specRef: options.specRef,
    },
  );

  if (!createResult.created) {
    return {
      testRunId: createResult.testRunId,
      status: 'error',
      errorMessage: `Failed to create TestRun: ${createResult.error}`,
      resumed: false,
    };
  }

  return {
    testRunId: createResult.testRunId,
    status: 'running',
    resumed: false,
  };
}

/**
 * Orchestrate a full test run: create TestRun card → pull realms → start
 * harness → run Playwright → update results → cleanup → return handle.
 *
 * This is the main entry point that the orchestrator calls after the agent
 * has written test specs to the test realm.
 */
export async function executeTestRunFromRealm(
  options: ExecuteTestRunOptions,
): Promise<TestRunHandle> {
  // TestRun cards and specs live in the target realm.
  let realmOptions: TestRunRealmOptions = {
    testRealmUrl: options.targetRealmUrl,
    testResultsModuleUrl: options.testResultsModuleUrl,
    authorization: options.authorization,
    fetch: options.fetch,
  };

  // Step 1-2: Resolve or create the TestRun card.
  let resolved = await resolveTestRun(options);
  if (resolved.status === 'error') {
    return resolved;
  }
  let testRunId = resolved.testRunId;

  // When resuming, filter to only the tests that are still pending.
  let effectiveTestNames = resolved.pendingTests?.length
    ? resolved.pendingTests
    : options.testNames;

  // Step 2a: Ensure test artifacts realm exists (if projectCardUrl provided).
  let testArtifactsRealmUrl = options.testRealmUrl;
  if (options.projectCardUrl) {
    let realmServerUrl = ensureTrailingSlash(
      new URL(options.targetRealmUrl).origin + '/',
    );
    let ensureResult = await ensureTestArtifactsRealm(options.projectCardUrl, {
      authorization: options.authorization,
      fetch: options.fetch,
      realmServerUrl,
      darkfactoryModuleUrl: options.testResultsModuleUrl.replace(
        '/test-results',
        '/darkfactory',
      ),
    });
    if (ensureResult.error) {
      return {
        testRunId,
        status: 'error',
        errorMessage: `Failed to ensure test artifacts realm: ${ensureResult.error}`,
      };
    }
    testArtifactsRealmUrl = ensureResult.testArtifactsRealmUrl;
  }

  // Step 2b: Cancel all indexing jobs on the test artifacts realm before running tests.
  if (testArtifactsRealmUrl) {
    await cancelAllIndexingJobs(testArtifactsRealmUrl, {
      authorization: options.authorization,
      fetch: options.fetch,
    });
  }

  // Step 2c: Determine the Run folder path for test artifacts.
  // Extract sequence number from testRunId (format: "Test Runs/{slug}-{seq}")
  let seqMatch = testRunId.match(/-(\d+)$/);
  let runSeq = seqMatch ? seqMatch[1] : '1';
  let testArtifactsRunFolder = testArtifactsRealmUrl
    ? `Run ${runSeq}/`
    : undefined;

  // Steps 3-8: Pull realms, start harness, run Playwright, stream results.
  let tmpBase = mkdtempSync(join(tmpdir(), 'sf-test-run-'));
  let targetLocalDir = join(tmpBase, 'target');
  let specsLocalDir = join(tmpBase, 'specs');
  mkdirSync(targetLocalDir, { recursive: true });
  mkdirSync(specsLocalDir, { recursive: true });

  let runtime: { stop(): Promise<void> } | undefined;

  try {
    // Step 3: Pull target realm to local temp dir.
    // TODO: Refactor to use `boxel pull` CLI once it supports a --jwt argument
    // for authenticating with private realms. Currently uses HTTP-based pull
    // via pullRealmFiles() which accepts an authorization header directly.
    let pullTargetResult = await pullRealmFiles(
      options.targetRealmUrl,
      targetLocalDir,
      { authorization: options.authorization, fetch: options.fetch },
    );
    if (pullTargetResult.error) {
      let errorMessage = `Failed to pull target realm: ${pullTargetResult.error}`;
      await completeTestRun(testRunId, {
        status: 'error',
        passedCount: 0,
        failedCount: 0,
        errorMessage,
        results: [],
      }, realmOptions);
      return { testRunId, status: 'error', errorMessage };
    }

    // Step 4-5: Start realm server from pulled target realm.
    // The harness handles caching (ensureFactoryRealmTemplate) and
    // server startup (startFactoryRealmServer) internally.
    let { startFactoryRealmServer } = await import('../../src/harness');
    runtime = await startFactoryRealmServer({ realmDir: targetLocalDir });
    let startedRealm = runtime as import('../../src/harness').StartedFactoryRealm;

    // Step 6: Pull test specs from target realm to local temp dir.
    // Specs now live in the target realm's Tests/ folder.
    // TODO: Refactor to use `boxel pull` CLI once it supports --jwt.
    let pullSpecsResult = await pullRealmFiles(
      options.targetRealmUrl,
      specsLocalDir,
      { authorization: options.authorization, fetch: options.fetch },
    );
    if (pullSpecsResult.error) {
      let errorMessage = `Failed to pull test specs: ${pullSpecsResult.error}`;
      await completeTestRun(testRunId, {
        status: 'error',
        passedCount: 0,
        failedCount: 0,
        errorMessage,
        results: [],
      }, realmOptions);
      return { testRunId, status: 'error', errorMessage };
    }

    // Find spec files in the pulled test realm.
    let specFiles = findSpecFiles(specsLocalDir, options.specPaths);
    if (specFiles.length === 0) {
      let errorMessage = 'No spec files found in the test realm';
      await completeTestRun(testRunId, {
        status: 'error',
        passedCount: 0,
        failedCount: 0,
        errorMessage,
        results: [],
      }, realmOptions);
      return { testRunId, status: 'error', errorMessage };
    }

    // Step 7: Spawn Playwright against the running realm server.
    let reportFile = join(tmpBase, 'playwright-report.json');
    let packageRoot = resolve(__dirname, '../..');
    let playwrightConfig = resolve(packageRoot, 'playwright.realm.config.ts');

    let playwrightEnv: NodeJS.ProcessEnv = {
      BOXEL_SOURCE_REALM_PATH: targetLocalDir,
      BOXEL_SOURCE_REALM_URL: startedRealm.realmURL.href,
      BOXEL_TEST_REALM_PATH: specsLocalDir,
      BOXEL_TEST_REALM_URL: startedRealm.realmURL.href,
      PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
      ...(testArtifactsRealmUrl
        ? { BOXEL_TEST_ARTIFACTS_REALM_URL: testArtifactsRealmUrl }
        : {}),
      ...(testArtifactsRunFolder
        ? { BOXEL_TEST_ARTIFACTS_RUN_FOLDER: testArtifactsRunFolder }
        : {}),
    };

    let relativeSpecFiles = specFiles.map((f) => relative(specsLocalDir, f));

    // When resuming, use --grep to only run the pending tests.
    let grepArgs: string[] = [];
    if (resolved.resumed && effectiveTestNames.length > 0) {
      // Escape regex special chars in test names and join with |
      let pattern = effectiveTestNames
        .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      grepArgs = ['--grep', pattern];
    }

    let start = Date.now();
    let testRunProcess = spawnSync(
      'npx',
      [
        'playwright',
        'test',
        '--config',
        playwrightConfig,
        '--reporter=line,json',
        ...grepArgs,
        ...relativeSpecFiles,
      ],
      {
        cwd: specsLocalDir,
        encoding: 'utf8',
        env: { ...process.env, ...playwrightEnv },
      },
    );
    let durationMs = Date.now() - start;

    // Step 8: Parse results and complete the TestRun card.
    let attrs: TestRunAttributes;
    if (existsSync(reportFile)) {
      let report = JSON.parse(readFileSync(reportFile, 'utf8')) as RunRealmTestsOutput;
      attrs = parseRunRealmTestsOutput(report, durationMs);
    } else {
      // Playwright didn't produce a report — likely crashed.
      let stderr = testRunProcess.stderr?.slice(0, 500) ?? '';
      attrs = {
        status: 'error',
        passedCount: 0,
        failedCount: 0,
        durationMs,
        errorMessage: `Playwright exited with code ${testRunProcess.status ?? 'unknown'}. ${stderr}`.trim(),
        results: [],
      };
    }

    await completeTestRun(testRunId, attrs, realmOptions);

    return {
      testRunId,
      status: attrs.status,
      ...(attrs.errorMessage ? { errorMessage: attrs.errorMessage } : {}),
    };
  } catch (err) {
    // Unexpected error — try to mark the TestRun as error.
    let errorMessage = err instanceof Error ? err.message : String(err);
    try {
      await completeTestRun(testRunId, {
        status: 'error',
        passedCount: 0,
        failedCount: 0,
        errorMessage,
        results: [],
      }, realmOptions);
    } catch {
      // Best-effort — don't mask the original error.
    }
    return { testRunId, status: 'error', errorMessage };
  } finally {
    // Step 10: Cleanup.
    try {
      await runtime?.stop();
    } catch {
      // Best-effort cleanup.
    }
    try {
      rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
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
 * Query the test realm for the most recent TestRun. If it has
 * `status: running`, return it as a resume candidate.
 */
async function findResumableTestRun(
  options: TestRunRealmOptions,
): Promise<ResumableTestRun | undefined> {
  let testRealmUrl = ensureTrailingSlash(options.testRealmUrl);

  let result = await searchRealm(
    options.testRealmUrl,
    {
      filter: {
        on: { module: options.testResultsModuleUrl, name: 'TestRun' },
      },
      sort: [{ by: 'sequenceNumber', direction: 'desc' }],
      page: { size: 1 },
    },
    { authorization: options.authorization, fetch: options.fetch },
  );

  let latest = result?.data?.[0] as {
    id?: string;
    attributes?: {
      status?: string;
      sequenceNumber?: number;
      results?: { testName?: string; status?: string }[];
    };
  } | undefined;

  if (!latest || latest.attributes?.status !== 'running') {
    return undefined;
  }

  let pendingTests = (latest.attributes.results ?? [])
    .filter((r) => r.status === 'pending')
    .map((r) => r.testName ?? '');

  let cardId = latest.id ?? '';
  let relativePath = cardId.startsWith(testRealmUrl)
    ? cardId.slice(testRealmUrl.length)
    : cardId;

  return {
    testRunId: relativePath,
    sequenceNumber: latest.attributes.sequenceNumber ?? 1,
    pendingTests,
  };
}

/**
 * Determine the next sequence number by finding the highest existing
 * sequence number and incrementing it.
 */
async function getNextSequenceNumber(
  options: TestRunRealmOptions,
): Promise<number> {
  let result = await searchRealm(
    options.testRealmUrl,
    {
      filter: {
        on: { module: options.testResultsModuleUrl, name: 'TestRun' },
      },
      sort: [{ by: 'sequenceNumber', direction: 'desc' }],
      page: { size: 1 },
    },
    { authorization: options.authorization, fetch: options.fetch },
  );

  let latest = result?.data?.[0] as
    | { attributes?: { sequenceNumber?: number } }
    | undefined;
  return (latest?.attributes?.sequenceNumber ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// Context Formatting
// ---------------------------------------------------------------------------

/**
 * Format a `TestResult` into a human-readable summary suitable for
 * inclusion in an agent prompt. The orchestrator injects this into
 * `AgentContext.testResults`, but the iteration prompt template may
 * also want a pre-formatted text block for the LLM.
 */
export function formatTestResultSummary(result: TestResult): string {
  let lines: string[] = [
    `Status: ${result.status}`,
    `Passed: ${result.passedCount}, Failed: ${result.failedCount}`,
    `Duration: ${result.durationMs}ms`,
  ];

  if (result.failures.length > 0) {
    lines.push('', 'Failures:');
    for (let failure of result.failures) {
      lines.push(`  - ${failure.testName}`);
      lines.push(`    Error: ${failure.error}`);
      if (failure.stackTrace) {
        // Indent stack trace and truncate to keep context window manageable.
        let truncated = failure.stackTrace.slice(0, 500);
        lines.push(`    Stack: ${truncated}`);
      }
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find spec files within a local directory, filtering by the requested
 * spec paths. If specPaths are relative paths like `TestSpec/hello.spec.ts`,
 * resolve them within the local dir. Falls back to finding all `.spec.ts`
 * files if no specPaths match.
 */
function findSpecFiles(localDir: string, specPaths: string[]): string[] {
  let found: string[] = [];
  for (let specPath of specPaths) {
    let fullPath = resolve(localDir, specPath);
    if (existsSync(fullPath)) {
      found.push(fullPath);
    }
  }
  return found;
}

/**
 * Split a combined error string into the message portion and an optional
 * stack trace. Playwright error output typically has the assertion or error
 * message first, then lines starting with "    at " for the stack.
 */
function splitErrorAndStack(error: string): {
  message: string;
  stackTrace?: string;
} {
  // Look for the first line that starts with whitespace followed by "at ".
  let atIndex = error.search(/\n\s+at /);
  if (atIndex === -1) {
    return { message: error.trim() };
  }

  return {
    message: error.slice(0, atIndex).trim(),
    stackTrace: error.slice(atIndex + 1).trim(),
  };
}
