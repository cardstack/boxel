import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import fsExtra from 'fs-extra';
import { spawn } from 'node:child_process';

import {
  baseRealmDir,
  baseRealmURLFor,
  captureProcessLogs,
  createProcessExitPromise,
  DEFAULT_MATRIX_SERVER_USERNAME,
  DEFAULT_PG_HOST,
  DEFAULT_PG_POOL_MAX,
  DEFAULT_PG_PORT,
  DEFAULT_PG_USER,
  DEFAULT_REALM_LOG_LEVELS,
  diagnosePortConflict,
  findAndHoldAvailablePort,
  FIXTURE_REALM_SERVER_URL_PLACEHOLDER,
  FULL_INDEX_REALM_STARTUP_TIMEOUT_MS,
  INCLUDE_SKILLS,
  managedProcessStdio,
  realmLog,
  realmServerDir,
  realmURLWithinServer,
  REALM_SECRET_SEED,
  REALM_SERVER_SECRET_SEED,
  shouldIgnoreFixturePath,
  skillsRealmDir,
  skillsRealmURLFor,
  GRAFANA_SECRET,
  waitForJsonFile,
  waitForReady,
  withPort,
  DEFAULT_REALM_STARTUP_TIMEOUT_MS,
  stopManagedProcess,
  type FactorySupportContext,
  type PortReservation,
  type RealmConfig,
  type RunningFactoryStack,
  type SpawnedProcess,
  type StartedCompatRealmProxy,
} from './shared';
import { startHarnessPrerenderServer } from './support-services';

const { copySync, ensureDirSync } = fsExtra;

type ResolvedPortReservation = {
  port: number;
  /**
   * Closes any holder socket we (or the caller) bound to keep this port
   * exclusive. Call this immediately before spawning the child that will
   * bind the port. Idempotent — calling it twice is a no-op.
   */
  releaseHolder(): Promise<void>;
};

async function resolvePortReservation(
  passed: number | PortReservation | undefined,
): Promise<ResolvedPortReservation> {
  if (passed == null || passed === 0) {
    let reservation = await findAndHoldAvailablePort();
    // Wrap so a future PortReservation implementation that binds `this`
    // inside `release()` still gets called with its own receiver.
    return {
      port: reservation.port,
      releaseHolder: () => reservation.release(),
    };
  }
  if (typeof passed === 'number') {
    // Caller supplied an explicit port number. They are responsible for
    // any pre-binding it may need; we don't hold it ourselves.
    return { port: passed, releaseHolder: async () => {} };
  }
  // Caller supplied a PortReservation — we own releasing it at spawn time.
  return { port: passed.port, releaseHolder: () => passed.release() };
}

// Recognize the EADDRINUSE failure we want to retry. The child's stderr
// from Node's `listen()` error path contains both the error code and
// the port number, e.g. `Error: listen EADDRINUSE: address already in
// use :::34301`. We match on either substring AND the port we just
// tried, so an unrelated EADDRINUSE deeper in the realm-server's
// startup doesn't trigger a misleading retry.
function looksLikePortBindFailure(
  error: unknown,
  logs: string,
  port: number,
): boolean {
  let combined = `${logs}\n${error instanceof Error ? error.message : String(error)}`;
  if (!combined.includes('EADDRINUSE')) {
    return false;
  }
  return combined.includes(`:${port}`) || combined.includes(`port: ${port}`);
}

async function readIncomingRequestBody(
  req: IncomingMessage,
): Promise<Buffer | undefined> {
  let chunks: Buffer[] = [];
  for await (let chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function describeCompatProxyError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  let parts: string[] = [];
  let current: unknown = error;

  while (current) {
    if (current instanceof Error) {
      let code =
        'code' in current && typeof current.code === 'string'
          ? ` (${current.code})`
          : '';
      parts.push(`${current.message}${code}`);
      // Standard Error.cause (ES2022 — typed inline so consumers using an
      // older `lib` don't need to widen their tsconfig to consume the
      // harness types).
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }

  return parts.join(' <- ');
}

// Snapshot the upstream realm-server's state for a compat-proxy give-up
// 502 body. Liveness comes straight off the child handle's
// exitCode/signalCode; `recordedExit` is what the harness's own exit
// listener saw (covers the clean SIGTERM/SIGINT teardown the listener
// stays quiet about). Tails the buffered output so the body stays bounded
// when it rides out in the prerender's captured render error.
function describeRealmServerHealth(
  realmServer: { exitCode: number | null; signalCode: NodeJS.Signals | null },
  recordedExit: { code: number | null; signal: string | null } | null,
  getServerLogs: () => string,
): string {
  let alive = realmServer.exitCode === null && realmServer.signalCode === null;
  let state = alive
    ? 'alive but not answering (process up, port refused/unresponsive)'
    : `exited (exitCode=${realmServer.exitCode ?? recordedExit?.code ?? 'null'}, signal=${
        realmServer.signalCode ?? recordedExit?.signal ?? 'null'
      })`;
  let logs = getServerLogs();
  let tail = logs ? tailChars(logs, 4000) : '<no buffered output>';
  return `upstream realm-server health: ${state}\nupstream realm-server recent output:\n${tail}`;
}

// Keep only the last `max` characters, trimmed to a line boundary so the
// snapshot doesn't start mid-line.
function tailChars(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  let tail = text.slice(text.length - max);
  let newline = tail.indexOf('\n');
  return `…${newline >= 0 ? tail.slice(newline + 1) : tail}`;
}

// Connection-phase upstream failure codes worth retrying. The
// realm-server this proxy fronts is torn down and restarted on a stable
// port between tests, so a render's module fetch can land in the brief
// window where the port has no listener (ECONNREFUSED) or isn't
// resolvable yet. These errors happen before any request bytes reach the
// server, so retrying is side-effect-free for every HTTP method.
const RETRYABLE_CONNECT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);
// A reset or broken pipe can surface after the request was already
// written, so only retry these for methods with no server-side effect.
const RETRYABLE_IDEMPOTENT_CODES = new Set(['ECONNRESET', 'EPIPE']);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// ~2.1s total across the retries — long enough to ride out a realm-server
// restart's bind gap, short enough not to stall an in-flight render.
const UPSTREAM_RETRY_BACKOFF_MS = [50, 150, 300, 600, 1000];

function connectErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    let code = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function isRetryableUpstreamError(error: unknown, method: string): boolean {
  let code = connectErrorCode(error);
  if (!code) {
    return false;
  }
  if (RETRYABLE_CONNECT_CODES.has(code)) {
    return true;
  }
  return IDEMPOTENT_METHODS.has(method) && RETRYABLE_IDEMPOTENT_CODES.has(code);
}

// Retries connection-phase failures with a bounded backoff before letting
// the error propagate to the proxy's 502 handler. On give-up it annotates
// the error with the attempt count and elapsed time so the 502 body can
// report them — the realm child's logs are buffered out of CI output,
// while the 502 body surfaces in the prerender's captured render error.
async function fetchUpstreamWithRetry(
  upstreamURL: URL,
  init: RequestInit,
  method: string,
): Promise<Response> {
  let signal = init.signal ?? undefined;
  let startedAt = Date.now();
  let attempt = 0;
  for (;;) {
    try {
      return await fetch(upstreamURL, init);
    } catch (error) {
      // Once the proxy is stopping its abort signal fires; never retry then.
      // The retry loop is what keeps the proxy's connections alive against a
      // torn-down upstream, blocking `server.close()` and the realm stack's
      // teardown — so a shutdown must short-circuit it immediately.
      let canRetry =
        !signal?.aborted &&
        attempt < UPSTREAM_RETRY_BACKOFF_MS.length &&
        isRetryableUpstreamError(error, method);
      if (!canRetry) {
        if (error instanceof Error) {
          let annotated = error as Error & {
            compatProxyAttempts?: number;
            compatProxyElapsedMs?: number;
          };
          annotated.compatProxyAttempts = attempt + 1;
          annotated.compatProxyElapsedMs = Date.now() - startedAt;
        }
        throw error;
      }
      let delay = UPSTREAM_RETRY_BACKOFF_MS[attempt];
      realmLog.info(
        `startCompatRealmProxy: retrying upstream fetch to ${upstreamURL.href} ` +
          `(attempt ${attempt + 1}, code=${connectErrorCode(error)}) after ${delay}ms`,
      );
      attempt++;
      // Abortable backoff: a shutdown mid-sleep wakes immediately so the
      // next iteration sees the aborted signal and bails.
      await new Promise<void>((resolve) => {
        let t = setTimeout(resolve, delay);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true },
        );
      });
    }
  }
}

async function startCompatRealmProxy({
  listenPort,
}: {
  listenPort: number;
}): Promise<StartedCompatRealmProxy> {
  realmLog.debug(`startCompatRealmProxy: requested listenPort=${listenPort}`);
  let targetPort: number | undefined;
  // Set alongside the target port: returns a one-shot snapshot of the
  // upstream realm-server child's liveness and recent buffered output. The
  // child's stdout/stderr are otherwise only flushed to CI on an
  // unexpected exit, so when the upstream stops answering while the proxy
  // is up (the ECONNREFUSED-mid-render flake) the give-up 502 body is the
  // only place that state reaches CI — it rides out in the prerender's
  // captured render error.
  let describeUpstreamHealth: (() => string) | undefined;
  // Flipped by `stop()`. The signal aborts in-flight upstream fetches (and
  // their retry backoff); the flag refuses new requests. Together they let
  // `server.close()` resolve promptly instead of waiting on retry loops
  // against a torn-down upstream — the thing that otherwise wedges realm
  // stack teardown and stalls the next test's bring-up.
  let stopping = false;
  let stopAbort = new AbortController();
  let actualListenPort = listenPort;
  let server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      if (stopping) {
        res.statusCode = 503;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end('software-factory compat proxy stopping');
        return;
      }
      if (targetPort == null) {
        res.statusCode = 503;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end('software-factory compat proxy target is not ready');
        return;
      }
      let incomingURL = new URL(
        req.url ?? '/',
        `${
          req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
        }://${req.headers.host ?? `127.0.0.1:${actualListenPort}`}`,
      );
      let upstreamURL = new URL(
        `${incomingURL.pathname}${incomingURL.search}`,
        `http://localhost:${targetPort}`,
      );

      try {
        let body = await readIncomingRequestBody(req);
        let headers = Object.fromEntries(
          Object.entries(req.headers).filter(
            ([key]) => key.toLowerCase() !== 'host',
          ),
        ) as Record<string, string>;
        headers['x-boxel-forwarded-url'] = incomingURL.href;
        let response = await fetchUpstreamWithRetry(
          upstreamURL,
          {
            method: req.method,
            headers,
            body: body as BodyInit | undefined,
            redirect: 'manual',
            signal: stopAbort.signal,
          },
          req.method ?? 'GET',
        );

        let responseHeaders = new Headers(response.headers);
        let location = responseHeaders.get('location');
        if (location) {
          responseHeaders.set(
            'location',
            location
              .replace(
                `http://localhost:${targetPort}/`,
                `http://127.0.0.1:${listenPort}/`,
              )
              .replace(
                `http://localhost:${targetPort}/`,
                `http://localhost:${listenPort}/`,
              ),
          );
        }

        res.statusCode = response.status;
        responseHeaders.forEach((value, key) => {
          res.setHeader(key, value);
        });
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        let description = describeCompatProxyError(error);
        let annotated = error as {
          compatProxyAttempts?: number;
          compatProxyElapsedMs?: number;
        };
        let suffix =
          annotated?.compatProxyAttempts != null
            ? ` after ${annotated.compatProxyAttempts} attempt(s) over ${annotated.compatProxyElapsedMs}ms`
            : '';
        let health = describeUpstreamHealth?.() ?? '';
        realmLog.warn(
          `startCompatRealmProxy: upstream fetch failed for ${upstreamURL.href}${suffix}: ${description}`,
        );
        res.statusCode = 502;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(
          `software-factory compat proxy failed for ${upstreamURL.href}${suffix}: ${description}` +
            (health ? `\n${health}` : ''),
        );
      }
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => resolve());
  });
  let address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to determine compat proxy port');
  }
  actualListenPort = address.port;
  realmLog.debug(`startCompatRealmProxy: listening on ${actualListenPort}`);
  return {
    listenPort: actualListenPort,
    setTargetPort(nextTargetPort: number, nextDescribeUpstreamHealth) {
      targetPort = nextTargetPort;
      describeUpstreamHealth = nextDescribeUpstreamHealth;
      realmLog.debug(
        `startCompatRealmProxy: ${actualListenPort} -> ${nextTargetPort} ready`,
      );
    },
    async stop() {
      realmLog.debug(
        `startCompatRealmProxy: ${actualListenPort} -> ${targetPort ?? 'unset'} stopping`,
      );
      // Refuse new requests, abort in-flight upstream fetches + their retry
      // backoff, and force-close any keep-alive sockets so `server.close()`
      // can't hang on a request looping against a dead upstream.
      stopping = true;
      stopAbort.abort();
      (server as { closeAllConnections?: () => void }).closeAllConnections?.();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

function rewriteFixtureSourceModuleUrls(
  destination: string,
  realmServerURL: URL,
): void {
  let rewrittenFiles = 0;

  function visit(currentDir: string) {
    for (let entry of readdirSync(currentDir, { withFileTypes: true })) {
      let absolutePath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      let contents = readFileSync(absolutePath, 'utf8');
      if (!contents.includes(FIXTURE_REALM_SERVER_URL_PLACEHOLDER)) {
        continue;
      }

      writeFileSync(
        absolutePath,
        contents
          .split(FIXTURE_REALM_SERVER_URL_PLACEHOLDER)
          .join(realmServerURL.href),
      );
      rewrittenFiles++;
    }
  }

  visit(destination);
  if (rewrittenFiles > 0) {
    realmLog.debug(
      `rewriteFixtureSourceModuleUrls: rewrote ${rewrittenFiles} files to ${realmServerURL.href}`,
    );
  }
}

function copyRealmFixture(
  realmDir: string,
  destination: string,
  realmServerURL: URL,
  options?: { fileFilter?: (relativePath: string) => boolean },
): void {
  // Resolve symlinks so copySync sees the real directory, not the symlink itself.
  let resolvedDir = realpathSync(realmDir);
  copySync(resolvedDir, destination, {
    preserveTimestamps: true,
    filter(src) {
      let relativePath = relative(resolvedDir, src).replace(/\\/g, '/');
      if (relativePath !== '' && shouldIgnoreFixturePath(relativePath)) {
        return false;
      }
      if (
        relativePath !== '' &&
        options?.fileFilter &&
        !options.fileFilter(relativePath)
      ) {
        return false;
      }
      return true;
    },
  });
  rewriteFixtureSourceModuleUrls(destination, realmServerURL);
}

export async function startIsolatedRealmStack({
  realms,
  realmServerURL,
  databaseName,
  context,
  migrateDB,
  fullIndexOnStartup,
  workerManagerPort: explicitWorkerManagerPort,
  realmServerPort: explicitRealmServerPort,
  prerenderURL: explicitPrerenderURL,
}: {
  realms: RealmConfig[];
  realmServerURL: URL;
  databaseName: string;
  context: FactorySupportContext;
  migrateDB: boolean;
  fullIndexOnStartup: boolean;
  /** When provided, the worker-manager will listen on this port instead of
   *  picking one dynamically. This lets callers know the port upfront (e.g.
   *  for progress monitoring via /_indexing-status). Pass a `PortReservation`
   *  (from `findAndHoldAvailablePort()`) when the caller pre-allocated the
   *  port so we can release the holder socket at the exact moment the
   *  worker-manager child is about to bind. */
  workerManagerPort?: number | PortReservation;
  /** When provided, the realm-server will listen on this port instead of
   *  picking one dynamically. Same `PortReservation` handoff as above. */
  realmServerPort?: number | PortReservation;
  /** When provided, reuse this existing prerender server URL instead of
   *  starting a new one. The Playwright harness keeps prerender alive for
   *  the lifetime of a testWorker and passes its URL here. */
  prerenderURL?: string;
}): Promise<RunningFactoryStack> {
  if (realms.length === 0) {
    throw new Error('startIsolatedRealmStack requires at least one realm');
  }
  let rootDir = mkdtempSync(join(tmpdir(), 'software-factory-realms-'));
  let workerManagerMetadataFile = join(rootDir, 'worker-manager.runtime.json');
  let realmServerMetadataFile = join(rootDir, 'realm-server.runtime.json');

  // Hold the worker-manager and realm-server ports across the (multi-second)
  // gap between allocation and actual child bind. Without the hold, sibling
  // findAvailablePort() calls inside this same process — for the prerender
  // server, host serve, etc — can be handed back the same port number by
  // the OS port-0 allocator, and the child process eventually races us and
  // dies with EADDRINUSE.
  let workerManagerPortInfo = await resolvePortReservation(
    explicitWorkerManagerPort,
  );
  let realmServerPortInfo: ResolvedPortReservation;
  try {
    realmServerPortInfo = await resolvePortReservation(explicitRealmServerPort);
  } catch (error) {
    await workerManagerPortInfo.releaseHolder();
    throw error;
  }
  let actualWorkerManagerPort = workerManagerPortInfo.port;
  let actualRealmServerPort = realmServerPortInfo.port;
  // From this point on, any thrown error must release both port holders so
  // they don't leak until process exit. The releases are idempotent: the
  // happy path releases each holder just before its respective child is
  // spawned, and the cleanup below is a no-op for already-released holders.
  let releaseHoldersOnFailure = async () => {
    try {
      await workerManagerPortInfo.releaseHolder();
    } catch {
      // best effort
    }
    try {
      await realmServerPortInfo.releaseHolder();
    } catch {
      // best effort
    }
  };
  try {
    let actualRealmServerURL = withPort(realmServerURL, actualRealmServerPort);
    // The legacy realm-server URL is a stable backward-compat origin that
    // the harness exposes as a `--fromUrl`/`--toUrl` alias for each realm
    // it mounts. JSON fixtures or external code that still hardcodes
    // `http://localhost:4205/<path>/` keeps resolving even though every
    // stack actually binds to a dynamic port.
    let legacyRealmServerURL = new URL('http://localhost:4205/');
    let publicBaseRealmURL = baseRealmURLFor(realmServerURL);
    let actualBaseRealmURL = baseRealmURLFor(actualRealmServerURL);
    let skillsRealmURL = skillsRealmURLFor(realmServerURL);
    let actualSkillsRealmURL = skillsRealmURLFor(actualRealmServerURL);
    let legacySkillsRealmURL = skillsRealmURLFor(legacyRealmServerURL);

    let resolvedRealms: {
      config: RealmConfig;
      localDir: string;
      realmURL: URL;
      actualRealmURL: URL;
      legacyRealmURL: URL;
      username: string;
    }[] = [];
    for (let i = 0; i < realms.length; i++) {
      let config = realms[i];
      let localDir = join(rootDir, `realm-${i}`);
      let realmURL = realmURLWithinServer(realmServerURL, config.path);
      let actualRealmURL = realmURLWithinServer(
        actualRealmServerURL,
        config.path,
      );
      let legacyRealmURL = realmURLWithinServer(
        legacyRealmServerURL,
        config.path,
      );
      let username = config.username ?? `test_realm_${i}`;
      ensureDirSync(localDir);
      copyRealmFixture(config.dir, localDir, realmServerURL, {
        fileFilter: config.fileFilter,
      });
      realmLog.debug(
        `startIsolatedRealmStack: copied fixture ${config.dir} -> ${localDir}`,
      );
      resolvedRealms.push({
        config,
        localDir,
        realmURL,
        actualRealmURL,
        legacyRealmURL,
        username,
      });
    }
    let compatProxy = await startCompatRealmProxy({
      listenPort: Number(realmServerURL.port),
    });
    // The software-factory Playwright harness can keep prerender alive for the
    // lifetime of a Playwright testWorker even though the realm stack itself is
    // recreated per test. When provided, reuse that long-lived prerender URL so
    // we only restart realm-server and worker-manager here.
    let prerender = explicitPrerenderURL
      ? undefined
      : await startHarnessPrerenderServer({
          boxelHostURL: realmServerURL.href.replace(/\/$/, ''),
        });
    let prerenderURL = explicitPrerenderURL ?? prerender?.url;
    if (!prerenderURL) {
      throw new Error(
        'Unable to determine prerender URL for isolated realm stack',
      );
    }

    // Strip the dev TLS env vars exported by env-vars.sh when CI's init
    // action provisions the cert. The harness drives plain
    // `http://localhost:<port>/...` URLs against the spawned
    // realm-server; if the child inherits the cert env vars it binds
    // the HTTPS+HTTP/2 dispatcher and every harness HTTP request gets
    // 301-redirected, breaking benchmarks and tests that don't follow
    // redirects through their auth handshake.
    let {
      REALM_SERVER_TLS_CERT_FILE: _certFile,
      REALM_SERVER_TLS_KEY_FILE: _keyFile,
      ...rest
    } = process.env;
    void _certFile;
    void _keyFile;

    let env = {
      ...rest,
      PGHOST: DEFAULT_PG_HOST,
      PGPORT: DEFAULT_PG_PORT,
      PGUSER: DEFAULT_PG_USER,
      PG_POOL_MAX: String(DEFAULT_PG_POOL_MAX),
      PGDATABASE: databaseName,
      NODE_NO_WARNINGS: '1',
      NODE_ENV: 'test',
      REALM_SERVER_SECRET_SEED,
      REALM_SECRET_SEED,
      GRAFANA_SECRET,
      HOST_URL: context.hostURL,
      MATRIX_URL: context.matrixURL,
      MATRIX_SERVER_NAME: new URL(context.matrixURL).hostname,
      MATRIX_REGISTRATION_SHARED_SECRET: context.matrixRegistrationSecret,
      REALM_SERVER_MATRIX_USERNAME: DEFAULT_MATRIX_SERVER_USERNAME,
      REALM_SERVER_FULL_INDEX_ON_STARTUP: String(fullIndexOnStartup),
      // When restoring from a template snapshot, the modules cache has already
      // been rewritten to the runtime port by `rewriteClonedRealmServerUrls`.
      // Tell the realm-server to keep that cache instead of wiping it on
      // startup, so the first lookupDefinition for a fixture-side module hits
      // the cache instead of paying a cold prerender (~45s for darkfactory.gts).
      REALM_SERVER_SKIP_MODULES_CACHE_CLEAR_ON_STARTUP: fullIndexOnStartup
        ? 'false'
        : 'true',
      LOW_CREDIT_THRESHOLD: '2000',
      LOG_LEVELS: DEFAULT_REALM_LOG_LEVELS,
      BOXEL_TRUST_FORWARDED_URL: 'true',
      PUBLISHED_REALM_BOXEL_SPACE_DOMAIN: `localhost:${compatProxy.listenPort}`,
      PUBLISHED_REALM_BOXEL_SITE_DOMAIN: `localhost:${compatProxy.listenPort}`,
      TEST_HARNESS_WORKER_MANAGER_METADATA_FILE: workerManagerMetadataFile,
      TEST_HARNESS_REALM_SERVER_METADATA_FILE: realmServerMetadataFile,
    };

    let workerArgs = [
      '--transpileOnly',
      'worker-manager',
      `--port=${actualWorkerManagerPort}`,
      `--matrixURL=${context.matrixURL}`,
      `--prerendererUrl=${prerenderURL}`,
      `--fromUrl=${publicBaseRealmURL.href}`,
      `--toUrl=${actualBaseRealmURL.href}`,
      '--fromUrl=https://cardstack.com/base/',
      `--toUrl=${publicBaseRealmURL.href}`,
    ];
    for (let resolved of resolvedRealms) {
      workerArgs.push(
        `--fromUrl=${resolved.realmURL.href}`,
        `--toUrl=${resolved.actualRealmURL.href}`,
      );
    }
    if (INCLUDE_SKILLS) {
      workerArgs.push(
        `--fromUrl=${skillsRealmURL.href}`,
        `--toUrl=${actualSkillsRealmURL.href}`,
      );
    }
    for (let resolved of resolvedRealms) {
      workerArgs.push(
        `--fromUrl=${resolved.legacyRealmURL.href}`,
        `--toUrl=${resolved.actualRealmURL.href}`,
      );
    }
    if (INCLUDE_SKILLS) {
      workerArgs.push(
        `--fromUrl=${legacySkillsRealmURL.href}`,
        `--toUrl=${actualSkillsRealmURL.href}`,
      );
    }
    if (migrateDB) {
      workerArgs.splice(5, 0, '--migrateDB');
    }

    // Worker-manager spawn with one EADDRINUSE retry. The retry only
    // applies to the dynamically-allocated case: when the caller pinned
    // the port explicitly we have nowhere else to put it, so a bind
    // failure has to surface. The first attempt's port-conflict
    // diagnostic is logged either way so a flake leaves a trail.
    let workerManagerPortWasExplicit =
      explicitWorkerManagerPort != null && explicitWorkerManagerPort !== 0;
    let attempt = 0;
    let workerManager!: SpawnedProcess;
    let getWorkerLogs!: () => string;
    let workerManagerRuntime!: { pid: number; port: number; url: string };
    for (;;) {
      attempt++;
      // Release the worker-manager port holder right before the child binds.
      await workerManagerPortInfo.releaseHolder();
      workerManager = spawn('ts-node', workerArgs, {
        cwd: realmServerDir,
        env,
        stdio: managedProcessStdio,
      }) as SpawnedProcess;
      getWorkerLogs = captureProcessLogs(workerManager);
      let capturedLogs = getWorkerLogs;
      let capturedPort = actualWorkerManagerPort;
      workerManager.on('exit', (code, signal) => {
        if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
          return;
        }
        realmLog.warn(
          `worker manager exited unexpectedly on port ${capturedPort} (code: ${code}, signal: ${signal})\n${capturedLogs()}`,
        );
      });
      try {
        workerManagerRuntime = await waitForJsonFile<{
          pid: number;
          port: number;
          url: string;
        }>(workerManagerMetadataFile, getWorkerLogs, {
          label: 'worker manager',
          process: workerManager,
        });
        break;
      } catch (error) {
        let logs = getWorkerLogs();
        let isPortBindFailure = looksLikePortBindFailure(
          error,
          logs,
          actualWorkerManagerPort,
        );
        if (isPortBindFailure) {
          let diagnostic = await diagnosePortConflict(actualWorkerManagerPort);
          realmLog.warn(
            `worker manager EADDRINUSE on port ${actualWorkerManagerPort} (attempt ${attempt}). ${diagnostic}`,
          );
        }
        await stopManagedProcess(workerManager).catch(() => {});
        let canRetry =
          isPortBindFailure && !workerManagerPortWasExplicit && attempt === 1;
        if (!canRetry) {
          throw error;
        }
        // Allocate a fresh port and rewrite the `--port=...` slot in
        // workerArgs so the second spawn binds somewhere else. Locate
        // the slot by prefix rather than index so a future workerArgs
        // refactor doesn't silently retry on the wrong flag.
        let nextReservation = await findAndHoldAvailablePort();
        actualWorkerManagerPort = nextReservation.port;
        let portArgIndex = workerArgs.findIndex((a) => a.startsWith('--port='));
        if (portArgIndex < 0) {
          throw new Error(
            'worker-manager retry could not locate --port= flag in workerArgs',
          );
        }
        workerArgs[portArgIndex] = `--port=${actualWorkerManagerPort}`;
        workerManagerPortInfo = {
          port: actualWorkerManagerPort,
          releaseHolder: () => nextReservation.release(),
        };
        realmLog.warn(
          `worker manager retrying spawn on port ${actualWorkerManagerPort} after EADDRINUSE`,
        );
      }
    }

    let serverArgs = [
      '--transpileOnly',
      'main',
      `--port=${actualRealmServerPort}`,
      `--serverURL=${realmServerURL.href}`,
      `--matrixURL=${context.matrixURL}`,
      `--realmsRootPath=${rootDir}`,
      `--workerManagerUrl=${workerManagerRuntime.url}`,
      `--prerendererUrl=${prerenderURL}`,
      '--username=base_realm',
      `--path=${baseRealmDir}`,
      `--fromUrl=${publicBaseRealmURL.href}`,
      `--toUrl=${actualBaseRealmURL.href}`,
    ];
    if (INCLUDE_SKILLS) {
      serverArgs.push(
        '--username=skills_realm',
        `--path=${skillsRealmDir}`,
        `--fromUrl=${skillsRealmURL.href}`,
        `--toUrl=${actualSkillsRealmURL.href}`,
      );
    }
    for (let resolved of resolvedRealms) {
      serverArgs.push(
        `--username=${resolved.username}`,
        `--path=${resolved.localDir}`,
        `--fromUrl=${resolved.realmURL.href}`,
        `--toUrl=${resolved.actualRealmURL.href}`,
      );
    }
    for (let resolved of resolvedRealms) {
      serverArgs.push(
        `--fromUrl=${resolved.legacyRealmURL.href}`,
        `--toUrl=${resolved.actualRealmURL.href}`,
      );
    }
    if (INCLUDE_SKILLS) {
      serverArgs.push(
        `--fromUrl=${legacySkillsRealmURL.href}`,
        `--toUrl=${actualSkillsRealmURL.href}`,
      );
    }
    // Map the canonical base realm URL so the realm server's virtual network
    // can resolve definitions referenced via https://cardstack.com/base/...
    serverArgs.push(
      '--fromUrl=https://cardstack.com/base/',
      `--toUrl=${actualBaseRealmURL.href}`,
    );

    // Release the realm-server port holder right before the child binds.
    await realmServerPortInfo.releaseHolder();
    let realmServerSpawnedAt = Date.now();
    let realmServer = spawn('ts-node', serverArgs, {
      cwd: realmServerDir,
      env,
      stdio: managedProcessStdio,
    }) as SpawnedProcess;
    let getServerLogs = captureProcessLogs(realmServer);
    // Record every exit — including the clean SIGTERM/SIGINT case the warn
    // below intentionally stays quiet about — so the compat proxy's
    // upstream-health probe can report whether a mid-render ECONNREFUSED
    // was the realm-server dying vs. being alive-but-not-listening.
    let realmServerExit: { code: number | null; signal: string | null } | null =
      null;
    realmServer.on('exit', (code, signal) => {
      realmServerExit = { code, signal };
      if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
        return;
      }
      realmLog.warn(
        `realm server exited unexpectedly (code: ${code}, signal: ${signal})\n${getServerLogs()}`,
      );
    });

    try {
      let realmServerRuntime = await waitForJsonFile<{
        pid: number;
        port: number;
      }>(realmServerMetadataFile, getServerLogs, {
        label: 'realm server',
        process: realmServer,
      });
      // Time to bind: the realm-server only writes this metadata after it
      // clears its `smokeTestHostApp` host-readiness wait and calls
      // `server.listen`. A large value here means the port was refused for
      // that whole window — the ECONNREFUSED-to-realm-server flake.
      realmLog.info(
        `realm server bound port ${realmServerRuntime.port} after ${
          Date.now() - realmServerSpawnedAt
        }ms`,
      );
      compatProxy.setTargetPort(realmServerRuntime.port, () =>
        describeRealmServerHealth(realmServer, realmServerExit, getServerLogs),
      );
      await Promise.race([
        waitForReady(
          realmServer,
          'realm server',
          fullIndexOnStartup
            ? FULL_INDEX_REALM_STARTUP_TIMEOUT_MS
            : DEFAULT_REALM_STARTUP_TIMEOUT_MS,
          () =>
            [
              'realm server logs:',
              getServerLogs(),
              'worker manager logs:',
              getWorkerLogs(),
            ]
              .filter((entry) => entry && entry.trim().length > 0)
              .join('\n\n'),
        ),
        createProcessExitPromise(workerManager, 'worker manager'),
      ]);
      realmLog.info(
        `realm server ready after ${Date.now() - realmServerSpawnedAt}ms total`,
      );

      return {
        compatProxy,
        prerender,
        realmServer,
        realmServerURL,
        ports: {
          publicPort: compatProxy.listenPort,
          realmServerPort: realmServerRuntime.port,
          workerManagerPort: workerManagerRuntime.port,
        },
        workerManager,
        rootDir,
      };
    } catch (error) {
      try {
        await prerender?.stop();
      } catch {
        // best effort cleanup
      }
      try {
        await stopManagedProcess(realmServer);
      } catch {
        // best effort cleanup
      }
      try {
        await stopManagedProcess(workerManager);
      } catch {
        // best effort cleanup
      }
      try {
        await compatProxy?.stop();
      } catch {
        // best effort cleanup
      }
      rmSync(rootDir, { recursive: true, force: true });
      throw error;
    }
  } catch (error) {
    // Outer catch covering the long stretch between port-holder allocation
    // and the realm-server spawn. Releases any still-held port holders so
    // they don't leak past this function on early failures (compat-proxy
    // start, prerender start, worker-manager spawn / metadata wait, etc).
    await releaseHoldersOnFailure();
    throw error;
  }
}

export async function stopIsolatedRealmStack(
  stack: RunningFactoryStack,
): Promise<void> {
  let cleanupError: unknown;

  // Order matters: close the front door before killing what's behind it.
  // The worker-scoped prerender (when shared across tests) keeps issuing
  // standby refills and other requests at the stable compat-proxy port.
  // Killing the realm-server first would leave the proxy briefly alive
  // with a dead upstream — any request landing in that window would loop
  // through `fetchUpstreamWithRetry`'s ECONNREFUSED backoff and come back
  // as a 502, which (a) ties up the proxy and (b) surfaces in the
  // prerender as a `StandbyTargetNotReadyError` / render failure on a
  // realm whose teardown the test thought was over. Stopping the proxy
  // first sets its `stopping` flag and aborts in-flight retries
  // immediately (see `startCompatRealmProxy`), so subsequent requests
  // get an immediate 503 with no chance to race the realm-server's
  // SIGTERM.
  try {
    await stack.prerender?.stop();
  } catch (error) {
    cleanupError ??= error;
  }

  try {
    await stack.compatProxy?.stop();
  } catch (error) {
    cleanupError ??= error;
  }

  try {
    await stopManagedProcess(stack.realmServer);
  } catch (error) {
    cleanupError ??= error;
  }

  try {
    await stopManagedProcess(stack.workerManager);
  } catch (error) {
    cleanupError ??= error;
  }

  try {
    rmSync(stack.rootDir, { recursive: true, force: true });
  } catch (error) {
    cleanupError ??= error;
  }

  if (cleanupError) {
    throw cleanupError;
  }
}
