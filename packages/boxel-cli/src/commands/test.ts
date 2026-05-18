import type { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join, normalize, resolve } from 'node:path';

import { chromium } from '@playwright/test';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import {
  getProfileManager,
  NO_ACTIVE_PROFILE_ERROR,
  type ProfileManager,
} from '../lib/profile-manager';
import { FG_RED, FG_GREEN, DIM, RESET } from '../lib/colors';
import { cliLog } from '../lib/cli-log';
import { findBoxelCliRoot } from '../lib/find-package-root';
import { listFiles } from './file/list';

/**
 * `boxel test` runs the realm's QUnit test suite by driving a
 * headless Chromium instance against the host app's compiled test
 * bundle. Lifted from
 * `packages/software-factory/src/test-run-execution.ts` (the
 * `runTestsInMemory` path) during CS-11149 so the same engine is
 * reachable from a subscription-billed Claude Code session via Bash.
 *
 * Like `boxel parse`, this is a monorepo-only command — it locates
 * the host app's `dist/` (test bundles + assets) via either
 * `TEST_HARNESS_HOST_DIST_PACKAGE_DIR`, the sibling `packages/host`
 * directory, or the root repo's `packages/host` directory when run
 * from a git worktree. It does not work in the published CLI.
 *
 * Unlike the factory's `executeTestRunFromRealm`, this command does
 * NOT create or update a TestRun card — it returns in-memory results
 * only. Card persistence is the agent's job in the new Phase 1 flow.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QunitTestResult {
  name: string;
  module: string;
  status: 'passed' | 'failed' | 'skipped' | 'todo';
  runtime: number;
  errors: { message: string; stack?: string }[];
}

interface QunitRunSummary {
  status: 'passed' | 'failed';
  testCounts: {
    passed: number;
    failed: number;
    skipped: number;
    todo: number;
    total: number;
  };
  runtime: number;
}

interface QunitResults {
  tests: QunitTestResult[];
  runEnd: QunitRunSummary | null;
}

export interface TestFailure {
  testName: string;
  module: string;
  message: string;
  stackTrace?: string;
}

export interface RunTestsResult {
  status: 'passed' | 'failed' | 'error';
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  durationMs: number;
  /** Realm-relative `.test.gts` paths discovered before the run. */
  testFiles: string[];
  failures: TestFailure[];
  /** Set only when `status === 'error'`. */
  errorMessage?: string;
}

export interface RunTestsOptions {
  /**
   * URL of the host app served by the realm-server compat proxy.
   * Defaults to the realm server URL from the active profile, which
   * is what the dev `mise run dev-all` stack exposes.
   */
  hostAppUrl?: string;
  /** Path to the host app's dist directory; auto-discovered otherwise. */
  hostDistDir?: string;
  /** Stream browser console output to stderr for debugging. */
  debug?: boolean;
  profileManager?: ProfileManager;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runTestsForRealm(
  realmUrl: string,
  options?: RunTestsOptions,
): Promise<RunTestsResult> {
  let pm = options?.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    return emptyErrorResult(NO_ACTIVE_PROFILE_ERROR);
  }

  let normalizedRealmUrl = ensureTrailingSlash(realmUrl);
  let hostAppUrl = ensureTrailingSlash(
    options?.hostAppUrl ?? active.profile.realmServerUrl,
  );

  let testFiles: string[];
  try {
    let listing = await listFiles(normalizedRealmUrl, { profileManager: pm });
    if (listing.error) {
      return emptyErrorResult(
        `Failed to discover test files: ${listing.error}`,
      );
    }
    testFiles = listing.filenames.filter((f) => f.endsWith('.test.gts'));
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
      pm,
      targetRealm: normalizedRealmUrl,
      hostAppUrl,
      hostDistDir: options?.hostDistDir,
      debug: options?.debug,
    });

    let summary = summarizeQunitResults(qunitResults);
    return {
      ...summary,
      durationMs,
      testFiles,
    };
  } catch (err) {
    let errorMessage = err instanceof Error ? err.message : String(err);
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

// ---------------------------------------------------------------------------
// QUnit Runner
// ---------------------------------------------------------------------------

interface QunitRunnerOptions {
  pm: ProfileManager;
  targetRealm: string;
  hostAppUrl: string;
  hostDistDir?: string;
  debug?: boolean;
}

async function runQunitInBrowser(options: QunitRunnerOptions): Promise<{
  qunitResults: QunitResults;
  durationMs: number;
}> {
  let start = Date.now();
  let browser;
  let testPageServer: Server | undefined;

  try {
    let hostDistDir =
      options.hostDistDir ??
      join(
        findHostDistPackageDir() ??
          join(resolve(findBoxelCliRoot(__dirname), '..'), 'host'),
        'dist',
      );

    if (!fileExists(join(hostDistDir, 'tests', 'index.html'))) {
      throw new Error(
        `Host app dist not found at ${hostDistDir}. Build the host app (e.g., \`pnpm --filter @cardstack/host build\`) or set TEST_HARNESS_HOST_DIST_PACKAGE_DIR.`,
      );
    }

    let {
      url: testPageUrl,
      server,
      setHtml,
    } = await startTestPageServer(hostDistDir);
    testPageServer = server;

    let html = buildQunitTestPageHtml({
      assetServerUrl: testPageUrl,
      hostDistDir,
      realmProxyUrl: options.hostAppUrl,
    });
    setHtml(html);

    browser = await chromium.launch({ headless: true });
    let page = await browser.newPage();

    if (options.debug) {
      page.on('console', (msg) => {
        process.stderr.write(`[browser ${msg.type()}] ${msg.text()}\n`);
      });
      page.on('pageerror', (err) => {
        process.stderr.write(`[browser pageerror] ${err.message}\n`);
      });
    }

    let realmToken = options.pm.getRealmToken(options.targetRealm);
    if (realmToken) {
      let realmOrigin = new URL(options.targetRealm).origin;
      await page.route(`${realmOrigin}/**`, (route) => {
        let headers = {
          ...route.request().headers(),
          Authorization: realmToken!,
        };
        route.continue({ headers });
      });
    }

    let realmParam = encodeURIComponent(options.targetRealm);
    let pageUrl = `${testPageUrl}?liveTest=true&realmURL=${realmParam}&hidepassed`;

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        (window as unknown as { __qunitResults?: { runEnd: unknown } })
          .__qunitResults?.runEnd !== null,
      null,
      { timeout: 300_000 },
    );

    let qunitResults = (await page.evaluate(
      () =>
        (window as unknown as { __qunitResults: QunitResults }).__qunitResults,
    )) as QunitResults;

    return { qunitResults, durationMs: Date.now() - start };
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
// Test page HTML + asset server
// ---------------------------------------------------------------------------

function buildQunitTestPageHtml(opts: {
  assetServerUrl: string;
  hostDistDir: string;
  realmProxyUrl: string;
}): string {
  let host = opts.assetServerUrl.replace(/\/$/, '');
  let browserOrigin = opts.realmProxyUrl.replace(/\/$/, '');

  let testIndexPath = resolve(opts.hostDistDir, 'tests', 'index.html');
  let testIndexHtml: string;
  try {
    testIndexHtml = readFileSync(testIndexPath, 'utf8');
  } catch {
    throw new Error(
      `Could not read host test page at ${testIndexPath}. Build the host app with test support.`,
    );
  }

  let metaTags = (testIndexHtml.match(/<meta[^>]+>/g) ?? [])
    .filter((tag) => !tag.includes('charset') && !tag.includes('viewport'))
    .map((tag) => {
      if (!tag.includes('config/environment')) return tag;
      let match = tag.match(/content="([^"]+)"/);
      if (!match) return tag;
      try {
        let config = JSON.parse(decodeURIComponent(match[1]));
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
        let encoded = encodeURIComponent(JSON.stringify(config));
        return tag.replace(/content="[^"]+"/, `content="${encoded}"`);
      } catch {
        return tag;
      }
    });

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
  <title>Boxel realm tests</title>
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
    globalThis.global = globalThis;

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
  </script>

  ${moduleScripts.join('\n  ')}
  ${scriptTags.join('\n  ')}
</body>
</html>`;
}

async function startTestPageServer(hostDistDir: string): Promise<{
  url: string;
  server: Server;
  setHtml: (h: string) => void;
}> {
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

      if (url !== '/') {
        let normalized = normalize(url.slice(1));
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
// Host dist discovery — inlined from @cardstack/realm-test-harness
// ---------------------------------------------------------------------------

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function findHostDistPackageDir(): string | undefined {
  let packageRoot = findBoxelCliRoot(__dirname);
  let packagesDir = resolve(packageRoot, '..');
  let workspaceRoot = resolve(packagesDir, '..');
  let hostDir = join(packagesDir, 'host');

  let rootRepoCheckoutDir = findRootRepoCheckoutDir(workspaceRoot);
  let rootRepoHostDir =
    rootRepoCheckoutDir && rootRepoCheckoutDir !== workspaceRoot
      ? resolve(rootRepoCheckoutDir, 'packages', 'host')
      : undefined;

  let candidates = [
    process.env.TEST_HARNESS_HOST_DIST_PACKAGE_DIR,
    hostDir,
    rootRepoHostDir,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => resolve(value));

  let seen = new Set<string>();
  for (let candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (fileExists(join(candidate, 'dist', 'index.html'))) {
      return candidate;
    }
  }
  return undefined;
}

function findRootRepoCheckoutDir(workspaceRoot: string): string | undefined {
  let result = spawnSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  if (result.status !== 0) return undefined;
  let commonDir = result.stdout.trim();
  if (!commonDir.endsWith(`${join('.git')}`)) return undefined;
  return dirname(commonDir);
}

// ---------------------------------------------------------------------------
// QUnit result summarization
// ---------------------------------------------------------------------------

interface QunitSummary {
  status: 'passed' | 'failed' | 'error';
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  failures: TestFailure[];
  errorMessage?: string;
}

function summarizeQunitResults(results: QunitResults): QunitSummary {
  if (!results.runEnd) {
    return {
      status: 'error',
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      failures: [],
      errorMessage: 'QUnit did not complete — runEnd event was not received',
    };
  }

  let passedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let failures: TestFailure[] = [];

  for (let test of results.tests) {
    if (test.status === 'failed') {
      failedCount += 1;
      let firstError = test.errors[0];
      failures.push({
        testName: test.name,
        module: test.module || 'default',
        message: firstError?.message ?? 'Test failed',
        ...(firstError?.stack
          ? { stackTrace: firstError.stack.slice(0, 500) }
          : {}),
      });
    } else if (test.status === 'skipped' || test.status === 'todo') {
      skippedCount += 1;
    } else {
      passedCount += 1;
    }
  }

  let status: QunitSummary['status'];
  if (results.tests.length === 0) {
    status = 'error';
  } else if (failedCount > 0) {
    status = 'failed';
  } else if (passedCount === 0 && skippedCount > 0) {
    status = 'failed';
  } else {
    status = 'passed';
  }

  return { status, passedCount, failedCount, skippedCount, failures };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyErrorResult(message: string): RunTestsResult {
  return {
    status: 'error',
    passedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    durationMs: 0,
    testFiles: [],
    failures: [],
    errorMessage: message,
  };
}

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

interface TestCliOptions {
  realm: string;
  hostAppUrl?: string;
  hostDistDir?: string;
  debug?: boolean;
  json?: boolean;
}

export function registerTestCommand(program: Command): void {
  program
    .command('test')
    .description(
      "Run the realm's QUnit test suite (every `*.test.gts` file) in a headless Chromium driven against the host app. Monorepo-only: relies on the host app's compiled `dist/` being reachable from this CLI's location (or via TEST_HARNESS_HOST_DIST_PACKAGE_DIR).",
    )
    .requiredOption('--realm <realm-url>', 'The realm URL to test')
    .option(
      '--host-app-url <url>',
      "Host app URL (compat proxy). Defaults to the active profile's realm-server URL.",
    )
    .option(
      '--host-dist-dir <path>',
      'Override the host app dist directory used to build the test page.',
    )
    .option('--debug', 'Stream browser console output to stderr')
    .option('--json', 'Output structured JSON result')
    .action(async (opts: TestCliOptions) => {
      let result: RunTestsResult;
      try {
        result = await runTestsForRealm(opts.realm, {
          ...(opts.hostAppUrl ? { hostAppUrl: opts.hostAppUrl } : {}),
          ...(opts.hostDistDir ? { hostDistDir: opts.hostDistDir } : {}),
          ...(opts.debug ? { debug: true } : {}),
        });
      } catch (err) {
        console.error(
          `${FG_RED}Error:${RESET} ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }

      if (opts.json) {
        cliLog.output(JSON.stringify(result, null, 2));
        if (result.status !== 'passed') {
          process.exit(1);
        }
        return;
      }

      if (result.errorMessage) {
        console.error(`${FG_RED}Error:${RESET} ${result.errorMessage}`);
      }

      if (result.testFiles.length === 0) {
        console.log(`${DIM}No .test.gts files found in the realm.${RESET}`);
        return;
      }

      if (result.failures.length > 0) {
        for (let f of result.failures) {
          console.log(
            `\n${FG_RED}FAIL${RESET} ${DIM}${f.module}${RESET} › ${f.testName}`,
          );
          console.log(`  ${f.message}`);
          if (f.stackTrace) {
            console.log(
              `  ${DIM}${f.stackTrace.split('\n').slice(0, 3).join('\n  ')}${RESET}`,
            );
          }
        }
      }

      let statusColor =
        result.status === 'passed'
          ? FG_GREEN
          : result.status === 'failed'
            ? FG_RED
            : FG_RED;
      console.log(
        `\n${statusColor}${result.status}${RESET} ${DIM}—${RESET} ${result.passedCount} passed, ${result.failedCount} failed${result.skippedCount > 0 ? `, ${result.skippedCount} skipped` : ''} ${DIM}(${result.durationMs}ms across ${result.testFiles.length} file(s))${RESET}`,
      );

      if (result.status !== 'passed') {
        process.exit(1);
      }
    });
}
