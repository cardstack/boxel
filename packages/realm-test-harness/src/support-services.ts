import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import puppeteer, { type Browser } from 'puppeteer';

import { logger } from './logger';

import {
  boxelIconsDir,
  browserPassword,
  cleanupStaleSynapseContainers,
  DEFAULT_ICONS_PROBE_URL,
  DEFAULT_MATRIX_BROWSER_USERNAME,
  DEFAULT_MATRIX_SERVER_USERNAME,
  DEFAULT_PG_HOST,
  DEFAULT_PG_PORT,
  CONFIGURED_HOST_URL,
  findAndHoldAvailablePort,
  findHostDistPackageDir,
  findRootRepoCheckoutDir,
  hostDir,
  logTimed,
  maybeRequire,
  prepareTestPgScript,
  realmServerDir,
  runCommand,
  supportLog,
  waitUntil,
  workspaceRoot,
  type FactorySupportContext,
  type SynapseInstance,
} from './shared';
import { canConnectToPg } from './database';

let log = logger('support-services');
let preparePgPromise: Promise<void> | undefined;

function hostStartupLooksLikePortContention(logs: string): boolean {
  return /EADDRINUSE|address already in use/i.test(logs);
}

function boxelUIDistIsUsable(hostPackageDir: string): boolean {
  let boxelUIDistDir = join(hostPackageDir, '..', 'boxel-ui', 'addon', 'dist');
  return [
    join(boxelUIDistDir, 'components.js'),
    join(boxelUIDistDir, 'helpers.js'),
    join(boxelUIDistDir, 'icons.js'),
    join(boxelUIDistDir, 'styles', 'global.css'),
  ].every((path) => existsSync(path));
}

/**
 * Ensure boxel-ui dist artifacts exist for the host package. Tries in order:
 *   1. The current worktree's boxel-ui/addon/dist
 *   2. Symlink from the root repo's built boxel-ui dist (fast, avoids rebuild)
 *   3. Build boxel-ui in the current worktree (slow but always works)
 */
function ensureBoxelUIDist(hostPackageDir: string): void {
  if (boxelUIDistIsUsable(hostPackageDir)) {
    return;
  }

  let boxelUIAddonDir = join(hostPackageDir, '..', 'boxel-ui', 'addon');
  let boxelUIDistDir = join(boxelUIAddonDir, 'dist');

  // Try to symlink from root repo first (fast path for worktrees).
  let rootRepoCheckoutDir = findRootRepoCheckoutDir();
  if (rootRepoCheckoutDir && rootRepoCheckoutDir !== workspaceRoot) {
    let rootRepoBoxelUIDistDir = join(
      rootRepoCheckoutDir,
      'packages',
      'boxel-ui',
      'addon',
      'dist',
    );
    if (
      [
        join(rootRepoBoxelUIDistDir, 'components.js'),
        join(rootRepoBoxelUIDistDir, 'helpers.js'),
        join(rootRepoBoxelUIDistDir, 'icons.js'),
        join(rootRepoBoxelUIDistDir, 'styles', 'global.css'),
      ].every((p) => existsSync(p))
    ) {
      supportLog.info(
        `symlinking boxel-ui dist from root repo: ${rootRepoBoxelUIDistDir} -> ${boxelUIDistDir}`,
      );
      try {
        if (existsSync(boxelUIDistDir)) {
          rmSync(boxelUIDistDir, { recursive: true, force: true });
        }
        symlinkSync(rootRepoBoxelUIDistDir, boxelUIDistDir);
        if (boxelUIDistIsUsable(hostPackageDir)) {
          return;
        }
      } catch (error) {
        supportLog.debug(
          `symlink failed, will try building instead: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // Remove any leftover symlink so the build writes into the worktree,
  // not through a symlink into the root repo.
  if (existsSync(boxelUIDistDir)) {
    rmSync(boxelUIDistDir, { recursive: true, force: true });
  }

  // Fall back to building boxel-ui.
  supportLog.info(`building boxel-ui dist at ${boxelUIAddonDir}...`);
  let result = spawnSync('pnpm', ['build'], {
    cwd: boxelUIAddonDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to build boxel-ui at ${boxelUIAddonDir} (exit code ${result.status}). ` +
        `Run \`cd ${boxelUIAddonDir} && pnpm build\` manually to diagnose.`,
    );
  }
  if (!boxelUIDistIsUsable(hostPackageDir)) {
    throw new Error(
      `boxel-ui build succeeded but dist is still incomplete at ${boxelUIDistDir}`,
    );
  }
}

/**
 * Build the host app dist when no pre-built dist is available anywhere.
 * Returns the host package directory where the dist was built.
 */
function buildHostDist(): string {
  // Prefer building in the current worktree so the output is local.
  let buildDir = hostDir;
  supportLog.info(
    `no pre-built host dist found — building host app at ${buildDir}...`,
  );
  let result = spawnSync('pnpm', ['build'], {
    cwd: buildDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to build host app at ${buildDir} (exit code ${result.status}). ` +
        `Run \`cd ${buildDir} && pnpm build\` manually to diagnose.`,
    );
  }
  let indexPath = join(buildDir, 'dist', 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(
      `Host build succeeded but dist/index.html is missing at ${buildDir}`,
    );
  }
  return buildDir;
}

function assertUsableHostDist(hostPackageDir: string): void {
  let indexHTMLPath = join(hostPackageDir, 'dist', 'index.html');
  if (!existsSync(indexHTMLPath)) {
    throw new Error(
      `No built host dist was found at ${indexHTMLPath}. The software-factory harness requires a built host app from the current worktree or root repo checkout. Run \`cd ${hostPackageDir} && mise exec -- pnpm build\` and retry.`,
    );
  }

  let html = readFileSync(indexHTMLPath, 'utf8');
  let match = html.match(
    /<meta name="@cardstack\/host\/config\/environment" content="([^"]+)">/,
  );
  if (!match) {
    return;
  }

  // Previously rejected Ember test builds (autoboot=false, rootElement=#ember-testing).
  // Now accepted: the harness uses the main index.html for the app, and the
  // QUnit live-test page at /tests/index.html for card test execution.
  // Both development and test builds are usable.
  void match; // config check removed — all build types accepted
}

async function loadSynapseModule() {
  let moduleSpecifier = '../../matrix/support/synapse/index.ts';
  return (maybeRequire(moduleSpecifier) ?? (await import(moduleSpecifier))) as {
    registerUser: (
      synapse: SynapseInstance,
      username: string,
      password: string,
      admin?: boolean,
      displayName?: string,
    ) => Promise<unknown>;
    synapseStart: (
      opts?: {
        suppressRegistrationSecretFile?: true;
        dynamicHostPort?: true;
      },
      stopExisting?: boolean,
    ) => Promise<SynapseInstance>;
    synapseStop: (id: string) => Promise<void>;
  };
}

async function loadMatrixEnvironmentConfigModule() {
  let moduleSpecifier = '../../matrix/support/environment-config.ts';
  return (maybeRequire(moduleSpecifier) ?? (await import(moduleSpecifier))) as {
    getSynapseURL: (synapse?: { baseUrl?: string; port?: number }) => string;
  };
}

// A cold vite optimize of the host's transitive graph routinely exceeds
// 90s, so the marker probe needs a generous budget. Env-overridable for
// especially slow CI runners.
const STANDBY_DOM_RENDER_TIMEOUT_MS =
  parseInt(process.env.TEST_HARNESS_STANDBY_DOM_TIMEOUT_MS ?? '', 10) ||
  240_000;

// Per-attempt cap, bounded by the overall budget. Short enough that a boot
// that stalls on a mid-optimize module error is abandoned for a fresh page
// rather than burning the whole budget; long enough to clear a near-ready
// optimize in one go.
const STANDBY_DOM_ATTEMPT_TIMEOUT_MS = 60_000;

// Chrome cold-start on a loaded CI runner can take longer than Puppeteer's
// default 30s launch timeout to print its DevTools WS endpoint, so a single
// slow start fails the whole support bring-up before the post-launch
// render-retry loop below ever runs. Retry the launch on a fresh Chrome
// process with a longer per-attempt budget, bounded by the standby gate's
// overall deadline. From the first retry onward, pipe Chrome's own
// stdout/stderr through node (dumpio) so a persistent failure records *why* it
// could not start — sandbox denial, missing shared library, GPU init crash —
// instead of only the bare "waiting for the WS endpoint URL" timeout.
const STANDBY_LAUNCH_ATTEMPT_TIMEOUT_MS = 45_000;
const STANDBY_LAUNCH_MAX_ATTEMPTS = 3;
const STANDBY_LAUNCH_RETRY_BACKOFF_MS = 2_000;

async function launchStandbyBrowser(deadline: number): Promise<Browser> {
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  let verbose = process.env.TEST_HARNESS_STANDBY_VERBOSE === '1';
  let lastError: unknown;
  for (let attempt = 1; attempt <= STANDBY_LAUNCH_MAX_ATTEMPTS; attempt++) {
    let remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    let timeout = Math.min(STANDBY_LAUNCH_ATTEMPT_TIMEOUT_MS, remaining);
    // Attempt 1 stays quiet on the healthy path; any retry already means
    // something is wrong, so capture Chrome's own output for the next failure.
    let dumpio = verbose || attempt > 1;
    supportLog.info(
      `standby DOM gate: puppeteer.launch attempt ${attempt}/${STANDBY_LAUNCH_MAX_ATTEMPTS} ` +
        `(timeout=${timeout}ms, executable=${
          executablePath ?? 'puppeteer-bundled'
        }, dumpio=${dumpio})`,
    );
    let startedAt = Date.now();
    try {
      let browser = await puppeteer.launch({
        headless: true,
        timeout,
        dumpio,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
        ...(executablePath ? { executablePath } : {}),
      });
      supportLog.info(
        `standby DOM gate: puppeteer.launch attempt ${attempt} succeeded after ${
          Date.now() - startedAt
        }ms`,
      );
      return browser;
    } catch (error) {
      lastError = error;
      supportLog.warn(
        `standby DOM gate: puppeteer.launch attempt ${attempt} failed after ${
          Date.now() - startedAt
        }ms: ${
          error instanceof Error ? error.message.split('\n')[0] : String(error)
        }`,
      );
      if (
        attempt === STANDBY_LAUNCH_MAX_ATTEMPTS ||
        deadline - Date.now() <= STANDBY_LAUNCH_RETRY_BACKOFF_MS
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, STANDBY_LAUNCH_RETRY_BACKOFF_MS));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`puppeteer.launch failed: ${String(lastError)}`);
}

// Drive `<hostURL>/_standby` in a real (headless) browser and wait for the
// `#standby-ready` marker the host app renders once its bundles have loaded
// and the app shell has booted — the same signal the prerender's PagePool
// waits on. This is the only check that proves vite served the full module
// graph (not just the HTML shell) and the app can render DOM. Throws with
// the captured vite logs if the marker never appears or vite exits.
async function assertStandbyRendersDom(
  hostURL: string,
  getLogs: () => string,
  getFatalExitCode: () => number | null,
): Promise<void> {
  let standbyURL = `${hostURL.replace(/\/$/, '')}/_standby`;
  let deadline = Date.now() + STANDBY_DOM_RENDER_TIMEOUT_MS;
  let browser = await launchStandbyBrowser(deadline);
  let lastError: Error | undefined;
  let startedAt = Date.now();
  let attempt = 0;
  supportLog.info(`standby DOM gate: probing ${standbyURL} for #standby-ready`);
  try {
    // Retry the whole navigation + marker wait on a fresh page each attempt,
    // not just the connection phase. While vite is cold-optimizing, a first
    // load can fetch the shell but error or stall on a module request and
    // never render `#standby-ready`; that page stays permanently stuck, so a
    // single `waitForFunction` would burn the entire budget on a dead boot.
    // A fresh page reloads against the now-further-along optimizer (which
    // keeps running server-side across page closes) and eventually succeeds.
    // Mirrors the prerender PagePool's fresh-page standby retry.
    for (;;) {
      let fatal = getFatalExitCode();
      if (fatal !== null) {
        throw new Error(
          `host app (vite preview) exited early with code ${fatal} while waiting for ${standbyURL} to render\n${getLogs()}`,
        );
      }
      let remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `Timed out after ${STANDBY_DOM_RENDER_TIMEOUT_MS}ms waiting for ${standbyURL} to render its DOM (#standby-ready)` +
            (lastError ? `\nlast attempt: ${lastError.message}` : '') +
            `\n${getLogs()}`,
        );
      }
      let attemptTimeout = Math.min(STANDBY_DOM_ATTEMPT_TIMEOUT_MS, remaining);
      attempt++;
      let page = await browser.newPage();
      try {
        await page.goto(standbyURL, {
          waitUntil: 'domcontentloaded',
          timeout: attemptTimeout,
        });
        await page.waitForFunction(
          () => !!document.querySelector('#standby-ready'),
          { timeout: attemptTimeout },
        );
        supportLog.info(
          `standby DOM gate: #standby-ready after ${Date.now() - startedAt}ms (${attempt} attempt(s))`,
        );
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        supportLog.info(
          `standby DOM gate: attempt ${attempt} did not render (${
            Date.now() - startedAt
          }ms elapsed): ${lastError.message.split('\n')[0]}`,
        );
        await new Promise((r) => setTimeout(r, 500));
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

async function ensureHostReady(): Promise<{
  hostURL: string;
  stop?: () => Promise<void>;
}> {
  let configuredHostURL = CONFIGURED_HOST_URL?.href;
  return await logTimed(
    supportLog,
    `ensureHostReady ${configuredHostURL ?? 'dynamic host dist'}`,
    async () => {
      if (configuredHostURL) {
        try {
          let response = await fetch(configuredHostURL);
          if (response.ok) {
            return { hostURL: configuredHostURL };
          }
          throw new Error(
            `configured software-factory host URL ${configuredHostURL} returned HTTP ${response.status}`,
          );
        } catch (error) {
          throw new Error(
            `configured software-factory host URL ${configuredHostURL} is not reachable: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      let hostPackageDir = findHostDistPackageDir();
      if (!hostPackageDir) {
        // No pre-built host dist found anywhere. Build it automatically so
        // cache:prepare works in a fresh worktree without manual setup.
        hostPackageDir = buildHostDist();
      }
      ensureBoxelUIDist(hostPackageDir);
      assertUsableHostDist(hostPackageDir);
      // Hold the port until just before spawn so a sibling allocation
      // cannot race in and take it. See findAndHoldAvailablePort comment
      // for the full failure mode this guards against.
      let portReservation = await findAndHoldAvailablePort();
      let port = portReservation.port;
      let hostURL = `http://localhost:${port}/`;
      supportLog.debug(
        `serving built host dist from ${hostPackageDir} at ${hostURL}`,
      );

      await portReservation.release();
      // Strip REALM_SERVER_TLS_CERT_FILE / _KEY_FILE before spawning vite
      // preview. packages/host/vite.config.mjs reads those env vars and,
      // when present, terminates TLS in vite preview too. The harness
      // probes readiness via `fetch('http://localhost:<port>/')` and
      // hands the same http URL to spawned realm-servers via HOST_URL,
      // so an HTTPS preview server would make the readiness probe and
      // every downstream HOST_URL fetch fail. The dev stack's HTTPS
      // origin lives on a fixed port (4200); harness ports are dynamic
      // and never browser-facing, so plain HTTP is the right scheme
      // here.
      let { REALM_SERVER_TLS_CERT_FILE, REALM_SERVER_TLS_KEY_FILE, ...env } =
        process.env;
      void REALM_SERVER_TLS_CERT_FILE;
      void REALM_SERVER_TLS_KEY_FILE;
      let child = spawn(
        'npx',
        ['vite', 'preview', '--port', String(port), '--strictPort'],
        {
          cwd: hostPackageDir,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env,
        },
      );

      let logs = '';
      child.stdout?.on('data', (chunk) => {
        logs = `${logs}${String(chunk)}`.slice(-20_000);
      });
      child.stderr?.on('data', (chunk) => {
        logs = `${logs}${String(chunk)}`.slice(-20_000);
      });

      // Phase 1: wait for vite preview to accept connections. This only
      // proves the server is listening and can return the HTML shell — it
      // never requests modules, so it does not prove the app can boot.
      await waitUntil(
        async () => {
          try {
            let readyResponse = await fetch(hostURL);
            if (readyResponse.ok) {
              return true;
            }
          } catch {
            // host not ready yet
          }
          if (child.exitCode !== null) {
            if (hostStartupLooksLikePortContention(logs)) {
              return false;
            }
            throw new Error(
              `host app exited early with code ${child.exitCode}\n${logs}`,
            );
          }
          return false;
        },
        {
          timeout: 180_000,
          interval: 500,
          timeoutMessage: `Timed out waiting for host app at ${hostURL}\n${logs}`,
        },
      );

      // Phase 2: prove vite can actually render the `/_standby` page's DOM,
      // not just serve the HTML shell. A shell fetch never requests modules,
      // so it does not kick vite's dep optimizer; only a browser-shaped
      // navigation forces the (~1000-package) app graph to build, which can
      // exceed 90s cold. The in-harness realm-server and prerenderer both
      // drive `/_standby` through Puppeteer and block on the `#standby-ready`
      // marker (packages/realm-server/prerender/page-pool.ts); gating their
      // bring-up on the same marker here keeps them from spinning up while
      // vite is still cold — the window where the prerender's standby load
      // exhausts its retry budget and renders fail with ECONNREFUSED.
      await assertStandbyRendersDom(
        hostURL,
        () => logs,
        () =>
          child.exitCode !== null && !hostStartupLooksLikePortContention(logs)
            ? child.exitCode
            : null,
      );

      return {
        hostURL,
        async stop() {
          if (child.exitCode === null) {
            try {
              process.kill(-child.pid!, 'SIGTERM');
            } catch {
              // best effort cleanup
            }
          }
        },
      };
    },
  );
}

async function waitForHttpReady(url: string, timeoutMs = 60_000) {
  let startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      let response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url} to become ready`);
}

async function stopChildProcess(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGINT',
): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      child.removeAllListeners('exit');
      child.removeAllListeners('error');
    };

    child.once('exit', () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    });
    child.once('error', () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    });

    timeout = setTimeout(() => {
      if (!settled) {
        child.kill('SIGTERM');
      }
    }, 5_000);

    child.kill(signal);
  });
}

class PrerenderPortContentionError extends Error {
  constructor(
    public readonly port: number,
    message: string,
  ) {
    super(message);
    this.name = 'PrerenderPortContentionError';
  }
}

export async function startHarnessPrerenderServer(options: {
  boxelHostURL: string;
  port?: number;
}): Promise<{
  url: string;
  stop(): Promise<void>;
}> {
  // findAvailablePort picks a port, closes its probe socket, and hands the
  // number back. Between close and the child binding, another process on
  // the same host can snatch the port and the child dies with EADDRINUSE.
  // Retry on contention in either case: if the caller supplied an explicit
  // port the collision is usually transient (another process in TIME_WAIT
  // or a briefly-bound prober), so a short backoff is typically enough.
  const maxAttempts = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptStartHarnessPrerenderServer(options);
    } catch (err) {
      if (
        attempt < maxAttempts &&
        err instanceof PrerenderPortContentionError
      ) {
        log.warn(
          `prerender server port ${err.port} contended at bind — retrying (attempt ${attempt + 1}/${maxAttempts})`,
        );
        // Short backoff before retrying. When the port is explicit we are
        // retrying the same port, so give any transient blocker a moment
        // to release.
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        continue;
      }
      throw err;
    }
  }
}

async function attemptStartHarnessPrerenderServer(options: {
  boxelHostURL: string;
  port?: number;
}): Promise<{
  url: string;
  stop(): Promise<void>;
}> {
  let port: number;
  let portReservation: Awaited<
    ReturnType<typeof findAndHoldAvailablePort>
  > | null = null;
  if (options.port && options.port !== 0) {
    port = options.port;
  } else {
    portReservation = await findAndHoldAvailablePort();
    port = portReservation.port;
  }
  let url = `http://localhost:${port}`;
  // Release the holder right before the child binds (only if we allocated).
  if (portReservation) {
    await portReservation.release();
  }
  let child = spawn(
    'ts-node',
    ['--transpileOnly', 'prerender/prerender-server', `--port=${port}`],
    {
      cwd: realmServerDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? 'development',
        NODE_NO_WARNINGS: '1',
        BOXEL_HOST_URL: options.boxelHostURL,
        LOG_LEVELS:
          process.env.TEST_HARNESS_PRERENDER_LOG_LEVELS ??
          process.env.LOG_LEVELS,
        // Prevent test harness prerender servers from registering with
        // external prerender managers (e.g. the dev-all manager on :4222).
        // Port 1 is expected to be closed, so heartbeat fetches fail fast
        // and are silently caught by the try/catch in prerender-app.ts.
        PRERENDER_MANAGER_URL: 'http://127.0.0.1:1',
      },
    },
  );

  // Ring-buffer the child's stdio so a startup crash surfaces the actual
  // error (EADDRINUSE, missing dep, puppeteer launch failure, …) instead of
  // just "exited before it became ready".
  const STDIO_BUFFER_BYTES = 4096;
  let recentStdout = '';
  let recentStderr = '';
  let appendBounded = (buf: string, chunk: string): string => {
    let combined = buf + chunk;
    return combined.length > STDIO_BUFFER_BYTES
      ? combined.slice(-STDIO_BUFFER_BYTES)
      : combined;
  };

  child.stdout?.on('data', (data: Buffer) => {
    let text = data.toString();
    recentStdout = appendBounded(recentStdout, text);
    log.info(`prerender: ${text}`);
  });
  child.stderr?.on('data', (data: Buffer) => {
    let text = data.toString();
    recentStderr = appendBounded(recentStderr, text);
    log.error(`prerender: ${text}`);
  });

  let exitListener:
    | ((code: number | null, signal: NodeJS.Signals | null) => void)
    | undefined;
  let errorListener: ((err: Error) => void) | undefined;
  let exitPromise = new Promise<never>((_, reject) => {
    exitListener = (code, signal) => {
      // Give any buffered stdio a final tick to flush before we build the
      // error message — 'exit' can fire before the last 'data' event.
      setImmediate(() => {
        let diagnostic = buildChildExitDiagnostic({
          recentStdout,
          recentStderr,
        });
        let message = `prerender server exited before it became ready (code: ${code}, signal: ${signal})${diagnostic}`;
        if (
          hostStartupLooksLikePortContention(`${recentStdout}\n${recentStderr}`)
        ) {
          reject(new PrerenderPortContentionError(port, message));
        } else {
          reject(new Error(message));
        }
      });
    };
    errorListener = reject;
    child.once('exit', exitListener);
    child.once('error', errorListener);
  });

  try {
    await Promise.race([waitForHttpReady(url), exitPromise]);
  } finally {
    // Detach the startup listeners so a later intentional exit (during
    // test teardown) doesn't surface as an unhandled rejection on
    // exitPromise.
    if (exitListener) child.off('exit', exitListener);
    if (errorListener) child.off('error', errorListener);
    // Swallow the now-orphaned rejection if the race was won by
    // waitForHttpReady but 'exit' still fires later.
    exitPromise.catch(() => {});
  }

  return {
    url,
    async stop() {
      await stopChildProcess(child);
    },
  };
}

function buildChildExitDiagnostic(buffers: {
  recentStdout: string;
  recentStderr: string;
}): string {
  let parts: string[] = [];
  let stderr = buffers.recentStderr.trim();
  if (stderr) {
    parts.push(`stderr tail:\n${stderr}`);
  }
  let stdout = buffers.recentStdout.trim();
  if (stdout) {
    parts.push(`stdout tail:\n${stdout}`);
  }
  if (parts.length === 0) {
    return ' (child produced no stdio before exit)';
  }
  return `\n${parts.join('\n\n')}`;
}

/**
 * Ensure boxel-icons dist exists. In a worktree, symlink from the root repo
 * if available, otherwise build.
 */
function ensureBoxelIconsDist(): void {
  let distDir = join(boxelIconsDir, 'dist');
  if (
    existsSync(join(distDir, '@cardstack')) ||
    existsSync(join(distDir, 'index.html'))
  ) {
    return;
  }

  // Try to symlink from root repo (fast path for worktrees).
  let rootRepoCheckoutDir = findRootRepoCheckoutDir();
  if (rootRepoCheckoutDir && rootRepoCheckoutDir !== workspaceRoot) {
    let rootRepoIconsDistDir = join(
      rootRepoCheckoutDir,
      'packages',
      'boxel-icons',
      'dist',
    );
    if (existsSync(join(rootRepoIconsDistDir, '@cardstack'))) {
      supportLog.info(
        `symlinking boxel-icons dist from root repo: ${rootRepoIconsDistDir} -> ${distDir}`,
      );
      try {
        if (existsSync(distDir)) {
          rmSync(distDir, { recursive: true, force: true });
        }
        symlinkSync(rootRepoIconsDistDir, distDir);
        if (existsSync(join(distDir, '@cardstack'))) {
          return;
        }
      } catch (error) {
        supportLog.debug(
          `symlink failed, will try building instead: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // Remove any leftover symlink so the build writes into the worktree,
  // not through a symlink into the root repo.
  if (existsSync(distDir)) {
    rmSync(distDir, { recursive: true, force: true });
  }

  // Fall back to building boxel-icons.
  supportLog.info(`building boxel-icons dist at ${boxelIconsDir}...`);
  let result = spawnSync('pnpm', ['build'], {
    cwd: boxelIconsDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to build boxel-icons at ${boxelIconsDir} (exit code ${result.status}). ` +
        `Run \`cd ${boxelIconsDir} && pnpm build\` manually to diagnose.`,
    );
  }
  if (
    !existsSync(join(distDir, '@cardstack')) &&
    !existsSync(join(distDir, 'index.html'))
  ) {
    throw new Error(
      `Built boxel-icons at ${boxelIconsDir} but dist output is missing at ${distDir}`,
    );
  }
}

function startIconServerProcess(): {
  child: ReturnType<typeof spawn>;
  logs: () => string;
  spawnFailed: () => boolean;
  stop: () => Promise<void>;
} {
  let child = spawn('pnpm', ['serve'], {
    cwd: boxelIconsDir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let captured = '';
  let spawnError = false;
  child.stdout?.on('data', (chunk) => {
    captured = `${captured}${String(chunk)}`.slice(-20_000);
  });
  child.stderr?.on('data', (chunk) => {
    captured = `${captured}${String(chunk)}`.slice(-20_000);
  });
  child.on('error', (err) => {
    spawnError = true;
    captured = `${captured}\n[icon server spawn error] ${err.message}\n`.slice(
      -20_000,
    );
  });

  return {
    child,
    logs: () => captured,
    spawnFailed: () => spawnError,
    async stop() {
      if (child.exitCode === null) {
        try {
          process.kill(-child.pid!, 'SIGTERM');
        } catch {
          // best effort — process may have already exited or negative
          // PID may not be supported on this platform.
          try {
            child.kill('SIGTERM');
          } catch {
            // truly best effort
          }
        }
      }
    },
  };
}

async function ensureIconsReady(): Promise<{
  stop?: () => Promise<void>;
}> {
  return await logTimed(
    supportLog,
    `ensureIconsReady ${DEFAULT_ICONS_PROBE_URL}`,
    async () => {
      // Ensure boxel-icons dist exists before trying to serve it.
      ensureBoxelIconsDist();

      // Always start our own managed icon server so we control its lifecycle.
      // An externally-running server could die mid-indexing causing silent
      // render timeouts. If port 4206 is already taken by a healthy dev
      // server, our spawn will fail and we fall back to the existing one.
      let server = startIconServerProcess();

      try {
        await waitUntil(
          async () => {
            // If our process exited, either the port is already in use (dev
            // server running) or the start genuinely failed. Check if the
            // external server is healthy.
            if (server.spawnFailed()) {
              throw new Error(`icons server failed to spawn\n${server.logs()}`);
            }
            if (server.child.exitCode !== null) {
              try {
                let response = await fetch(DEFAULT_ICONS_PROBE_URL);
                if (response.ok) {
                  supportLog.debug(
                    'icons server already available (external process)',
                  );
                  return true;
                }
              } catch {
                // fall through
              }
              // If our process exited due to port contention, the external
              // server may still be starting up. Keep polling instead of
              // failing immediately.
              let logs = server.logs();
              if (/EADDRINUSE|address already in use/i.test(logs)) {
                return false;
              }
              throw new Error(
                `icons server exited early with code ${server.child.exitCode}\n${logs}`,
              );
            }
            try {
              let response = await fetch(DEFAULT_ICONS_PROBE_URL);
              return response.ok;
            } catch {
              return false;
            }
          },
          {
            timeout: 30_000,
            interval: 250,
            timeoutMessage: `Timed out waiting for icons server at ${DEFAULT_ICONS_PROBE_URL}\n${server.logs()}`,
          },
        );
      } catch (error) {
        await server.stop();
        throw error;
      }

      if (server.child.exitCode !== null) {
        // Our process couldn't start (port already taken by dev server).
        // Return without a stop function since we don't own the server.
        return {};
      }

      supportLog.debug('started managed icons server');
      return { stop: server.stop };
    },
  );
}

async function ensurePgReady(): Promise<void> {
  if (!preparePgPromise) {
    preparePgPromise = logTimed(
      supportLog,
      `ensurePgReady ${DEFAULT_PG_HOST}:${DEFAULT_PG_PORT}`,
      async () => {
        if (await canConnectToPg()) {
          supportLog.debug('postgres already available');
          return;
        }
        runCommand('bash', [prepareTestPgScript], workspaceRoot);
        await waitUntil(() => canConnectToPg(), {
          timeout: 30_000,
          interval: 250,
          timeoutMessage: `Timed out waiting for Postgres on ${DEFAULT_PG_HOST}:${DEFAULT_PG_PORT}`,
        });
      },
    ).catch((error) => {
      preparePgPromise = undefined;
      throw error;
    });
  }

  await preparePgPromise;
}

async function ensureSupportUsers(synapse: SynapseInstance): Promise<void> {
  await logTimed(supportLog, 'ensureSupportUsers', async () => {
    let { registerUser } = await loadSynapseModule();

    await registerUser(
      synapse,
      DEFAULT_MATRIX_SERVER_USERNAME,
      browserPassword(DEFAULT_MATRIX_SERVER_USERNAME),
    );
    await registerUser(
      synapse,
      DEFAULT_MATRIX_BROWSER_USERNAME,
      browserPassword(DEFAULT_MATRIX_BROWSER_USERNAME),
    );
  });
}

export async function startFactorySupportServices(): Promise<{
  context: FactorySupportContext;
  stop(): Promise<void>;
}> {
  return await logTimed(supportLog, 'startFactorySupportServices', async () => {
    await ensurePgReady();
    cleanupStaleSynapseContainers();
    let { synapseStart, synapseStop } = await loadSynapseModule();
    let { getSynapseURL } = await loadMatrixEnvironmentConfigModule();

    // stopExisting: false — the test harness uses a dynamic port, so it
    // doesn't conflict with the dev Synapse (boxel-synapse on port 8008).
    // Stopping existing containers kills the dev environment.
    let synapse = await synapseStart(
      { suppressRegistrationSecretFile: true, dynamicHostPort: true },
      false,
    );
    let matrixURL =
      process.env.TEST_HARNESS_MATRIX_URL ?? getSynapseURL(synapse);
    let host = await ensureHostReady();
    let icons = await ensureIconsReady();
    await ensureSupportUsers(synapse);

    return {
      context: {
        matrixURL,
        matrixRegistrationSecret: synapse.registrationSecret,
        hostURL: host.hostURL,
      },
      async stop() {
        await logTimed(supportLog, 'stopFactorySupportServices', async () => {
          await synapseStop(synapse.synapseId);
          await host.stop?.();
          await icons.stop?.();
        });
      },
    };
  });
}
