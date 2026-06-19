import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { logger } from './logger.ts';

import { chromium } from '@playwright/test';

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
import { findHostDistPackageDir } from '@cardstack/realm-test-harness';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import {
  cacheKeyForInputs,
  type ValidationRunCache,
} from './validation-run-cache.ts';

let log = logger('test-run-execution');

// How long to wait for the in-browser QUnit suite to reach `runEnd` before
// giving up. A hung test page (boot error, infinite loop, never-resolving
// promise) used to block for the full 5 minutes with no signal — far longer
// than any legitimate card suite needs. Default to 60s and let an operator
// override via FACTORY_TEST_TIMEOUT_MS for an unusually heavy suite.
const DEFAULT_QUNIT_TIMEOUT_MS = 60_000;

function qunitTimeoutMs(): number {
  let raw = process.env.FACTORY_TEST_TIMEOUT_MS;
  let parsed = raw != null && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_QUNIT_TIMEOUT_MS;
}

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
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
// QUnit Test Page
// ---------------------------------------------------------------------------

/**
 * Build the HTML for a self-contained QUnit test runner page.
 *
 * Reads the host app's tests/index.html to extract the script/link tags it
 * uses (vendor.js, test-support.js, chunk files, etc.), then builds a page
 * that loads QUnit independently and injects result-collection hooks. The
 * page uses the host's compiled test bundles for Ember, test helpers, and
 * the live-test infrastructure (test-helper.js → live-test.js).
 *
 * The realmURL query param tells live-test.js which realm to discover
 * .test.gts files from.
 */
function buildQunitTestPageHtml(opts: {
  /** URL of our local server that serves static host dist assets */
  assetServerUrl: string;
  hostDistDir: string;
  targetRealm: string;
  /** Browser-accessible URL of the realm server (compat proxy) */
  realmProxyUrl: string;
  /** Optional slug identifying the issue under test — shown in the page title. */
  slug?: string;
}): string {
  let host = opts.assetServerUrl.replace(/\/$/, '');
  // Ember config URLs must use the browser-accessible realm proxy,
  // not the internal realm server port or our asset server.
  let browserOrigin = opts.realmProxyUrl.replace(/\/$/, '');

  // Read the host's test index.html to extract its script and link tags
  let testIndexPath = resolve(opts.hostDistDir, 'tests', 'index.html');
  let testIndexHtml: string;
  try {
    testIndexHtml = readFileSync(testIndexPath, 'utf8');
  } catch {
    throw new Error(
      `Could not read host test page at ${testIndexPath}. ` +
        `Ensure the host app has been built with test support.`,
    );
  }

  // Extract and rewrite meta tags. The Ember config meta tag contains
  // resolvedBaseRealmURL, resolvedSkillsRealmURL, realmServerURL, matrixURL,
  // etc. that need to point to the harness's realm server, not the URLs
  // from when the host was built.
  let metaTags = (testIndexHtml.match(/<meta[^>]+>/g) ?? [])
    .filter((tag) => !tag.includes('charset') && !tag.includes('viewport'))
    .map((tag) => {
      if (!tag.includes('config/environment')) return tag;
      // Decode the Ember config, rewrite URLs, re-encode
      let match = tag.match(/content="([^"]+)"/);
      if (!match) return tag;
      try {
        let config = JSON.parse(decodeURIComponent(match[1]));
        // Rewrite realm-related URLs to the harness's realm server
        if (config.resolvedBaseRealmURL) {
          config.resolvedBaseRealmURL = `${browserOrigin}/base/`;
        }
        if (config.resolvedSkillsRealmURL) {
          config.resolvedSkillsRealmURL = `${browserOrigin}/skills/`;
        }
        if (config.resolvedOpenRouterRealmURL) {
          config.resolvedOpenRouterRealmURL = `${browserOrigin}/openrouter/`;
        }
        if (config.realmServerURL) {
          config.realmServerURL = `${browserOrigin}/`;
        }
        if (config.matrixURL) {
          // Keep matrixURL as-is — the harness Synapse is on a random port
          // that we don't know here. Tests that need Matrix use mock-matrix.
        }
        let encoded = encodeURIComponent(JSON.stringify(config));
        return tag.replace(/content="[^"]+"/, `content="${encoded}"`);
      } catch {
        return tag;
      }
    });

  // Extract <script> and <link> tags, rewriting paths to absolute host URLs
  let scriptTags = (
    testIndexHtml.match(/<script[^>]*src="[^"]*"[^>]*><\/script>/g) ?? []
  )
    .filter(
      (tag) =>
        !tag.includes('testem.js') && !tag.includes('ember-cli-live-reload'),
    )
    .map((tag) => tag.replace(/src="\/([^"]*)"/g, `src="${host}/$1"`));

  let linkTags = (
    testIndexHtml.match(/<link[^>]*rel="stylesheet"[^>]*>/g) ?? []
  ).map((tag) => tag.replace(/href="\/([^"]*)"/g, `href="${host}/$1"`));

  let moduleScripts = (
    testIndexHtml.match(/<script type="module">[^]*?<\/script>/g) ?? []
  ).map((tag) => tag.replace(/from '\/([^']*)'/g, `from '${host}/$1'`));

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  ${metaTags.join('\n  ')}
  <title>Software Factory Card Tests${opts.slug ? ` — ${opts.slug}` : ''}</title>
  ${linkTags.join('\n  ')}
</head>
<body>
  <div id="qunit"></div>
  <div id="qunit-fixture">
    <div id="ember-testing-container">
      <div id="ember-testing"></div>
    </div>
  </div>

  <script>
    globalThis.process = { env: {}, version: '', cwd() { return '/'; } };
    // Mirror the host's tests/index.html inline shim — vite-bundled code
    // references the Node \`global\` symbol, and buildQunitTestPageHtml only
    // extracts <script src> and <script type="module"> blocks, dropping the
    // source's plain inline <script> that defines this. Without it, Ember
    // boot throws "global is not defined" and QUnit never starts.
    globalThis.global = globalThis;

    // -----------------------------------------------------------------------
    // Result collection for Playwright extraction.
    // Poll for QUnit to become available and attach hooks immediately,
    // before QUnit.start() fires. This avoids a race where the 'load'
    // event fires after QUnit has already started running tests.
    // -----------------------------------------------------------------------
    window.__qunitResults = { tests: [], runEnd: null };
    (function attachQUnitHooks() {
      if (typeof QUnit !== 'undefined') {
        QUnit.on('testEnd', function(d) {
          window.__qunitResults.tests.push({
            name: d.name, module: d.module, status: d.status,
            runtime: d.runtime,
            errors: (d.errors || []).map(function(e) {
              return { message: e.message, stack: e.stack };
            }),
          });
        });
        QUnit.on('runEnd', function(d) {
          window.__qunitResults.runEnd = d;
        });
      } else {
        setTimeout(attachQUnitHooks, 10);
      }
    })();

    // liveTest and realmURL params are passed directly in the page URL
    // so test-helper.js sees them when it checks window.location.search.
  </script>

  ${moduleScripts.join('\n  ')}

  <!-- Host app scripts (vendor, test-support, app, test chunks) -->
  ${scriptTags.join('\n  ')}
</body>
</html>`;
}

/**
 * Start a minimal HTTP server that serves:
 * - / → our custom QUnit test page HTML
 * - /assets/* → static files from the host's dist/assets/ directory
 *
 * Returns the server URL and a setter to update the HTML content
 * (needed because the HTML references the server's own URL for assets).
 */
async function startTestPageServer(
  hostDistDir: string,
): Promise<{ url: string; server: Server; setHtml: (h: string) => void }> {
  let mimeTypes: Record<string, string> = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.map': 'application/json',
    '.html': 'text/html',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
  };

  let html = '';
  let setHtml = (h: string) => {
    html = h;
  };

  return new Promise((res, rej) => {
    let server = createServer((req, reply) => {
      let url = (req.url ?? '/').split('?')[0];

      // Serve static files from host dist (assets, wasm, fonts, etc.)
      if (url !== '/') {
        let normalized = normalize(url.slice(1));
        // Reject path traversal attempts (e.g., /../package.json)
        if (normalized.startsWith('..') || normalized.startsWith('/')) {
          reply.writeHead(403);
          reply.end('Forbidden');
          return;
        }
        let filePath = resolve(hostDistDir, normalized);
        if (!filePath.startsWith(resolve(hostDistDir))) {
          reply.writeHead(403);
          reply.end('Forbidden');
          return;
        }
        try {
          let content = readFileSync(filePath);
          let ext = filePath.match(/\.[^.]+$/)?.[0] ?? '';
          let contentType = mimeTypes[ext] ?? 'application/octet-stream';
          reply.writeHead(200, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
          });
          reply.end(content);
        } catch {
          reply.writeHead(404);
          reply.end('Not found');
        }
        return;
      }

      // Default: serve the test page HTML
      reply.writeHead(200, {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': '*',
      });
      reply.end(html);
    });
    server.on('error', rej);
    server.listen(0, '127.0.0.1', () => {
      let addr = server.address();
      if (!addr || typeof addr === 'string') {
        rej(new Error('Failed to start test page server'));
        return;
      }
      res({ url: `http://127.0.0.1:${addr.port}`, server, setHtml });
    });
  });
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
  /** Optional slug shown in the served test page title. */
  slug?: string;
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
  let start = Date.now();
  let browser;
  let testPageServer: Server | undefined;

  try {
    // Locate the host app's dist directory — contains tests/index.html and assets.
    // In worktrees, the local host/dist may not exist; fall back to the root
    // repo checkout's host dist (same logic as the harness support services).
    let hostDistDir =
      options.hostDistDir ??
      join(
        findHostDistPackageDir() ?? resolve(__dirname, '../../host'),
        'dist',
      );

    // Start a local server to serve both the test HTML page and the host's
    // dist assets. All asset references point to our server, so no external
    // host app is needed — fully hermetic.
    let {
      url: testPageUrl,
      server,
      setHtml,
    } = await startTestPageServer(hostDistDir);
    testPageServer = server;

    // Build HTML using our server URL for asset references.
    // realmProxyUrl = hostAppUrl = the compat proxy that the browser can reach.
    let html = buildQunitTestPageHtml({
      assetServerUrl: testPageUrl,
      hostDistDir,
      targetRealm: options.targetRealm,
      realmProxyUrl: options.hostAppUrl,
      slug: options.slug,
    });
    setHtml(html);

    log.debug(
      `Serving QUnit page at ${testPageUrl} for realm ${options.targetRealm}`,
    );

    browser = await chromium.launch({ headless: true });
    let page = await browser.newPage();

    if (options.debug) {
      page.on('console', (msg) => {
        log.debug(`[browser] ${msg.type()}: ${msg.text()}`);
      });
      page.on('pageerror', (err) => {
        log.debug(`[browser] PAGE ERROR: ${err.message}`);
      });
    }

    // Intercept requests to the target realm and inject the Authorization
    // header. live-test.js fetches _mtimes and modules without auth, but
    // private realms require it. Using page.route() injects auth at the
    // network level before any page scripts run.
    let realmParam = encodeURIComponent(options.targetRealm);
    let pageUrl = `${testPageUrl}?liveTest=true&realmURL=${realmParam}&hidepassed`;

    let realmToken = await options.client.getRealmToken(options.targetRealm);
    if (realmToken) {
      let realmOrigin = new URL(options.targetRealm).origin;
      await page.route(`${realmOrigin}/**`, (route) => {
        let headers = {
          ...route.request().headers(),
          Authorization: realmToken,
        };
        route.continue({ headers });
      });
    }

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });

    // Wait for QUnit to finish (results collected via inline script hooks).
    // Note: waitForFunction(fn, arg, options) — pass null as arg so the
    // timeout option is correctly in the third position.
    let timeoutMs = qunitTimeoutMs();
    let waitStart = Date.now();
    try {
      await page.waitForFunction(
        () => (window as any).__qunitResults?.runEnd !== null,
        null,
        { timeout: timeoutMs },
      );
    } catch (err) {
      // Only rewrite Playwright's timeout — its native message ("Timeout
      // 60000ms exceeded") doesn't say what timed out or how long we waited.
      // Any other error (execution context destroyed, page crash, etc.) is a
      // genuine failure and must surface unchanged, not be masked as a timeout.
      if (!(err instanceof Error && err.name === 'TimeoutError')) {
        throw err;
      }
      // Measure the wait itself, not the whole run (which includes server +
      // browser startup and page navigation before we began waiting).
      let waited = Date.now() - waitStart;
      throw new Error(
        `QUnit suite did not reach runEnd within ${timeoutMs}ms (waited ${waited}ms). ` +
          `The page never set __qunitResults.runEnd — likely an Ember boot error, ` +
          `a hanging test, or a never-resolving promise. Re-run with --debug to see ` +
          `browser console output, or raise FACTORY_TEST_TIMEOUT_MS for a heavier suite.`,
      );
    }

    let qunitResults: QunitResults = await page.evaluate(
      () => (window as any).__qunitResults,
    );

    let durationMs = Date.now() - start;
    // Debug-gated like the rest of the observability output, so a normal run
    // stays clean (the timing summary surfaces this duration under --debug).
    log.debug(
      `QUnit completed in ${fmtMs(durationMs)}: ${qunitResults.runEnd?.testCounts?.total ?? 0} test(s)`,
    );

    return { qunitResults, durationMs };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (testPageServer) {
      testPageServer.close();
    }
  }
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
      slug: options.slug,
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
