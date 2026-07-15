import { spawn, type ChildProcess } from 'child_process';
import { resolve, join } from 'path';
// @ts-expect-error no types
import { dirSync, setGracefulCleanup } from 'tmp';
import fsExtra from 'fs-extra';
const { ensureDirSync, copySync, readFileSync } = fsExtra;
import { Pool } from 'pg';
import { createServer as createNetServer, type AddressInfo } from 'net';
import type { SynapseInstance } from './synapse/index.ts';

setGracefulCleanup();

// The isolated realm-server / worker stack matches production:
// HTTPS+HTTP/2 on `https://localhost:4205`. URL maps, realm registry
// entries, and the Playwright `baseURL` all hardcode `https://`, and
// the spawned child processes inherit `REALM_SERVER_TLS_CERT_FILE` /
// `_KEY_FILE` from `mise-tasks/lib/env-vars.sh` so the same mkcert
// leaf the parent dev stack uses on :4201/:4202 also terminates TLS
// on :4205. Keeping the wire protocol identical to prod means the
// matrix suite acts as a regression guard on the h2 framing changes
// elsewhere in this PR (`setContextResponse` h1-only-header filter,
// `fetchRequestFromContext` pseudo-header strip, the HEAD-stream
// `writable` patch, and the hand-rolled `proxyAsset` forwarder).

const testRealmCards = resolve(
  join(import.meta.dirname, '..', '..', 'test-realm-cards', 'contents'),
);
const realmServerDir = resolve(
  join(import.meta.dirname, '..', '..', 'realm-server'),
);
const skillsRealmDir = resolve(
  join(import.meta.dirname, '..', '..', 'skills-realm', 'contents'),
);
const baseRealmDir = resolve(join(import.meta.dirname, '..', '..', 'base'));
const matrixDir = resolve(join(import.meta.dirname, '..'));
export const appURL = 'https://localhost:4205/test';

const DEFAULT_PRERENDER_PORT = 4231;
const DEFAULT_WORKER_MANAGER_READY_TIMEOUT_MS = 120_000;
const DEFAULT_WORKER_START_TIMEOUT_MS = 90_000;
// Absolute backstop for the realm-server-ready wait. `ready` fires once the
// server is listening with its realms mounted — the boot-time from-scratch
// index of every mounted realm (test + skills + base, ~600 files) then runs on
// a single worker and legitimately takes ~2 minutes on a loaded CI runner. The
// harness waits that index out separately, after `ready`, via _readiness-check
// (see the gate below). The progress-aware watchdog below is the real guard for
// the ready wait; this cap only catches a pathological slow-drip that keeps
// emitting output without ever finishing.
const DEFAULT_REALM_SERVER_START_TIMEOUT_MS = 300_000;
// Fail the boot only when it goes silent: if neither the worker's
// indexing-progress stream nor the realm server's lifecycle output advances
// for this long, treat the boot as stalled. Comfortably larger than the
// worst observed gap between progress signals (~1.3s) so a slow-but-
// progressing cold index never trips it, while a genuine hang surfaces fast.
const DEFAULT_REALM_SERVER_PROGRESS_IDLE_TIMEOUT_MS = 90_000;
const REALM_SERVER_PROGRESS_POLL_MS = 5_000;
// Post-`ready` gate: how long to wait for each mounted realm's boot index to
// settle (probed via _readiness-check) before letting tests run. The boot full
// index legitimately runs ~2 minutes under CI load; this leaves headroom while
// staying under the start cap above.
const DEFAULT_REALM_SERVER_INDEX_READY_TIMEOUT_MS = 240_000;
const STARTUP_LOG_TAIL_LINES = 80;

export interface PrerenderServerConfig {
  port?: number;
}

export interface RunningPrerenderServer {
  port: number;
  url: string;
  stop(): Promise<void>;
}

export interface StartRealmServerOptions {
  synapse: SynapseInstance;
  prerenderURL: string;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTimeoutMs(
  rawValue: string | undefined,
  fallbackMs: number,
): number {
  let parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

function pushOutputTail(output: string[], prefix: string, data: Buffer): void {
  for (let line of data.toString().split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    output.push(`${prefix}${line}`);
  }
  if (output.length > STARTUP_LOG_TAIL_LINES) {
    output.splice(0, output.length - STARTUP_LOG_TAIL_LINES);
  }
}

function readMetadataFile(filePath: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return undefined;
  }
}

function describeChildProcess(proc: ChildProcess | undefined) {
  if (!proc) {
    return { started: false };
  }
  return {
    started: true,
    pid: proc.pid ?? null,
    exitCode: proc.exitCode,
    signalCode: proc.signalCode,
    killed: proc.killed,
    connected: 'connected' in proc ? proc.connected : undefined,
  };
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    value: String(error),
  };
}

function buildStartupFailure(
  reason: unknown,
  diagnostics: Record<string, unknown>,
): Error {
  let message =
    reason instanceof Error
      ? reason.message
      : `Startup failed: ${String(reason)}`;
  let error = new Error(
    `${message}\nStartup diagnostics:\n${JSON.stringify(
      {
        ...diagnostics,
        startupFailure: describeError(reason),
      },
      null,
      2,
    )}`,
  );
  if (reason instanceof Error) {
    (error as Error & { cause?: unknown }).cause = reason;
  }
  return error;
}

async function isPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    let tester = createNetServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(preferred?: number): Promise<number> {
  if (typeof preferred === 'number' && (await isPortAvailable(preferred))) {
    return preferred;
  }
  return await new Promise((resolve, reject) => {
    let server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      let address = server.address() as AddressInfo | null;
      server.close(() => {
        if (address?.port) {
          resolve(address.port);
        } else {
          reject(new Error('Could not determine available port'));
        }
      });
    });
  });
}

async function waitForHttpReady(url: string, timeoutMs = 60_000) {
  let start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      let response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (e) {
      // ignore; server not ready yet
    }
    await delay(200);
  }
  throw new Error(`timed out waiting for ${url} to become ready`);
}

// Wait for a realm's `_readiness-check` to succeed. Unlike waitForHttpReady
// (which only proves a port answers), the probe blocks server-side until the
// realm's first from-scratch index and any in-flight index settle, so a success
// means that realm is fully indexed and safe to create/publish against. The
// server holds each request open until indexing settles, so a single `fetch`
// could block past the budget (up to undici's default header timeout) and never
// return to the loop condition — abort it at the remaining budget so the
// configured timeout is actually enforced and the caller can stop the child
// processes and emit diagnostics instead of leaving global setup to hang.
async function waitForRealmIndexed(url: string, timeoutMs: number) {
  let start = Date.now();
  let lastError: string | undefined;
  while (Date.now() - start < timeoutMs) {
    let remainingMs = timeoutMs - (Date.now() - start);
    let controller = new AbortController();
    let abortTimer = setTimeout(() => controller.abort(), remainingMs);
    try {
      // `_readiness-check` is registered under the JSON:API mime, and the realm
      // router matches routes on the Accept header — a default `*/*` misses it.
      let response = await fetch(url, {
        headers: { Accept: 'application/vnd.api+json' },
        signal: controller.signal,
      });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(abortTimer);
    }
    await delay(500);
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for ${url} to report indexed` +
      (lastError ? ` (last: ${lastError})` : ''),
  );
}

function stopChildProcess(
  proc: ChildProcess | undefined,
  signal: NodeJS.Signals = 'SIGINT',
) {
  return new Promise<void>((resolve) => {
    if (!proc) {
      resolve();
      return;
    }
    let child = proc;
    if (child.exitCode !== null || child.killed) {
      resolve();
      return;
    }
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let onExit = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    };
    let onError = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve();
      }
    };
    function cleanup() {
      if (timer) {
        clearTimeout(timer);
      }
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    }
    child.once('exit', onExit);
    child.once('error', onError);
    timer = setTimeout(() => {
      if (!settled) {
        child.kill('SIGTERM');
      }
    }, 5_000);
    child.kill(signal);
  });
}

// The isolated realm is fairly expensive to test with. Please use your best
// judgement to decide if your test really merits an isolated realm for testing
// or if a mock would be more suitable.

export async function startPrerenderServer(
  options?: PrerenderServerConfig,
): Promise<RunningPrerenderServer> {
  let port = await findAvailablePort(options?.port ?? DEFAULT_PRERENDER_PORT);
  let url = `http://localhost:${port}`;
  let env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    NODE_NO_WARNINGS: '1',
    // The mkcert leaf for the isolated stack covers `*.localhost`, but
    // Node's `tls.checkServerIdentity` hardcodes-disallows wildcard
    // matching against TLDs (it treats `localhost` as a TLD per RFC
    // 6125 strict interpretation), so worker fetches to
    // `https://publish-realm-XXX.localhost:4205/...` fail with
    // ERR_TLS_CERT_ALTNAME_INVALID. Relax cert validation in the
    // harness's spawned Node children — the wire is loopback only and
    // the cert is still being validated end-to-end against the mkcert
    // root via NODE_EXTRA_CA_CERTS, just without strict SAN matching
    // on subdomains.
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    // vite preview always serves HTTPS on :4200 in this harness
    // (vite.config.mjs reads the mkcert leaf, which mise activates via
    // infra:ensure-dev-cert before boot). Hardcode the canonical here
    // rather than reading process.env.HOST_URL — a shell that
    // mise-activated before the cert existed leaks a stale http://...
    // value and sends the prerender to a port that doesn't speak HTTP.
    BOXEL_HOST_URL: 'https://localhost:4200',
    LOG_LEVELS:
      process.env.TEST_HARNESS_PRERENDER_LOG_LEVELS ?? process.env.LOG_LEVELS,
    // One prerender server is shared by both Playwright workers
    // (fullyParallel) for the whole shard. With the pool size unset it
    // collapses to a fixed 4 tabs, which the shard's concurrent publish +
    // index work can exhaust — the pool thrashes (`standby refill failed
    // to produce a fresh tab`, cross-affinity steals) and realm-server
    // requests stall, surfacing as 60s page.goto / _publish-realm
    // timeouts. Enable the dynamic envelope: keep a 4-tab idle floor (no
    // extra baseline memory) but let it burst to 8 under load.
    PRERENDER_PAGE_POOL_MIN: process.env.PRERENDER_PAGE_POOL_MIN ?? '4',
    PRERENDER_PAGE_POOL_MAX: process.env.PRERENDER_PAGE_POOL_MAX ?? '8',
  };
  let prerenderArgs = ['prerender/prerender-server.ts', `--port=${port}`];

  let child = spawn('node', prerenderArgs, {
    cwd: realmServerDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });

  child.stdout?.on('data', (data: Buffer) =>
    console.log(`prerender: ${data.toString()}`),
  );
  child.stderr?.on('data', (data: Buffer) =>
    console.error(`prerender: ${data.toString()}`),
  );

  let exitListener:
    | ((code: number | null, signal: NodeJS.Signals | null) => void)
    | undefined;
  let errorListener: ((err: Error) => void) | undefined;

  const exitPromise = new Promise<never>((_, reject) => {
    exitListener = (code: number | null, signal: NodeJS.Signals | null) => {
      reject(
        new Error(
          `prerender server exited before it became ready (code: ${code}, signal: ${signal})`,
        ),
      );
    };
    errorListener = (err: Error) => {
      reject(err);
    };
    child.once('exit', exitListener);
    child.once('error', errorListener);
  });

  try {
    await Promise.race([waitForHttpReady(url, 60_000), exitPromise]);
  } finally {
    if (exitListener) {
      child.removeListener('exit', exitListener);
    }
    if (errorListener) {
      child.removeListener('error', errorListener);
    }
  }

  return {
    port,
    url,
    async stop() {
      await stopChildProcess(child);
    },
  };
}

export async function startServer({
  synapse,
  prerenderURL,
}: StartRealmServerOptions) {
  let dir = dirSync();
  let testRealmDir = join(dir.name, 'test');
  ensureDirSync(testRealmDir);
  copySync(testRealmCards, testRealmDir);

  let testDBName = `test_db_${Math.floor(10000000 * Math.random())}`;
  let workerManagerPort = await findAvailablePort(4232);
  let workerManagerReadyTimeoutMs = parseTimeoutMs(
    process.env.TEST_HARNESS_WORKER_MANAGER_READY_TIMEOUT_MS,
    DEFAULT_WORKER_MANAGER_READY_TIMEOUT_MS,
  );
  let workerStartTimeoutMs = parseTimeoutMs(
    process.env.TEST_HARNESS_WORKER_START_TIMEOUT_MS,
    DEFAULT_WORKER_START_TIMEOUT_MS,
  );
  let realmServerStartTimeoutMs = parseTimeoutMs(
    process.env.TEST_HARNESS_REALM_SERVER_START_TIMEOUT_MS,
    DEFAULT_REALM_SERVER_START_TIMEOUT_MS,
  );
  let realmServerProgressIdleTimeoutMs = parseTimeoutMs(
    process.env.TEST_HARNESS_REALM_SERVER_PROGRESS_IDLE_TIMEOUT_MS,
    DEFAULT_REALM_SERVER_PROGRESS_IDLE_TIMEOUT_MS,
  );
  let realmServerIndexReadyTimeoutMs = parseTimeoutMs(
    process.env.TEST_HARNESS_REALM_SERVER_INDEX_READY_TIMEOUT_MS,
    DEFAULT_REALM_SERVER_INDEX_READY_TIMEOUT_MS,
  );
  let workerManagerMetadataFile = join(
    dir.name,
    'worker-manager-metadata.json',
  );
  let realmServerMetadataFile = join(dir.name, 'realm-server-metadata.json');
  let workerManagerOutput: string[] = [];
  let realmServerOutput: string[] = [];
  let realmServer: ReturnType<typeof spawn> | undefined;

  // Liveness signal for the boot-stall watchdog in the realm-server-ready
  // wait below. Bumped by the worker's per-file indexing-progress events and
  // by realm-server lifecycle output (boot, request log during indexing,
  // post-index "serving realms"), which together cover every boot phase.
  let lastBootProgressAt = Date.now();
  let noteBootProgress = () => {
    lastBootProgressAt = Date.now();
  };

  process.env.PGPORT = '5435';
  process.env.PGDATABASE = testDBName;
  process.env.NODE_NO_WARNINGS = '1';
  process.env.REALM_SERVER_SECRET_SEED = "mum's the word";
  process.env.REALM_SECRET_SEED = "shhh! it's a secret";
  process.env.GRAFANA_SECRET = "shhh! it's a secret";
  let matrixURL = `http://localhost:${synapse.port}`;
  process.env.MATRIX_URL = matrixURL;
  process.env.REALM_SERVER_MATRIX_USERNAME = 'realm_server';
  process.env.NODE_ENV = 'test';
  process.env.LOW_CREDIT_THRESHOLD = '2000';

  let workerArgs = [
    'worker-manager.ts',
    `--port=${workerManagerPort}`,
    `--matrixURL='${matrixURL}'`,
    `--prerendererUrl='${prerenderURL}'`,
    `--migrateDB`,
    // Production parity for the worker tiers: a dedicated high-priority
    // worker (floor 9) serves user-initiated jobs — a test's createRealm
    // indexing (priority 10) and its spawned prerender-html (9) — while the
    // all-priority worker digests system-tier work. Without it, the lone
    // all-priority worker claims jobs oldest-first regardless of priority,
    // so the boot realms' system prerender-html jobs (which include the
    // realm-wide module pre-warm sweep, minutes of work on a loaded runner)
    // hold the only worker while the first tests' createRealm index jobs sit
    // queued past their 30s provisioning wait.
    `--highPriorityCount=1`,

    `--fromUrl='https://localhost:4205/test/'`,
    `--toUrl='https://localhost:4205/test/'`,
  ];
  workerArgs = workerArgs.concat([
    `--fromUrl='@cardstack/skills/'`,
    `--toUrl='https://localhost:4205/skills/'`,
  ]);
  workerArgs = workerArgs.concat([
    `--fromUrl='https://cardstack.com/base/'`,
    `--toUrl='https://localhost:4205/base/'`,
  ]);

  let workerManager = spawn('node', workerArgs, {
    cwd: realmServerDir,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      // See the prerender spawn above for why this is needed (Node's
      // `tls.checkServerIdentity` doesn't honor `*.localhost` wildcard
      // SANs, so publish-realm subdomain fetches from the spawned
      // worker fail with ERR_TLS_CERT_ALTNAME_INVALID).
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      TEST_HARNESS_WORKER_START_TIMEOUT_MS: String(workerStartTimeoutMs),
      TEST_HARNESS_WORKER_MANAGER_METADATA_FILE: workerManagerMetadataFile,
    },
  });
  if (workerManager.stdout) {
    workerManager.stdout.on('data', (data: Buffer) => {
      let text = data.toString();
      pushOutputTail(workerManagerOutput, 'stdout: ', data);
      console.log(`worker: ${text}`);
      // Each indexed file emits an `[indexing-progress]` line — the forward-
      // progress heartbeat the boot-stall watchdog keys on.
      if (text.includes('[indexing-progress]')) {
        noteBootProgress();
      }
    });
  }
  if (workerManager.stderr) {
    workerManager.stderr.on('data', (data: Buffer) => {
      pushOutputTail(workerManagerOutput, 'stderr: ', data);
      console.error(`worker: ${data.toString()}`);
    });
  }

  let workerManagerExitListener:
    | ((code: number | null, signal: NodeJS.Signals | null) => void)
    | undefined;
  let workerManagerErrorListener: ((err: Error) => void) | undefined;
  let workerManagerExitPromise = new Promise<never>((_, reject) => {
    workerManagerExitListener = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      reject(
        new Error(
          `worker manager exited before it became ready (code: ${code}, signal: ${signal})`,
        ),
      );
    };
    workerManagerErrorListener = (err: Error) => reject(err);
    workerManager.once('exit', workerManagerExitListener);
    workerManager.once('error', workerManagerErrorListener);
  });

  let startupDiagnostics = () => ({
    realmPath: testRealmDir,
    database: testDBName,
    workerManagerPort,
    workerManagerReadyTimeoutMs,
    workerStartTimeoutMs,
    realmServerStartTimeoutMs,
    realmServerProgressIdleTimeoutMs,
    lastBootProgressMsAgo: Date.now() - lastBootProgressAt,
    workerManagerState: describeChildProcess(workerManager),
    realmServerState: describeChildProcess(realmServer),
    workerManagerMetadata: readMetadataFile(workerManagerMetadataFile),
    realmServerMetadata: readMetadataFile(realmServerMetadataFile),
    workerManagerOutputTail: workerManagerOutput,
    realmServerOutputTail: realmServerOutput,
  });

  try {
    await Promise.race([
      waitForHttpReady(
        `http://localhost:${workerManagerPort}`,
        workerManagerReadyTimeoutMs,
      ),
      workerManagerExitPromise,
    ]);
  } catch (error) {
    await stopChildProcess(workerManager);
    throw buildStartupFailure(error, startupDiagnostics());
  } finally {
    if (workerManagerExitListener) {
      workerManager.removeListener('exit', workerManagerExitListener);
    }
    if (workerManagerErrorListener) {
      workerManager.removeListener('error', workerManagerErrorListener);
    }
  }

  let serverArgs = [
    'main.ts',
    `--port=4205`,
    `--matrixURL='${matrixURL}'`,
    `--realmsRootPath='${dir.name}'`,
    `--workerManagerPort=${workerManagerPort}`,
    `--prerendererUrl="${prerenderURL}"`,
    `--useRegistrationSecretFunction`,

    `--path='${testRealmDir}'`,
    `--username='test_realm'`,
    `--fromUrl='https://localhost:4205/test/'`,
    `--toUrl='https://localhost:4205/test/'`,
  ];
  serverArgs = serverArgs.concat([
    `--username='skills_realm'`,
    `--path='${skillsRealmDir}'`,
    `--fromUrl='@cardstack/skills/'`,
    `--toUrl='https://localhost:4205/skills/'`,
  ]);
  serverArgs = serverArgs.concat([
    `--username='base_realm'`,
    `--path='${baseRealmDir}'`,
    `--fromUrl='https://cardstack.com/base/'`,
    `--toUrl='https://localhost:4205/base/'`,
  ]);

  console.log(`realm server database: ${testDBName}`);

  realmServer = spawn('node', serverArgs, {
    cwd: realmServerDir,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      // See the prerender spawn for why this is needed (Node's
      // `tls.checkServerIdentity` doesn't honor `*.localhost` wildcard
      // SANs, so publish-realm subdomain fetches from the spawned
      // realm-server fail with ERR_TLS_CERT_ALTNAME_INVALID).
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      // Override HOST_URL explicitly: main.ts reads it as `distURL` (the
      // URL the realm-server fetches index.html from at boot). A stale
      // HOST_URL=http leaking in from a shell that mise-activated before
      // the cert existed would land the boot fetch on a port that doesn't
      // speak HTTP, and the realm-server would exit -2 before any test
      // can run. The harness boots vite preview as HTTPS on :4200.
      HOST_URL: 'https://localhost:4200',
      // Matrix tests don't exercise GitHub PR creation, so disable that route
      // to avoid pulling Octokit into the realm server startup path.
      DISABLE_GITHUB_PR_ROUTE: 'true',
      PUBLISHED_REALM_BOXEL_SPACE_DOMAIN: 'localhost:4205',
      PUBLISHED_REALM_BOXEL_SITE_DOMAIN: 'localhost:4205',
      TEST_HARNESS_REALM_SERVER_METADATA_FILE: realmServerMetadataFile,
    },
  });
  realmServer.unref();
  if (realmServer.stdout) {
    realmServer.stdout.on('data', (data: Buffer) => {
      pushOutputTail(realmServerOutput, 'stdout: ', data);
      console.log(`realm server: ${data.toString()}`);
      // Covers the boot phases the worker's indexing-progress stream doesn't:
      // pre-index startup and post-index listener setup before `ready`.
      noteBootProgress();
    });
  }
  if (realmServer.stderr) {
    realmServer.stderr.on('data', (data: Buffer) => {
      pushOutputTail(realmServerOutput, 'stderr: ', data);
      console.error(`realm server: ${data.toString()}`);
    });
  }
  realmServer.on('message', (message) => {
    if (message === 'get-registration-secret' && realmServer.send) {
      let secret = readFileSync(
        join(matrixDir, 'registration_secret.txt'),
        'utf8',
      );
      realmServer.send(`registration-secret:${secret}`);
    }
  });

  let realmServerExitListener:
    | ((code: number | null, signal: NodeJS.Signals | null) => void)
    | undefined;
  let realmServerErrorListener: ((err: Error) => void) | undefined;
  let realmServerReadyListener: ((message: unknown) => void) | undefined;
  let realmServerStartTimeout: NodeJS.Timeout | undefined;

  // Measure the idle window from the moment the wait begins, regardless of
  // any time the worker-manager-ready wait above consumed.
  noteBootProgress();
  try {
    await Promise.race([
      new Promise<void>((resolve) => {
        let onRealmServerReady = (message: unknown) => {
          if (message === 'ready') {
            realmServer.off('message', onRealmServerReady);
            resolve();
          }
        };
        realmServerReadyListener = onRealmServerReady;
        realmServer.on('message', onRealmServerReady);
      }),
      new Promise<never>((_, reject) => {
        realmServerExitListener = (
          code: number | null,
          signal: NodeJS.Signals | null,
        ) => {
          reject(
            new Error(
              `realm server exited before it became ready (code: ${code}, signal: ${signal})`,
            ),
          );
        };
        realmServerErrorListener = (err: Error) => reject(err);
        realmServer.once('exit', realmServerExitListener);
        realmServer.once('error', realmServerErrorListener);
      }),
      new Promise<never>((_, reject) => {
        let startedAt = Date.now();
        realmServerStartTimeout = setInterval(() => {
          let now = Date.now();
          let sinceProgressMs = now - lastBootProgressAt;
          let sinceStartMs = now - startedAt;
          if (sinceProgressMs >= realmServerProgressIdleTimeoutMs) {
            reject(
              new Error(
                `realm server boot stalled: no startup progress for ` +
                  `${sinceProgressMs}ms (idle timeout ` +
                  `${realmServerProgressIdleTimeoutMs}ms). Stopping server`,
              ),
            );
          } else if (sinceStartMs >= realmServerStartTimeoutMs) {
            reject(
              new Error(
                `timed-out waiting for realm server to start after ` +
                  `${realmServerStartTimeoutMs}ms (absolute cap; last ` +
                  `progress ${sinceProgressMs}ms ago). Stopping server`,
              ),
            );
          }
        }, REALM_SERVER_PROGRESS_POLL_MS);
        realmServerStartTimeout.unref();
      }),
    ]);
  } catch (error) {
    await Promise.all([
      stopChildProcess(realmServer),
      stopChildProcess(workerManager),
    ]);
    throw buildStartupFailure(error, startupDiagnostics());
  } finally {
    if (realmServerExitListener) {
      realmServer.removeListener('exit', realmServerExitListener);
    }
    if (realmServerErrorListener) {
      realmServer.removeListener('error', realmServerErrorListener);
    }
    if (realmServerReadyListener) {
      realmServer.removeListener('message', realmServerReadyListener);
    }
    if (realmServerStartTimeout) {
      clearInterval(realmServerStartTimeout);
    }
  }

  // `ready` above only means the realm server is listening with its realms
  // mounted — the boot-time from-scratch index of those realms (test + skills +
  // base, ~600 files) is still running on the single indexing worker. Any realm
  // a test creates while that boot index is in flight queues behind it, so its
  // `_create-realm` can take 30-100s to return and blows the per-test
  // create-workspace waits (and cascades into publish/registration test
  // timeouts). Gate the harness on each mounted realm's `_readiness-check` — a
  // public probe that resolves only once the realm's indexing settles — so no
  // test starts until the boot index is actually done. base is last (largest),
  // so it dominates the wait; the others return promptly.
  let bootIndexStart = Date.now();
  try {
    for (let realmURL of [
      'https://localhost:4205/test/',
      'https://localhost:4205/skills/',
      'https://localhost:4205/base/',
    ]) {
      await waitForRealmIndexed(
        `${realmURL}_readiness-check`,
        realmServerIndexReadyTimeoutMs,
      );
    }
  } catch (error) {
    await Promise.all([
      stopChildProcess(realmServer),
      stopChildProcess(workerManager),
    ]);
    throw buildStartupFailure(error, startupDiagnostics());
  }
  console.log(
    `realm server: boot index settled ${Date.now() - bootIndexStart}ms after ` +
      `ready (gated on _readiness-check before starting tests)`,
  );

  let server = new IsolatedRealmServer(
    realmServer,
    workerManager,
    testRealmDir,
    testDBName,
  );

  // /_catalog-realms only surfaces realms with show_as_catalog = true.
  // Matrix tests treat the test fixture realm and the skills realm as
  // catalogs (workspace chooser, card-chooser modal); opt them in here
  // so the harness doesn't depend on a sidecar value that the
  // metadata backfill trims on first boot.
  await server.executeSQL(
    `INSERT INTO realm_metadata (url, show_as_catalog) VALUES
       ('https://localhost:4205/test/', true),
       ('https://localhost:4205/skills/', true)
     ON CONFLICT (url) DO UPDATE SET show_as_catalog = true`,
  );

  return server;
}

export interface SQLExecutor {
  executeSQL(sql: string): Promise<Record<string, any>[]>;
}

export class BasicSQLExecutor implements SQLExecutor {
  pool: Pool;
  readonly db: string;
  constructor(db: string) {
    this.db = db;
    this.pool = new Pool({
      host: 'localhost',
      port: 5435,
      user: 'postgres',
      password: '', // trust auth, so no password needed
      database: db, // default database to connect to
    });
  }
  async executeSQL(sql: string) {
    const client = await this.pool.connect();
    try {
      let { rows } = await client.query(sql);
      return rows;
    } finally {
      client.release();
    }
  }
}

export class IsolatedRealmServer implements SQLExecutor {
  private realmServerStopped: (() => void) | undefined;
  private workerManagerStopped: (() => void) | undefined;
  private sqlResults: ((results: string) => void) | undefined;
  private sqlError: ((error: string) => void) | undefined;
  private realmServerProcess: ReturnType<typeof spawn>;
  private workerManagerProcess: ReturnType<typeof spawn>;
  readonly realmPath: string; // useful for debugging
  readonly db: string;

  constructor(
    realmServerProcess: ReturnType<typeof spawn>,
    workerManagerProcess: ReturnType<typeof spawn>,
    realmPath: string,
    db: string,
  ) {
    this.realmServerProcess = realmServerProcess;
    this.workerManagerProcess = workerManagerProcess;
    this.realmPath = realmPath;
    this.db = db;
    workerManagerProcess.on('message', (message) => {
      if (message === 'stopped') {
        if (!this.workerManagerStopped) {
          console.error(`received unprompted worker manager stop`);
          return;
        }
        this.workerManagerStopped();
      }
    });
    realmServerProcess.on('message', (message) => {
      if (message === 'stopped') {
        if (!this.realmServerStopped) {
          console.error(`received unprompted server stop`);
          return;
        }
        this.realmServerStopped();
      } else if (
        typeof message === 'string' &&
        message.startsWith('sql-results:')
      ) {
        let results = message.substring('sql-results:'.length);
        if (!this.sqlResults) {
          console.error(`received unprompted SQL: ${results}`);
          return;
        }
        this.sqlResults(results);
      } else if (
        typeof message === 'string' &&
        message.startsWith('sql-error:')
      ) {
        let error = message.substring('sql-error:'.length);
        if (!this.sqlError) {
          console.error(`received unprompted SQL error: ${error}`);
          return;
        }
        this.sqlError(error);
      }
    });
  }

  async executeSQL(sql: string): Promise<Record<string, any>[]> {
    let execute = new Promise<string>(
      (resolve, reject: (reason: string) => void) => {
        this.sqlResults = resolve;
        this.sqlError = reject;
      },
    );
    this.realmServerProcess.send(`execute-sql:${sql}`);
    let resultsStr = await execute;
    this.sqlResults = undefined;
    this.sqlError = undefined;
    return JSON.parse(resultsStr);
  }

  async stop() {
    let realmServerStop = new Promise<void>(
      (r) => (this.realmServerStopped = r),
    );
    this.realmServerProcess.send('stop');
    await realmServerStop;
    this.realmServerStopped = undefined;
    this.realmServerProcess.send('kill');

    let workerManagerStop = new Promise<void>(
      (r) => (this.workerManagerStopped = r),
    );
    this.workerManagerProcess.send('stop');
    await workerManagerStop;
    this.workerManagerStopped = undefined;
    this.workerManagerProcess.send('kill');
  }
}
