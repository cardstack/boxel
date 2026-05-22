import type { Command } from 'commander';
import { readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, normalize, resolve } from 'node:path';

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
import { readdirSync } from 'node:fs';
import { sep } from 'node:path';
import { transpileJS } from '@cardstack/runtime-common/transpile';
import {
  describeSource,
  resolveHostTestHarness,
} from '../lib/host-test-harness-fetcher';

// `@playwright/test` ships as a runtime dependency (it has to, since
// `boxel test` drives chromium) but it's marked external in our
// esbuild config — it bundles native binaries that esbuild can't
// inline. Lazy-importing it here keeps `boxel --help` and the other
// commands fast for users who never run `boxel test`, and keeps the
// top-level import graph free of the playwright dependency surface.
type ChromiumApi = (typeof import('@playwright/test'))['chromium'];

async function loadChromium(): Promise<ChromiumApi> {
  try {
    let mod = (await import('@playwright/test')) as {
      chromium: ChromiumApi;
    };
    return mod.chromium;
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not load @playwright/test (${message}). Reinstall ` +
        '`@cardstack/boxel-cli` (Playwright ships as a runtime ' +
        'dependency) and run `npx playwright install chromium` once ' +
        'to fetch the browser binary.',
    );
  }
}

/**
 * `boxel test` runs the realm's QUnit test suite by driving a
 * headless Chromium instance against the host app's compiled test
 * bundle. Lifted from
 * `packages/software-factory/src/test-run-execution.ts` (the
 * `runTestsInMemory` path) during CS-11149 so the same engine is
 * reachable from a subscription-billed Claude Code session via Bash.
 *
 * The host test harness is resolved at runtime by
 * `resolveHostTestHarness` (see `../lib/host-test-harness-fetcher.ts`):
 * monorepo dev uses the sibling `packages/host/dist/` directly,
 * published-install users download the pinned harness from a GH
 * release on first `boxel test` and cache it under
 * `~/.cache/boxel-cli/host-test-harness/<version>/`. Override with
 * `--host-dist-dir` or `BOXEL_TEST_HARNESS_DIR`.
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
  /** Force the harness fetcher to re-download. */
  refreshHarness?: boolean;
  /** Sideload a harness tarball from disk instead of downloading. */
  offlineTarball?: string;
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
    // A realm with no `*.test.gts` files is treated as a validator
    // failure: factory Issues are supposed to ship with tests, and a
    // silent "passed" would let an agent mark an Issue done without
    // ever writing one.
    return {
      status: 'failed',
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 0,
      testFiles: [],
      failures: [],
      errorMessage:
        'No `*.test.gts` files found in the realm. ' +
        'Every implementation Issue must ship with at least one test file.',
    };
  }

  try {
    let { qunitResults, durationMs } = await runQunitInBrowser({
      pm,
      targetRealm: normalizedRealmUrl,
      hostAppUrl,
      hostDistDir: options?.hostDistDir,
      refreshHarness: options?.refreshHarness,
      offlineTarball: options?.offlineTarball,
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
// Local-mode entry point (default; no realm-server required)
// ---------------------------------------------------------------------------

export interface RunTestsLocallyOptions {
  workspaceDir: string;
  hostDistDir?: string;
  /** Force the harness fetcher to re-download. */
  refreshHarness?: boolean;
  /** Sideload a harness tarball from disk instead of downloading. */
  offlineTarball?: string;
  debug?: boolean;
  /** Override the bundled-realms root for tests; defaults to the CLI's vendored copy. */
  bundledRealmsDir?: string;
}

export async function runTestsLocally(
  options: RunTestsLocallyOptions,
): Promise<RunTestsResult> {
  let workspaceDir = resolve(options.workspaceDir);
  let testFiles = walkTestFiles(workspaceDir);

  if (testFiles.length === 0) {
    return {
      status: 'failed',
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 0,
      testFiles: [],
      failures: [],
      errorMessage:
        `No \`*.test.gts\` files found in ${workspaceDir}. ` +
        'Every implementation Issue must ship with at least one test file.',
    };
  }

  let { baseDir, skillsDir } = resolveBundledRealms(options.bundledRealmsDir);

  try {
    let { qunitResults, durationMs } = await runQunitInBrowser({
      pm: getProfileManager(),
      // Placeholder URLs — the runner replaces these with the real
      // origin/realm once the merged test-page server is listening,
      // because targetRealm and hostAppUrl have to share that origin
      // for the workspace mount to be reachable from the test page.
      targetRealm: '__local__:workspace',
      hostAppUrl: '__local__:',
      hostDistDir: options.hostDistDir,
      refreshHarness: options.refreshHarness,
      offlineTarball: options.offlineTarball,
      debug: options.debug,
      realmMounts: [
        { prefix: 'workspace', root: workspaceDir },
        { prefix: 'base', root: baseDir },
        { prefix: 'skills', root: skillsDir },
      ],
    });

    let summary = summarizeQunitResults(qunitResults);
    return {
      ...summary,
      durationMs,
      testFiles,
    };
  } catch (err) {
    return {
      status: 'error',
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 0,
      testFiles,
      failures: [],
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function walkTestFiles(workspaceDir: string): string[] {
  let results: string[] = [];
  let walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (let entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      let full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.test.gts')) {
        results.push(full.slice(workspaceDir.length + 1));
      }
    }
  };
  walk(workspaceDir);
  return results.sort();
}

function resolveBundledRealms(override: string | undefined): {
  baseDir: string;
  skillsDir: string;
} {
  // Explicit override (tests): expect a directory containing `base/` and
  // `skills/` subdirs.
  if (override) {
    return {
      baseDir: join(override, 'base'),
      skillsDir: join(override, 'skills'),
    };
  }
  let cliRoot = findBoxelCliRoot(__dirname);
  let bundled = join(cliRoot, 'bundled-realms');
  if (dirExists(join(bundled, 'base'))) {
    return {
      baseDir: join(bundled, 'base'),
      skillsDir: join(bundled, 'skills'),
    };
  }
  // Monorepo dev fallback: read from sibling packages directly so
  // local-mode `boxel test` works before `pnpm build` populates
  // `bundled-realms/`.
  let packagesDir = resolve(cliRoot, '..');
  let baseDir = join(packagesDir, 'base');
  let skillsDir = join(packagesDir, 'skills-realm', 'contents');
  if (!dirExists(baseDir)) {
    throw new Error(
      `Could not locate base realm: ${bundled}/base does not exist ` +
        `and sibling ${baseDir} is also missing. Run \`pnpm build\` ` +
        'in packages/boxel-cli to populate the bundled realms.',
    );
  }
  return { baseDir, skillsDir };
}

function dirExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// QUnit Runner
// ---------------------------------------------------------------------------

interface QunitRunnerOptions {
  pm: ProfileManager;
  /**
   * Remote-mode realm URL. Set this OR `realmMounts`, not both. In
   * remote mode the host's loader fetches modules from `targetRealm`
   * over the network.
   */
  targetRealm?: string;
  /**
   * Remote-mode host-app URL (a realm-server compat proxy). Only used
   * when `targetRealm` is set; ignored in local mode (where the test
   * page is served from the same origin as the realm mounts).
   */
  hostAppUrl?: string;
  /**
   * Local-mode realm mounts. The unified test-page server serves
   * `<origin>/<prefix>/...` from each `root`, transpiling `.gts`/`.ts`
   * on demand. Set this OR `targetRealm`, not both.
   */
  realmMounts?: RealmMount[];
  hostDistDir?: string;
  /** Force the fetcher to re-download the pinned harness. */
  refreshHarness?: boolean;
  /** Sideload a harness tarball from disk instead of downloading. */
  offlineTarball?: string;
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
    let resolved = await resolveHostTestHarness({
      ...(options.hostDistDir ? { hostDistDir: options.hostDistDir } : {}),
      ...(options.refreshHarness ? { refresh: true } : {}),
      ...(options.offlineTarball
        ? { offlineTarball: options.offlineTarball }
        : {}),
    });
    let hostDistDir = resolved.path;

    if (options.debug) {
      process.stderr.write(
        `[harness] using ${describeSource(resolved.source)} (${hostDistDir})\n`,
      );
    }

    if (!fileExists(join(hostDistDir, 'tests', 'index.html'))) {
      throw new Error(
        `Host test harness at ${hostDistDir} is incomplete — missing tests/index.html.`,
      );
    }

    let {
      url: testPageUrl,
      server,
      setHtml,
      realmURL,
    } = await startTestPageServer({
      hostDistDir,
      ...(options.realmMounts ? { realmMounts: options.realmMounts } : {}),
    });
    testPageServer = server;

    // In local mode, both the realm URL and the host-app proxy URL
    // originate from this same server. In remote mode, fall back to
    // the caller-provided values.
    let resolvedTargetRealm = options.realmMounts
      ? realmURL('workspace')
      : options.targetRealm!;
    let resolvedHostAppUrl = options.realmMounts
      ? testPageUrl + '/'
      : options.hostAppUrl!;

    let html = buildQunitTestPageHtml({
      assetServerUrl: testPageUrl,
      hostDistDir,
      realmProxyUrl: resolvedHostAppUrl,
    });
    setHtml(html);

    let chromium = await loadChromium();
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

    // Realm-server auth only applies in remote mode — the local module
    // mounts on this same server don't gate on tokens.
    if (!options.realmMounts) {
      let realmToken = options.pm.getRealmToken(resolvedTargetRealm);
      if (realmToken) {
        let realmOrigin = new URL(resolvedTargetRealm).origin;
        await page.route(`${realmOrigin}/**`, (route) => {
          let headers = {
            ...route.request().headers(),
            Authorization: realmToken!,
          };
          route.continue({ headers });
        });
      }
    }

    let realmParam = encodeURIComponent(resolvedTargetRealm);
    let pageUrl = `${testPageUrl}?liveTest=true&realmURL=${realmParam}&hidepassed`;

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    // Default 5 min covers cold-start latency on CI; override via
    // BOXEL_TEST_RUNNER_TIMEOUT_MS for tooling that wants to fail
    // fast (the manifest-minimization loop sets it to ~30s).
    let runnerTimeoutMs = Number(
      process.env.BOXEL_TEST_RUNNER_TIMEOUT_MS ?? 300_000,
    );
    if (!Number.isFinite(runnerTimeoutMs) || runnerTimeoutMs <= 0) {
      runnerTimeoutMs = 300_000;
    }
    await page.waitForFunction(
      () =>
        (window as unknown as { __qunitResults?: { runEnd: unknown } })
          .__qunitResults?.runEnd !== null,
      null,
      { timeout: runnerTimeoutMs },
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

interface RealmMount {
  /** URL path segment (no slashes), e.g. "workspace" or "base". */
  prefix: string;
  /** Absolute path to the directory served at that prefix. */
  root: string;
}

interface TestPageServerOptions {
  hostDistDir: string;
  /** Realm mounts served from this same server (local-mode only). */
  realmMounts?: RealmMount[];
}

/**
 * Single HTTP server for the test page.
 *
 * - `GET /` returns the QUnit test-page HTML (set via `setHtml`).
 * - `GET /<prefix>/...` where `prefix` matches a realm mount: read the file
 *   from the mount's root, transpile `.gts` / `.ts` via
 *   `runtime-common.transpileJS`, serve the result. Implements the
 *   `_mtimes` JSON:API endpoint so the host's `live-test` bundle can
 *   discover test modules. This is what makes local-mode `boxel test`
 *   work without a realm-server.
 * - Everything else: served as a static file from `hostDistDir`
 *   (the host's compiled test bundle).
 *
 * The two responsibilities live in one server so chromium issues every
 * request against the same origin; that sidesteps CORS preflights and
 * the loader's URL-mapping edge cases.
 */
async function startTestPageServer(opts: TestPageServerOptions): Promise<{
  url: string;
  server: Server;
  setHtml: (h: string) => void;
  /** URL for a configured realm mount; throws if unknown. */
  realmURL: (prefix: string) => string;
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
  let hostDistRoot = resolve(opts.hostDistDir);

  // Module-fallback extensions match the realm-server loader: prefer the
  // bare path, then synthesize the extensions the host-app loader strips.
  let FALLBACK_EXTS = ['', '.gts', '.ts', '.json'];

  let mountByPrefix = new Map<string, RealmMount>();
  for (let mount of opts.realmMounts ?? []) {
    mountByPrefix.set(mount.prefix, {
      prefix: mount.prefix,
      root: resolve(mount.root),
    });
  }
  let transpileCache = new Map<string, { mtimeMs: number; body: string }>();

  let html = '';
  let setHtml = (h: string) => {
    html = h;
  };

  function resolveExisting(mountRoot: string, relPath: string): string | null {
    for (let ext of FALLBACK_EXTS) {
      let candidate = resolve(mountRoot, relPath + ext);
      if (candidate !== mountRoot && !candidate.startsWith(mountRoot + sep)) {
        continue;
      }
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // ignore
      }
    }
    return null;
  }

  function walkRealm(
    root: string,
    current: string,
    realmUrl: string,
    out: Record<string, number>,
  ): void {
    let entries;
    try {
      entries = readdirSync(join(root, current), { withFileTypes: true });
    } catch {
      return;
    }
    for (let entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      let relPath = current ? `${current}/${entry.name}` : entry.name;
      let abs = join(root, relPath);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walkRealm(root, relPath, realmUrl, out);
      } else if (st.isFile()) {
        out[`${realmUrl}${relPath}`] = Math.floor(st.mtimeMs);
      }
    }
  }

  return new Promise((res, rej) => {
    let server = createServer(async (req, reply) => {
      let url = (req.url ?? '/').split('?')[0];

      // Preflight — chromium issues these when the realmURL is on the same
      // origin via a different path. Bare `*` is fine; nothing on this
      // server reads credentials.
      if (req.method === 'OPTIONS') {
        reply.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        });
        reply.end();
        return;
      }

      if (url === '/') {
        reply.writeHead(200, {
          'Content-Type': 'text/html',
          'Access-Control-Allow-Origin': '*',
        });
        reply.end(html);
        return;
      }

      let parts = url.replace(/^\/+/, '').split('/');
      let firstSegment = parts[0] ?? '';
      let mount = mountByPrefix.get(firstSegment);

      if (mount) {
        let rest = parts.slice(1).join('/');
        let realmUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/${mount.prefix}/`;

        // `_mtimes` discovery: synthesize the JSON:API document the host's
        // live-test bundle expects from a realm-server.
        if (rest === '_mtimes') {
          let mtimes: Record<string, number> = {};
          walkRealm(mount.root, '', realmUrl, mtimes);
          reply.writeHead(200, {
            'Content-Type': 'application/vnd.api+json',
            'Access-Control-Allow-Origin': '*',
          });
          reply.end(
            JSON.stringify({
              data: {
                id: realmUrl,
                type: 'mtimes',
                attributes: { mtimes },
              },
            }),
          );
          return;
        }

        let normalized = normalize(rest).split(sep).join('/');
        if (normalized.startsWith('..') || normalized.startsWith('/')) {
          reply.writeHead(403, { 'Access-Control-Allow-Origin': '*' });
          reply.end('Forbidden');
          return;
        }
        let filePath = resolveExisting(mount.root, normalized);
        if (!filePath) {
          reply.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
          reply.end('Not found');
          return;
        }
        let stat = statSync(filePath);
        let ext = filePath.match(/\.[^.]+$/)?.[0] ?? '';
        let needsTranspile = ext === '.gts' || ext === '.ts';

        if (needsTranspile) {
          let cached = transpileCache.get(filePath);
          if (!cached || cached.mtimeMs !== stat.mtimeMs) {
            let source = readFileSync(filePath, 'utf8');
            try {
              cached = {
                mtimeMs: stat.mtimeMs,
                body: await transpileJS(source, '/' + normalized),
              };
            } catch (err) {
              let message = err instanceof Error ? err.message : String(err);
              reply.writeHead(500, {
                'Content-Type': 'text/plain',
                'Access-Control-Allow-Origin': '*',
              });
              reply.end(`transpile failed: ${message}`);
              return;
            }
            transpileCache.set(filePath, cached);
          }
          reply.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Access-Control-Allow-Origin': '*',
            'X-Boxel-Cli-Transpiled': '1',
          });
          reply.end(cached.body);
          return;
        }

        try {
          reply.writeHead(200, {
            'Content-Type': mimeTypes[ext] ?? 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
          });
          reply.end(readFileSync(filePath));
        } catch {
          reply.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
          reply.end('Not found');
        }
        return;
      }

      // Fall-through: static asset from the host's bundled dist.
      let normalized = normalize(url.slice(1));
      if (normalized.startsWith('..') || normalized.startsWith('/')) {
        reply.writeHead(403);
        reply.end('Forbidden');
        return;
      }
      let filePath = resolve(hostDistRoot, normalized);
      if (!filePath.startsWith(hostDistRoot)) {
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
    });
    server.on('error', rej);
    server.listen(0, '127.0.0.1', () => {
      let addr = server.address();
      if (!addr || typeof addr === 'string') {
        rej(new Error('Failed to start test page server'));
        return;
      }
      let baseUrl = `http://127.0.0.1:${addr.port}`;
      res({
        url: baseUrl,
        server,
        setHtml,
        realmURL: (prefix: string) => {
          if (!mountByPrefix.has(prefix)) {
            throw new Error(`Unknown realm mount prefix: ${prefix}`);
          }
          return `${baseUrl}/${prefix}/`;
        },
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
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
  realm?: string;
  hostAppUrl?: string;
  hostDistDir?: string;
  refreshHarness?: boolean;
  offlineTarball?: string;
  debug?: boolean;
  json?: boolean;
}

export function registerTestCommand(program: Command): void {
  program
    .command('test')
    .description(
      'Run every `*.test.gts` file in a workspace directory in a headless Chromium driven against the host app. Defaults to serving cards from the local workspace (cwd or [path]) via an in-process transpiling server; pass `--realm <url>` to test cards already on a remote realm instead.',
    )
    .argument(
      '[path]',
      'Local workspace directory to test (defaults to cwd). Ignored when --realm is set.',
    )
    .option(
      '--realm <realm-url>',
      'Test against a remote realm URL instead of the local workspace. Modules are fetched from the realm-server.',
    )
    .option(
      '--host-app-url <url>',
      "Host app URL (compat proxy). Defaults to the local module server in local mode, or the active profile's realm-server URL in --realm mode.",
    )
    .option(
      '--host-dist-dir <path>',
      'Override the host app dist directory used to build the test page. Bypasses the test-harness fetcher.',
    )
    .option(
      '--refresh-harness',
      "Force re-download of the pinned host test harness, even if it's cached.",
    )
    .option(
      '--offline-tarball <path>',
      'Sideload a harness tarball from disk instead of downloading. Useful for offline first-run.',
    )
    .option('--debug', 'Stream browser console output to stderr')
    .option('--json', 'Output structured JSON result')
    .action(async (pathArg: string | undefined, opts: TestCliOptions) => {
      let result: RunTestsResult;
      try {
        let sharedHarnessOpts = {
          ...(opts.hostDistDir ? { hostDistDir: opts.hostDistDir } : {}),
          ...(opts.refreshHarness ? { refreshHarness: true } : {}),
          ...(opts.offlineTarball
            ? { offlineTarball: opts.offlineTarball }
            : {}),
          ...(opts.debug ? { debug: true } : {}),
        };
        if (opts.realm) {
          result = await runTestsForRealm(opts.realm, {
            ...(opts.hostAppUrl ? { hostAppUrl: opts.hostAppUrl } : {}),
            ...sharedHarnessOpts,
          });
        } else {
          let workspaceDir = resolve(pathArg ?? process.cwd());
          result = await runTestsLocally({
            workspaceDir,
            ...sharedHarnessOpts,
          });
        }
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
        if (result.status !== 'passed') {
          process.exit(1);
        }
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
