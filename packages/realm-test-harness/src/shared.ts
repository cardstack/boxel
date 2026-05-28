import {
  spawnSync,
  type ChildProcess,
  type StdioOptions,
} from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import jwt from 'jsonwebtoken';
import './setup-logger';
import { logger } from './logger';

// Strip ambient env vars that could break the hermetic test seal.
// The harness always passes its own listen ports and should control
// prerender sizing explicitly inside the stack it spawns. Ambient env
// vars (for example from `mise dev-all`) would otherwise leak into child
// processes, overriding dynamically allocated ports or changing the
// prerender pool shape under tests.
// This module is only imported by harness code (test infrastructure),
// so it's safe to strip unconditionally — NODE_ENV may be 'test' or
// 'development' depending on how the harness is invoked.
delete process.env.HOST_URL;
delete process.env.TEST_HARNESS_REALM_PORT;
delete process.env.TEST_HARNESS_COMPAT_REALM_PORT;
delete process.env.TEST_HARNESS_PRERENDER_PORT;
delete process.env.TEST_HARNESS_PRERENDER_URL;
delete process.env.PRERENDER_PAGE_POOL_MIN;
delete process.env.PRERENDER_PAGE_POOL_MAX;
delete process.env.PRERENDER_PAGE_POOL_INITIAL;
delete process.env.PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX;
delete process.env.PRERENDER_HIGH_PRIORITY_THRESHOLD;
delete process.env.PRERENDER_POOL_IDLE_CONTRACTION_MS;
delete process.env.PRERENDER_SHARED_CONTEXT_CAP;
delete process.env.PRERENDER_AFFINITY_TAB_MAX;
delete process.env.PRERENDER_AFFINITY_FILE_CONCURRENCY;

export type RealmAction = 'read' | 'write' | 'realm-owner' | 'assume-user';

export type RealmPermissions = Record<string, RealmAction[]>;

export type FactorySupportContext = {
  matrixURL: string;
  matrixRegistrationSecret: string;
  hostURL: string;
};

export type SynapseInstance = {
  synapseId: string;
  port: number;
  registrationSecret: string;
};

export interface RealmConfig {
  /** Directory containing the realm fixture (`realm.json`, cards, etc). */
  dir: string;
  /** Path under the realm-server URL the realm mounts at, e.g. 'test/'. */
  path: string;
  /** Permissions to seed for this realm. Defaults to `DEFAULT_PERMISSIONS`. */
  permissions?: RealmPermissions;
  /** Optional filter narrowing which fixture files are copied / hashed. */
  fileFilter?: (relativePath: string) => boolean;
  /** Username passed to realm-server `--username`; defaults to `test_realm_${i}`. */
  username?: string;
}

export interface FactoryRealmOptions {
  /** Required list of realms to mount. The first entry is treated as primary. */
  realms: RealmConfig[];
  realmServerURL?: URL;
  templateRealmServerURL?: URL;
  templateDatabaseName?: string;
  context?: FactoryTestContext | FactorySupportContext;
  cacheSalt?: string;
  /** Explicit compat realm-server port (the public-facing proxy port). */
  compatRealmServerPort?: number;
  /** Explicit realm-server port (the internal realm-server listen port). */
  realmServerPort?: number;
  /** Explicit prerender URL to reuse instead of starting a new prerender. */
  prerenderURL?: string;
}

export interface FactoryRealmTemplate {
  cacheKey: string;
  templateDatabaseName: string;
  fixtureHash: string;
  cacheHit: boolean;
  cacheMissReason?: string;
  realmURL: URL;
  realmServerURL: URL;
}

export interface FactoryTestContext extends FactorySupportContext {
  cacheKey: string;
  fixtureHash: string;
  realmDir: string;
  realmURL: string;
  realmServerURL: string;
  templateDatabaseName: string;
}

export interface StartedFactoryRealm {
  realmDir: string;
  realmURL: URL;
  realmServerURL: URL;
  databaseName: string;
  childPids: number[];
  ports: {
    publicPort: number;
    realmServerPort: number;
    workerManagerPort: number;
  };
  cardURL(path: string): string;
  createBearerToken(user?: string, permissions?: RealmAction[]): string;
  authorizationHeaders(
    user?: string,
    permissions?: RealmAction[],
  ): Record<string, string>;
  stop(): Promise<void>;
}

export type FactoryGlobalContextHandle = {
  context: FactoryTestContext;
  stop(): Promise<void>;
};

export type SpawnedProcess = ChildProcess & {
  send(message: string): boolean;
};

export type StartedCompatRealmProxy = {
  listenPort: number;
  setTargetPort(
    targetPort: number,
    describeUpstreamHealth?: () => string,
  ): void;
  stop(): Promise<void>;
};

export type RunningFactoryStack = {
  prerender?: {
    stop(): Promise<void>;
  };
  realmServer: SpawnedProcess;
  realmServerURL: URL;
  workerManager: SpawnedProcess;
  compatProxy?: StartedCompatRealmProxy;
  ports: {
    publicPort: number;
    realmServerPort: number;
    workerManagerPort: number;
  };
  rootDir: string;
};

export const packageRoot = resolve(process.cwd());
export const workspaceRoot = resolve(packageRoot, '..', '..');
export const realmServerDir = resolve(packageRoot, '..', 'realm-server');
export const hostDir = resolve(packageRoot, '..', 'host');
export const baseRealmDir = resolve(packageRoot, '..', 'base');
export const skillsRealmDir = resolve(
  packageRoot,
  '..',
  'skills-realm',
  'contents',
);
export const boxelIconsDir = resolve(packageRoot, '..', 'boxel-icons');
export const dbSnapshotDir = resolve(packageRoot, 'db-snapshots');
export const prepareTestPgScript = resolve(
  realmServerDir,
  'tests',
  'scripts',
  'prepare-test-pg.sh',
);

export const CACHE_VERSION = 9;
export const CONFIGURED_REALM_SERVER_URL = process.env
  .TEST_HARNESS_REALM_SERVER_URL
  ? new URL(process.env.TEST_HARNESS_REALM_SERVER_URL)
  : undefined;
export const DEFAULT_ICONS_URL =
  process.env.ICONS_URL ?? 'http://localhost:4206/';
export const CONFIGURED_HOST_URL = process.env.TEST_HARNESS_HOST_URL
  ? new URL(process.env.TEST_HARNESS_HOST_URL)
  : undefined;
export const DEFAULT_ICONS_PROBE_URL = new URL(
  '@cardstack/boxel-icons/v1/icons/code.js',
  DEFAULT_ICONS_URL,
).href;
export const DEFAULT_PG_PORT = process.env.TEST_HARNESS_PGPORT ?? '55436';
export const DEFAULT_PG_HOST = process.env.TEST_HARNESS_PGHOST ?? '127.0.0.1';
export const DEFAULT_PG_USER = process.env.TEST_HARNESS_PGUSER ?? 'postgres';
// The seeded test Postgres runs with max_connections=50 (see
// realm-server/tests/scripts/boot_preseeded.sh). A single stack runs two
// pg-pool clients (realm-server + worker), so the ceiling for one stack is
// pool_max × 2 processes ≈ peak connections. With pool_max=20 that's 40
// connections at peak, leaving ~10 headroom for the harness's own pg client
// and the migration template DB — comfortably under 50 even when every pool
// slot is saturated. Production uses pg-adapter's default of 40 because the
// hosted RDS has 1700+ max_connections and never sees the test pg's cap.
export const DEFAULT_PG_POOL_MAX = Number(
  process.env.TEST_HARNESS_PG_POOL_MAX ?? 20,
);
export const DEFAULT_MIGRATED_TEMPLATE_DB =
  process.env.TEST_HARNESS_MIGRATED_TEMPLATE_DB ?? 'boxel_migrated_template';
export const DEFAULT_REALM_LOG_LEVELS =
  process.env.TEST_HARNESS_REALM_LOG_LEVELS ??
  '*=info,realm:requests=warn,realm-index-updater=debug,index-runner=debug,index-perf=debug,index-writer=debug,worker=debug,worker-manager=debug,realm=debug,perf=debug';
export const DEFAULT_REALM_OWNER = '@software-factory-owner:localhost';
export const REALM_SECRET_SEED = "shhh! it's a secret";
export const REALM_SERVER_SECRET_SEED = "mum's the word";
export const GRAFANA_SECRET = "shhh! it's a secret";
export const FIXTURE_REALM_SERVER_URL_PLACEHOLDER =
  'https://test-harness.test/';
export const DEFAULT_MATRIX_SERVER_USERNAME =
  process.env.TEST_HARNESS_MATRIX_SERVER_USERNAME ?? 'realm_server';
export const DEFAULT_MATRIX_BROWSER_USERNAME =
  process.env.TEST_HARNESS_BROWSER_MATRIX_USERNAME ??
  'software-factory-browser';
export const INCLUDE_SKILLS = process.env.TEST_HARNESS_INCLUDE_SKILLS === '1';
export const DEFAULT_PERMISSIONS: RealmPermissions = {
  '*': ['read'],
  [DEFAULT_REALM_OWNER]: ['read', 'write', 'realm-owner'],
};
export const DEFAULT_BASE_REALM_PERMISSIONS = DEFAULT_PERMISSIONS;
export const managedProcessStdio: StdioOptions =
  process.env.TEST_HARNESS_DEBUG_SERVER === '1'
    ? (['ignore', 'inherit', 'inherit', 'ipc'] as const)
    : (['ignore', 'pipe', 'pipe', 'ipc'] as const);
export const DEFAULT_REALM_STARTUP_TIMEOUT_MS = Number(
  process.env.TEST_HARNESS_REALM_STARTUP_TIMEOUT_MS ?? 120_000,
);
export const FULL_INDEX_REALM_STARTUP_TIMEOUT_MS = Number(
  process.env.TEST_HARNESS_FULL_INDEX_REALM_STARTUP_TIMEOUT_MS ?? 600_000,
);

export const harnessLog = logger('software-factory:harness');
export const supportLog = logger('software-factory:harness:support');
export const templateLog = logger('software-factory:harness:template');
export const realmLog = logger('software-factory:harness:realm');

export function formatElapsedMs(elapsedMs: number): string {
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

export async function logTimed<T>(
  log: ReturnType<typeof logger>,
  label: string,
  callback: () => Promise<T>,
): Promise<T> {
  let startedAt = Date.now();
  log.debug(`${label}: starting`);
  try {
    let result = await callback();
    log.debug(
      `${label}: finished in ${formatElapsedMs(Date.now() - startedAt)}`,
    );
    return result;
  } catch (error) {
    log.warn(
      `${label}: failed after ${formatElapsedMs(Date.now() - startedAt)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  }
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  let record = value as Record<string, unknown>;
  let keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function findAvailablePort(): Promise<number> {
  let reservation = await findAndHoldAvailablePort();
  await reservation.release();
  return reservation.port;
}

/**
 * Probe a port across the common bind scopes and report which conflict.
 * Intended for post-mortem diagnostics when a child has just crashed
 * with EADDRINUSE — knowing whether the conflict lives on
 * `127.0.0.1`, `::1`, or only on the dual-stack wildcard tells you
 * whether the colliding peer is an IPv4-only binder, an IPv6-only one,
 * or whether the kernel is still holding a TIME_WAIT entry on a wide
 * bind from the previous run.
 *
 * Also shells out to `ss -tlnp` (best-effort; silently skipped when
 * the binary is absent) so the caller can see which pid/program holds
 * the port. Never throws — diagnostics must not mask the original
 * failure they were called to explain.
 */
export async function diagnosePortConflict(port: number): Promise<string> {
  let scopes: Array<{ label: string; host?: string }> = [
    { label: '127.0.0.1', host: '127.0.0.1' },
    { label: '0.0.0.0', host: '0.0.0.0' },
    { label: '::1', host: '::1' },
    { label: ':: (dual-stack wildcard)' },
  ];
  let lines: string[] = [`port-conflict probe for ${port}:`];
  for (let scope of scopes) {
    let result = await probeBind(port, scope.host);
    lines.push(`  ${scope.label}: ${result}`);
  }
  try {
    let ss = spawnSync('ss', ['-tlnp', `( sport = :${port} )`], {
      encoding: 'utf8',
      timeout: 2_000,
    });
    if (ss.status === 0 && ss.stdout.trim()) {
      lines.push(`  ss -tlnp:\n${indent(ss.stdout.trim(), '    ')}`);
    }
  } catch {
    // ss not available — skip silently
  }
  return lines.join('\n');
}

async function probeBind(
  port: number,
  host: string | undefined,
): Promise<string> {
  return await new Promise<string>((resolve) => {
    let server = createNetServer();
    let settled = false;
    let finish = (result: string) => {
      if (settled) return;
      settled = true;
      // Wait for `close` to actually release the listening socket before
      // resolving. Without this gate the sequential probes in
      // diagnosePortConflict can race their own still-closing sockets —
      // a successful `FREE` probe's leftover bind would surface as a
      // false EADDRINUSE on the next scope.
      let finalize = () => resolve(result);
      try {
        server.close((closeError) => {
          if (closeError && closeError.message !== 'Server is not running.') {
            // Best-effort: include the close failure in the probe result so
            // it's at least visible, but never throw — diagnostics must not
            // mask the original failure.
            finalize();
          } else {
            finalize();
          }
        });
      } catch {
        finalize();
      }
    };
    server.once('error', (error: NodeJS.ErrnoException) => {
      finish(error.code ?? error.message);
    });
    let onListening = () => finish('FREE');
    if (host === undefined) {
      server.listen(port, onListening);
    } else {
      server.listen(port, host, onListening);
    }
  });
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

/**
 * A port number plus a `release()` that closes the holder socket keeping
 * the port reserved. Prefer this over `findAvailablePort()` whenever there
 * is a non-trivial gap between "I picked a port" and "the child process
 * actually binds to it". Without the hold the OS port-0 allocator can
 * hand the same port to a sibling caller in the same process (the
 * concrete failure mode that hit the cache:prepare path of the SF
 * harness, where the realm-server, worker-manager, prerender, host-dist
 * and compat-proxy ports were all picked back-to-back from the ephemeral
 * range and could collide before any subprocess had a chance to bind).
 *
 * Usage:
 *
 *   let reservation = await findAndHoldAvailablePort();
 *   try {
 *     // ... long-running setup that allocates other ports ...
 *     await reservation.release();
 *     spawn('child', ['--port', String(reservation.port)]);
 *   } catch (err) {
 *     await reservation.release();
 *     throw err;
 *   }
 */
export type PortReservation = {
  readonly port: number;
  release(): Promise<void>;
};

export async function findAndHoldAvailablePort(): Promise<PortReservation> {
  return await new Promise<PortReservation>((resolveOuter, rejectOuter) => {
    // Immediately destroy any incoming connection. The holder exists only
    // to keep the kernel from handing the port to a sibling allocator;
    // accepting traffic would let an unsuspecting HTTP client (e.g. the
    // indexing-progress poller) connect to a socket with no HTTP server
    // behind it and hang waiting for a response that never comes.
    // Destroying on connect surfaces as ECONNRESET on the client side,
    // which fetch reports as a TypeError — the poller's catch handler
    // treats that as a transient failure and tries again on the next
    // tick.
    let server = createNetServer((socket) => socket.destroy());
    let onError = (error: NodeJS.ErrnoException) => {
      server.close();
      rejectOuter(error);
    };
    server.once('error', onError);
    // Bind wildcard rather than 127.0.0.1 so the kernel only hands us a
    // port that is free on every interface. Without this, the holder
    // could occupy `127.0.0.1:X` while another process still has a
    // lingering bind on `::X` (e.g. a previous worker-manager whose
    // dual-stack socket the kernel hasn't fully reaped). The next child
    // — which calls `server.listen(X)` without a host and therefore
    // binds `:::X` — would then crash with EADDRINUSE. Selecting on the
    // wildcard guarantees the chosen port is unused on the same scope
    // the child will bind.
    server.listen(0, () => {
      let address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        rejectOuter(new Error('Unable to determine allocated port'));
        return;
      }
      server.off('error', onError);
      // Swallow late errors after a successful bind so they don't surface
      // as unhandled 'error' events.
      server.on('error', () => {});
      let released = false;
      resolveOuter({
        port: address.port,
        release: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            if (released) {
              resolveClose();
              return;
            }
            released = true;
            server.close((closeError) => {
              if (closeError) {
                rejectClose(closeError);
              } else {
                resolveClose();
              }
            });
          }),
      });
    });
  });
}

export async function resolveFactoryRealmServerURL(
  realmServerURL?: URL,
  compatRealmServerPort?: number,
): Promise<URL> {
  if (realmServerURL) {
    return new URL(realmServerURL.href);
  }

  if (CONFIGURED_REALM_SERVER_URL) {
    return new URL(CONFIGURED_REALM_SERVER_URL.href);
  }

  let port =
    compatRealmServerPort && compatRealmServerPort !== 0
      ? compatRealmServerPort
      : await findAvailablePort();
  return new URL(`http://localhost:${port}/`);
}

export function baseRealmURLFor(realmServerURL: URL): URL {
  return new URL('base/', realmServerURL);
}

export function skillsRealmURLFor(realmServerURL: URL): URL {
  return new URL('skills/', realmServerURL);
}

export function withPort(url: URL, port: number): URL {
  let next = new URL(url.href);
  next.port = String(port);
  return next;
}

export function realmURLWithinServer(
  realmServerURL: URL,
  realmPath: string,
): URL {
  return new URL(realmPath || '.', realmServerURL);
}

export function shouldIgnoreFixturePath(relativePath: string): boolean {
  if (relativePath === '.DS_Store') {
    return true;
  }
  return relativePath
    .split('/')
    .some((segment) =>
      [
        'node_modules',
        '.git',
        '.boxel-history',
        'playwright-report',
        'test-results',
      ].includes(segment),
    );
}

export function hashRealmFixture(
  realmDir: string,
  options?: { fileFilter?: (relativePath: string) => boolean },
): string {
  let entries: string[] = [];

  function visit(currentDir: string) {
    for (let entry of readdirSync(currentDir, { withFileTypes: true })) {
      let absolutePath = join(currentDir, entry.name);
      let relativePath = relative(realmDir, absolutePath).replace(/\\/g, '/');
      if (shouldIgnoreFixturePath(relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (options?.fileFilter && !options.fileFilter(relativePath)) {
        continue;
      }
      let stats = statSync(absolutePath);
      let contentsHash = createHash('sha256')
        .update(readFileSync(absolutePath))
        .digest('hex');
      entries.push(`${relativePath}:${stats.size}:${contentsHash}`);
    }
  }

  visit(realmDir);
  entries.sort();
  return hashString(entries.join('|'));
}

/**
 * Stable cache-key fragment describing the on-disk fixtures plus per-realm
 * permissions for a set of realms. Used by the harness API to build a
 * template-DB cache key — any change to a fixture's contents, mount path,
 * or permissions invalidates the cached template.
 */
export function hashRealms(realms: RealmConfig[]): string {
  let entries = realms
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((realm) =>
      stableStringify({
        path: realm.path,
        fixtureHash: hashRealmFixture(realm.dir, {
          fileFilter: realm.fileFilter,
        }),
        permissions: realm.permissions ?? null,
      }),
    );
  return hashString(entries.join('||'));
}

export function templateDatabaseNameForCacheKey(cacheKey: string): string {
  return `sf_tpl_${cacheKey.slice(0, 24)}`;
}

export function builderDatabaseNameForCacheKey(cacheKey: string): string {
  return `sf_bld_${cacheKey.slice(0, 16)}`;
}

export function runtimeDatabaseName(): string {
  return `sf_run_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function pgAdminConnectionConfig(database = 'postgres') {
  return {
    host: DEFAULT_PG_HOST,
    port: Number(DEFAULT_PG_PORT),
    user: DEFAULT_PG_USER,
    password: process.env.PGPASSWORD || undefined,
    database,
  };
}

export function quotePgIdentifier(identifier: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
    throw new Error(`unsafe postgres identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export async function waitUntil<T>(
  condition: () => Promise<T>,
  options: {
    timeout?: number;
    interval?: number;
    timeoutMessage?: string;
  } = {},
): Promise<T> {
  let timeout = options.timeout ?? 30_000;
  let interval = options.interval ?? 250;
  let start = Date.now();
  while (Date.now() - start < timeout) {
    let result = await condition();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(options.timeoutMessage ?? 'Timed out waiting for condition');
}

export async function waitForJsonFile<T>(
  file: string,
  getLogs: () => string,
  options: {
    timeout?: number;
    label: string;
    process?: SpawnedProcess;
  },
): Promise<T> {
  let timeout = options.timeout ?? DEFAULT_REALM_STARTUP_TIMEOUT_MS;
  let startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch (error) {
      let nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        throw error;
      }
    }

    if (options.process && options.process.exitCode !== null) {
      throw new Error(
        `${options.label} exited early with code ${options.process.exitCode}\n${getLogs()}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out waiting for ${options.label} metadata in ${file}\n${getLogs()}`,
  );
}

export function runCommand(command: string, args: string[], cwd: string) {
  let result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      PGHOST: DEFAULT_PG_HOST,
      PGPORT: DEFAULT_PG_PORT,
      PGUSER: DEFAULT_PG_USER,
    },
  });
  if (result.status !== 0) {
    throw new Error(`command failed: ${command} ${args.join(' ')}`);
  }
}

export function cleanupStaleSynapseContainers() {
  // Only clean up test harness Synapse containers (sf-test-synapse-* prefix).
  // Do NOT touch boxel-synapse* containers — those belong to the dev
  // environment (mise run dev-all) and killing them breaks the dev server.
  let result = spawnSync(
    'docker',
    ['ps', '-aq', '--filter', 'name=sf-test-synapse-'],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    return;
  }

  let containerIds = result.stdout
    .split(/\s+/)
    .map((id) => id.trim())
    .filter(Boolean);

  if (containerIds.length === 0) {
    return;
  }

  spawnSync('docker', ['rm', '-f', ...containerIds], {
    cwd: workspaceRoot,
    stdio: 'ignore',
  });
}

export function maybeRequire(specifier: string) {
  if (typeof require === 'function') {
    return require(specifier);
  }
  return undefined;
}

// Re-export host dist utilities from the side-effect-free module so
// existing harness consumers don't need to change their imports.
export {
  fileExists,
  findRootRepoCheckoutDir,
  findHostDistPackageDir,
} from './host-dist';

export function browserPassword(username: string): string {
  let cleanUsername = username.replace(/^@/, '').replace(/:.*$/, '');
  return createHash('sha256')
    .update(cleanUsername)
    .update(REALM_SECRET_SEED)
    .digest('hex');
}

export function parseFactoryContext(): FactoryTestContext | undefined {
  let raw = process.env.TEST_HARNESS_CONTEXT;
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw) as FactoryTestContext;
}

export function isFactorySupportContext(
  context: unknown,
): context is FactorySupportContext {
  return Boolean(
    context &&
    typeof context === 'object' &&
    'matrixURL' in context &&
    typeof context.matrixURL === 'string' &&
    'matrixRegistrationSecret' in context &&
    typeof context.matrixRegistrationSecret === 'string' &&
    'hostURL' in context &&
    typeof context.hostURL === 'string',
  );
}

export function hasTemplateDatabaseName(
  context: FactorySupportContext | FactoryTestContext,
): context is FactoryTestContext {
  return 'templateDatabaseName' in context;
}

export function buildRealmToken(
  realmURL: URL,
  realmServerURL: URL,
  user = DEFAULT_REALM_OWNER,
  permissions = DEFAULT_PERMISSIONS[DEFAULT_REALM_OWNER] ?? [
    'read',
    'write',
    'realm-owner',
  ],
): string {
  return jwt.sign(
    {
      user,
      realm: realmURL.href,
      permissions,
      sessionRoom: `software-factory-session-room-for-${user}`,
      realmServerURL: realmServerURL.href,
    },
    REALM_SECRET_SEED,
    { expiresIn: '7d' },
  );
}

/**
 * Build a JWT for `_run-command` and other server-level endpoints.
 *
 * The `_run-command` route uses `jwtMiddleware(args.realmSecretSeed)` which
 * verifies with `REALM_SECRET_SEED` (not REALM_SERVER_SECRET_SEED). The
 * middleware only checks for a valid `user` and `sessionRoom` in the payload.
 */
export function buildServerToken(user = DEFAULT_REALM_OWNER): string {
  return jwt.sign(
    {
      user,
      sessionRoom: `software-factory-session-room-for-${user}`,
    },
    REALM_SECRET_SEED,
    { expiresIn: '7d' },
  );
}

export function createProcessExitPromise(
  proc: SpawnedProcess,
  label: string,
): Promise<never> {
  return new Promise((_, reject) => {
    proc.once('exit', (code, signal) => {
      reject(
        new Error(
          `${label} exited before it became ready (code: ${code}, signal: ${signal})`,
        ),
      );
    });
    proc.once('error', reject);
  });
}

export function appendProcessLogs(
  buffer: string,
  chunk: Buffer | string,
): string {
  return `${buffer}${String(chunk)}`.slice(-100_000);
}

export function captureProcessLogs(proc: SpawnedProcess) {
  let stdout = '';
  let stderr = '';

  proc.stdout?.on('data', (chunk) => {
    stdout = appendProcessLogs(stdout, chunk);
  });
  proc.stderr?.on('data', (chunk) => {
    stderr = appendProcessLogs(stderr, chunk);
  });

  return () => {
    let logs = [];
    if (stdout) {
      logs.push(`stdout:\n${stdout}`);
    }
    if (stderr) {
      logs.push(`stderr:\n${stderr}`);
    }
    return logs.join('\n\n');
  };
}

export async function waitForReady(
  proc: SpawnedProcess,
  label: string,
  timeoutMs = 120_000,
  getLogs?: () => string,
): Promise<void> {
  let timedOut = await Promise.race([
    new Promise<void>((resolve) => {
      let onMessage = (message: unknown) => {
        if (message === 'ready') {
          proc.off('message', onMessage);
          resolve();
        }
      };
      proc.on('message', onMessage);
    }),
    createProcessExitPromise(proc, label),
    new Promise<true>((resolve) => {
      // unref so the losing racer (the timeout) doesn't keep the event
      // loop alive after a successful "ready" message.
      let t = setTimeout(() => resolve(true), timeoutMs);
      t.unref();
    }),
  ]);

  if (timedOut) {
    let logOutput = getLogs?.();
    throw new Error(
      `Timed out waiting for ${label} to start${
        logOutput ? `\n\n${logOutput}` : ''
      }`,
    );
  }
}

export async function stopManagedProcess(proc: SpawnedProcess): Promise<void> {
  if (proc.exitCode !== null) {
    return;
  }
  let stopped = new Promise<'stopped'>((resolve) => {
    let onMessage = (message: unknown) => {
      if (message === 'stopped') {
        proc.off('message', onMessage);
        resolve('stopped');
      }
    };
    proc.on('message', onMessage);
  });
  let exited = new Promise<'exited'>((resolve) => {
    let onExit = () => {
      proc.off('exit', onExit);
      proc.off('error', onExit);
      resolve('exited');
    };
    proc.on('exit', onExit);
    proc.on('error', onExit);
  });
  // .unref() each timeout so the losing racers don't keep the event
  // loop alive after the winning racer resolves. Without this, a child
  // that exits in 100ms still pins the parent process for ~15s × N
  // pending grace timers, and post-bench teardown stalls for minutes.
  let unrefTimeout = (
    cb: (...args: unknown[]) => void,
    ms: number,
  ): NodeJS.Timeout => {
    let t = setTimeout(cb, ms);
    t.unref();
    return t;
  };
  proc.send('stop');
  let stopResult = await Promise.race([
    stopped,
    exited,
    new Promise<false>((resolve) => unrefTimeout(() => resolve(false), 15_000)),
  ]);
  if (stopResult === false && proc.exitCode === null) {
    proc.send('kill');
  }
  if (proc.exitCode === null) {
    let exitResult = await Promise.race([
      exited,
      new Promise<false>((resolve) =>
        unrefTimeout(() => resolve(false), 15_000),
      ),
    ]);
    if (exitResult === false && proc.exitCode === null) {
      try {
        proc.kill();
      } catch {
        // best effort hard-kill
      }
      exitResult = await Promise.race([
        exited,
        new Promise<false>((resolve) =>
          unrefTimeout(() => resolve(false), 5_000),
        ),
      ]);
      if (exitResult === false && proc.exitCode === null) {
        throw new Error('Failed to stop managed process within timeout');
      }
    }
  }
}
