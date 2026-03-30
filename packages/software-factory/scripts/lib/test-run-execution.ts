import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  cancelAllIndexingJobs,
  createRealm,
  ensureTrailingSlash,
  getRealmScopedAuth,
  pullRealmFiles,
  readCardSource,
  searchRealm,
  writeCardSource,
} from './realm-operations';
import { createTestRun, completeTestRun } from './test-run-cards';
import { parseRunRealmTestsOutput } from './test-run-parsing';
import type {
  ExecuteTestRunOptions,
  RunRealmTestsOutput,
  TestRunAttributes,
  TestRunHandle,
  TestRunRealmOptions,
} from './test-run-types';

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
    serverToken?: string;
    fetch?: typeof globalThis.fetch;
    realmServerUrl: string;
    targetRealmUrl: string;
    matrixAuth: {
      userId: string;
      accessToken: string;
      matrixUrl: string;
    };
  },
): Promise<{
  testArtifactsRealmUrl: string;
  created: boolean;
  error?: string;
}> {
  let fetchOptions = {
    authorization: options.authorization,
    fetch: options.fetch,
  };

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

  // Derive the test artifacts realm name from the target realm endpoint.
  // e.g. target realm "smoke-test-10" → artifacts realm "smoke-test-10-test-artifacts"
  let targetSegments = new URL(options.targetRealmUrl).pathname
    .split('/')
    .filter(Boolean);
  let targetEndpoint = targetSegments.at(-1) ?? 'project';
  let realmName = `${targetEndpoint} Test Artifacts`;
  let endpoint = `${targetEndpoint}-test-artifacts`;

  let testArtifactsRealmUrl = '';
  let created = false;

  for (let attempt = 0; attempt < 5; attempt++) {
    let tryEndpoint = attempt === 0 ? endpoint : `${endpoint}-${attempt + 1}`;
    let result = await createRealm(options.realmServerUrl, {
      name: realmName,
      endpoint: tryEndpoint,
      authorization: options.serverToken ?? options.authorization ?? '',
      fetch: options.fetch,
      matrixAuth: options.matrixAuth,
    });

    if (result.created) {
      testArtifactsRealmUrl = result.realmUrl;
      created = true;
      break;
    }

    // 400 "already exists" → extract the existing realm URL from the error
    // message and use it. The error format is:
    // "realm 'http://.../{username}/{endpoint}/' already exists on this server"
    if (result.error?.includes('already exists')) {
      let urlMatch = result.error.match(/'(https?:\/\/[^']+)'/);
      if (urlMatch) {
        testArtifactsRealmUrl = urlMatch[1];
        created = false;
        break;
      }
      continue;
    }

    return {
      testArtifactsRealmUrl: '',
      created: false,
      error: `Failed to create test artifacts realm: ${result.error}`,
    };
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
  let writeResult = await writeCardSource(
    realmUrl,
    `${cardPath}.json`,
    readResult.document,
    fetchOptions,
  );
  if (!writeResult.ok) {
    return {
      testArtifactsRealmUrl: '',
      created: false,
      error: `Failed to persist testArtifactsRealmUrl to Project card: ${writeResult.error}`,
    };
  }

  return { testArtifactsRealmUrl, created };
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

  let createResult = await createTestRun(options.slug, options.testNames, {
    ...realmOptions,
    sequenceNumber,
    ticketURL: options.ticketURL,
    projectCardUrl: options.projectCardUrl,
    specRef: options.specRef,
  });

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

  let latest = result?.data?.[0] as
    | {
        id?: string;
        attributes?: {
          status?: string;
          sequenceNumber?: number;
          results?: { testName?: string; status?: string }[];
        };
      }
    | undefined;

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
// Test Execution Orchestration
// ---------------------------------------------------------------------------

/**
 * Orchestrate a full test run: create TestRun card → pull realm → start
 * harness → run Playwright → update results → cleanup → return handle.
 */
export async function executeTestRunFromRealm(
  options: ExecuteTestRunOptions,
): Promise<TestRunHandle> {
  let realmOptions: TestRunRealmOptions = {
    testRealmUrl: options.targetRealmUrl,
    testResultsModuleUrl: options.testResultsModuleUrl,
    authorization: options.authorization,
    fetch: options.fetch,
  };
  let completeOptions = {
    ...realmOptions,
    projectCardUrl: options.projectCardUrl,
  };

  // Step 1-2: Resolve or create the TestRun card.
  let resolved = await resolveTestRun(options);
  if (resolved.status === 'error') {
    return resolved;
  }
  let testRunId = resolved.testRunId;

  let effectiveTestNames = resolved.pendingTests?.length
    ? resolved.pendingTests
    : options.testNames;

  // Step 2a: Ensure test artifacts realm exists (if projectCardUrl provided).
  let testArtifactsRealmUrl = options.testRealmUrl;
  let testArtifactsAuthorization = options.authorization;
  if (options.projectCardUrl && options.matrixAuth) {
    let realmServerUrl = ensureTrailingSlash(
      new URL(options.targetRealmUrl).origin + '/',
    );
    let ensureResult = await ensureTestArtifactsRealm(options.projectCardUrl, {
      authorization: options.authorization,
      serverToken: options.serverToken,
      fetch: options.fetch,
      realmServerUrl,
      targetRealmUrl: options.targetRealmUrl,
      matrixAuth: options.matrixAuth,
    });
    if (ensureResult.error) {
      return {
        testRunId,
        status: 'error',
        errorMessage: `Failed to ensure test artifacts realm: ${ensureResult.error}`,
      };
    }
    testArtifactsRealmUrl = ensureResult.testArtifactsRealmUrl;

    // Get a realm-scoped token for the test artifacts realm so specs can
    // write card instances to it.
    if (testArtifactsRealmUrl && options.serverToken) {
      let authResult = await getRealmScopedAuth(
        realmServerUrl,
        options.serverToken,
        { fetch: options.fetch },
      );
      let artifactsToken =
        authResult.tokens[ensureTrailingSlash(testArtifactsRealmUrl)];
      if (artifactsToken) {
        testArtifactsAuthorization = artifactsToken;
      }
    }
  }

  // Step 2b: Cancel all indexing jobs on the test artifacts realm.
  if (testArtifactsRealmUrl) {
    await cancelAllIndexingJobs(testArtifactsRealmUrl, {
      authorization: testArtifactsAuthorization,
      fetch: options.fetch,
    });
  }

  // Step 2c: Determine the Run folder path for test artifacts.
  let seqMatch = testRunId.match(/-(\d+)$/);
  let runSeq = seqMatch ? seqMatch[1] : '1';
  let testArtifactsRunFolder = testArtifactsRealmUrl
    ? `Run ${runSeq}/`
    : undefined;

  // Step 3: Pull only spec files from the target realm to a local temp dir.
  // Playwright needs local .spec.ts files to run, but tests execute against
  // the LIVE target realm URL — no local harness startup needed.
  let tmpBase = mkdtempSync(join(tmpdir(), 'sf-test-run-'));
  let specsLocalDir = join(tmpBase, 'specs');
  mkdirSync(specsLocalDir, { recursive: true });

  try {
    let pullResult = await pullRealmFiles(
      options.targetRealmUrl,
      specsLocalDir,
      { authorization: options.authorization, fetch: options.fetch },
    );
    if (pullResult.error) {
      let errorMessage = `Failed to pull spec files: ${pullResult.error}`;
      await completeTestRun(
        testRunId,
        {
          status: 'error',
          passedCount: 0,
          failedCount: 0,
          errorMessage,
          results: [],
        },
        completeOptions,
      );
      return { testRunId, status: 'error', errorMessage };
    }

    // Step 4: Find spec files in the pulled directory.
    let specFiles = findSpecFiles(specsLocalDir, options.specPaths);
    if (specFiles.length === 0) {
      let errorMessage = 'No spec files found in the target realm';
      await completeTestRun(
        testRunId,
        {
          status: 'error',
          passedCount: 0,
          failedCount: 0,
          errorMessage,
          results: [],
        },
        completeOptions,
      );
      return { testRunId, status: 'error', errorMessage };
    }

    // Step 5: Run Playwright against the LIVE target realm.
    // No local harness — specs execute against the running realm server.
    // Test artifacts (instances created during tests) go to the test artifacts realm.
    let reportFile = join(tmpBase, 'playwright-report.json');
    let packageRoot = resolve(__dirname, '../..');
    let playwrightConfig = resolve(packageRoot, 'playwright.realm.config.ts');

    // Build the full test artifacts folder URL: realm URL + Run folder.
    // Specs write instances to this URL — each test run gets its own folder.
    let testArtifactsFolderUrl =
      testArtifactsRealmUrl && testArtifactsRunFolder
        ? new URL(
            testArtifactsRunFolder,
            ensureTrailingSlash(testArtifactsRealmUrl),
          ).href
        : undefined;

    let playwrightEnv: NodeJS.ProcessEnv = {
      PLAYWRIGHT_TEST_DIR: specsLocalDir,
      BOXEL_SOURCE_REALM_URL: options.targetRealmUrl,
      BOXEL_SOURCE_REALM_PATH: specsLocalDir,
      BOXEL_TEST_REALM_PATH: specsLocalDir,
      BOXEL_TEST_REALM_URL: options.targetRealmUrl,
      PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
      ...(testArtifactsFolderUrl
        ? { BOXEL_TEST_ARTIFACTS_FOLDER_URL: testArtifactsFolderUrl }
        : {}),
      ...(testArtifactsAuthorization
        ? { BOXEL_TEST_ARTIFACTS_AUTHORIZATION: testArtifactsAuthorization }
        : {}),
    };

    let grepArgs: string[] = [];
    if (resolved.resumed && effectiveTestNames.length > 0) {
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
        ...specFiles,
      ],
      {
        // Run from the package root so spec files can resolve
        // @playwright/test and other dependencies from node_modules.
        cwd: packageRoot,
        encoding: 'utf8',
        env: { ...process.env, ...playwrightEnv },
      },
    );
    let durationMs = Date.now() - start;

    // Step 6: Parse results and complete the TestRun card.
    let attrs: TestRunAttributes;
    if (existsSync(reportFile)) {
      let report = JSON.parse(
        readFileSync(reportFile, 'utf8'),
      ) as RunRealmTestsOutput;
      attrs = parseRunRealmTestsOutput(report, durationMs);
    } else {
      let stderr = testRunProcess.stderr?.slice(0, 500) ?? '';
      attrs = {
        status: 'error',
        passedCount: 0,
        failedCount: 0,
        durationMs,
        errorMessage:
          `Playwright exited with code ${testRunProcess.status ?? 'unknown'}. ${stderr}`.trim(),
        results: [],
      };
    }

    let completeResult = await completeTestRun(
      testRunId,
      attrs,
      completeOptions,
    );

    return {
      testRunId,
      status: attrs.status,
      ...(attrs.errorMessage ? { errorMessage: attrs.errorMessage } : {}),
      ...(completeResult.error ? { error: completeResult.error } : {}),
    };
  } catch (err) {
    let errorMessage = err instanceof Error ? err.message : String(err);
    try {
      await completeTestRun(
        testRunId,
        {
          status: 'error',
          passedCount: 0,
          failedCount: 0,
          errorMessage,
          results: [],
        },
        completeOptions,
      );
    } catch {
      // Best-effort
    }
    return { testRunId, status: 'error', errorMessage };
  } finally {
    try {
      rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      // Best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find spec files within a local directory by matching the requested
 * spec paths. Returns only paths that exist on disk.
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
