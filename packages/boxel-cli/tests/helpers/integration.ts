import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as os from 'os';
import {
  BOOT_SETTLE_TIMEOUT_MS,
  DRAIN_BUDGET_MS,
  DB_CLOSE_BUDGET_MS,
} from './fixture-budgets.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import { runBoxel } from './run-boxel.ts';
import {
  prepareTestDB,
  createTestPgAdapter,
  createVirtualNetwork,
  runTestRealmServerWithRealms,
  closeServer,
  matrixURL,
  matrixRegistrationSecret,
  realmSecretSeed,
} from '#realm-server/tests/helpers/index';
import { createJWT as createRealmServerJWT } from '#realm-server/utils/jwt';
import { registerUser } from '#realm-server/synapse';

export { registerUser } from '#realm-server/synapse';
export {
  matrixURL,
  matrixRegistrationSecret,
  realmSecretSeed,
} from '#realm-server/tests/helpers/index';
import {
  PgQueuePublisher,
  PgQueueRunner,
  type PgAdapter,
} from '@cardstack/postgres';
import type {
  Prerenderer,
  LooseSingleCardDocument,
  Realm,
  RealmPermissions,
} from '@cardstack/runtime-common';
import type { Server } from 'http';

// Default prerenderer for CLI integration tests — returns empty render
// output so we don't depend on Chrome or a running host app. Tests that
// need real card indexing (e.g. content-based search assertions) pass an
// explicit `prerenderer` (typically `await getTestPrerenderer()` from
// realm-server's helpers).
const noopPrerenderer: Prerenderer = {
  prerenderModule: async () => ({ html: '', status: 200 }) as any,
  prerenderVisit: async () => ({}) as any,
  runCommand: async () => ({ status: 'ready' }),
};

export const TEST_REALM_SERVER_URL = 'http://127.0.0.1:4446';
const TEST_REALM_SERVER_HOST = new URL(TEST_REALM_SERVER_URL).hostname;
const TEST_REALM_SERVER_PORT = Number(new URL(TEST_REALM_SERVER_URL).port);

export const TEST_USERNAME = `cli-test-${Date.now()}`;
export const TEST_PASSWORD = 'test-password-for-cli';

let testRealmHttpServer: Server | undefined;
let activeRealms: Realm[] = [];
let dbAdapter: PgAdapter | undefined;
let publisher: PgQueuePublisher | undefined;
let runner: PgQueueRunner | undefined;
let realmsRootDir: string | undefined;

/**
 * The in-flight `startTestRealmServer` boot, from its first line until it
 * either publishes its results into the module state above or throws.
 *
 * Every integration file boots its fixture on the same fixed port, and the
 * whole suite shares one process (`--poolOptions.forks.singleFork`), so the
 * fixture's teardown has to be able to clean up a boot that its own caller
 * has stopped waiting for. vitest enforces a hook budget by rejecting the
 * hook's promise; it cannot cancel the work the hook started, so a `beforeAll`
 * that overruns leaves the boot running and hands control to `afterAll`
 * immediately — the boot then binds the fixture port with nothing left holding
 * a reference to the server. `stopTestRealmServer` awaits this handle first
 * (see `settleBoot`), which is what keeps one overrun boot from turning into
 * `EADDRINUSE` in every file that follows.
 */
let pendingBoot: Promise<unknown> | undefined;

/**
 * Wall-clock cost of each phase of the fixture the current file is standing
 * up, in the order the phases run: the server boot first, then whatever
 * profile setup the file asks for. A phase with no entry had not been
 * reached, which is what makes this readable for a hook that overran its
 * budget — the phase that never landed is the one that was still running.
 */
let fixturePhases: [string, number][] = [];

async function timePhase<T>(
  name: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  let start = Date.now();
  try {
    return await fn();
  } finally {
    fixturePhases.push([name, Date.now() - start]);
  }
}

function formatFixturePhases(): string {
  if (fixturePhases.length === 0) {
    return '(no fixture recorded)';
  }
  return `${fixturePhases
    .map(([name, ms]) => `${name}=${ms}ms`)
    .join(' ')} total=${fixtureTotalMs()}ms`;
}

function fixtureTotalMs(): number {
  return fixturePhases.reduce((sum, [, ms]) => sum + ms, 0);
}

/**
 * True when something is accepting connections at `host:port`. Used to tell a
 * leaked fixture server apart from a clean start, so the leak is reported at
 * the boot that trips over it.
 */
function isPortListening(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let socket = new net.Socket();
    let settle = (listening: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
    socket.connect(port, host);
  });
}

/**
 * Wait for the in-flight boot to publish its results (or fail) so teardown
 * sees everything it created. A boot that outlives this window is reported by
 * `startTestRealmServer`'s own pre-flight check in the next file rather than
 * hanging teardown here.
 */
async function settleBoot(): Promise<void> {
  let boot = pendingBoot;
  if (!boot) {
    return;
  }
  pendingBoot = undefined;
  // Teardown reached a boot that is still running, so the hook that started it
  // never got its result — it overran its budget or its file failed around it.
  // The phase list names how far the boot got, which is the one thing the
  // hook's own `Hook timed out` report cannot say.
  console.log(
    `[boxel-cli fixture] teardown is waiting on a boot that is still in ` +
      `flight; phases so far: ${formatFixturePhases()}`,
  );
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      // A rejected boot has already been reported to the hook that started
      // it; teardown only needs the boot settled, so that nothing is still
      // writing to the module state it is about to tear down.
      boot.catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, BOOT_SETTLE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export interface RealmConfig {
  realmURL: URL;
  fileSystem?: Record<string, string | LooseSingleCardDocument>;
  permissions: RealmPermissions;
}

export interface StartTestRealmServerOptions {
  /**
   * Full multi-realm config. Mutually exclusive with `fileSystem`. Each
   * entry must specify its own `realmURL` and `permissions`.
   */
  realms?: RealmConfig[];
  /**
   * Convenience for the common single-realm case. Creates one realm at
   * `${TEST_REALM_SERVER_URL}/test/` with the cli-test user as owner and
   * the given fileSystem. Mutually exclusive with `realms`.
   */
  fileSystem?: Record<string, string | LooseSingleCardDocument>;
  /**
   * Override the prerenderer. Defaults to `noopPrerenderer` (no Chrome).
   * Pass `await getTestPrerenderer()` from realm-server helpers (or any
   * other `Prerenderer`) for tests that need real card indexing.
   */
  prerenderer?: Prerenderer;
  /**
   * Register the cli-test Matrix user via Synapse. Default: true. Set to
   * false for tests that bypass Matrix entirely (e.g. by injecting a
   * realm-server JWT via `setupJwtTestProfile`).
   */
  registerMatrixUser?: boolean;
  /**
   * Realm-prefix mappings (prefix → realm URL, e.g.
   * `'@cli-test/prefixed/': '${TEST_REALM_SERVER_URL}/test/'`) registered on
   * the server's virtual network before boot. A mapped realm serves its
   * document ids in prefix (RRI) form, matching production prefix-form
   * realms like `@cardstack/skills/`.
   */
  realmPrefixes?: Record<string, string>;
}

export async function startTestRealmServer(
  options: StartTestRealmServerOptions = {},
): Promise<{ realms: Realm[]; testRealmHttpServer: Server }> {
  if (options.realms && options.fileSystem) {
    throw new Error(
      'startTestRealmServer: pass either `realms` or `fileSystem`, not both',
    );
  }
  fixturePhases = [];
  slowFixtureReported = false;
  // The handle is published before the first `await`, so a caller that stops
  // waiting the instant it calls this still leaves teardown something to find.
  // Nothing here may be awaited ahead of the assignment — the port check runs
  // inside the boot for that reason.
  let boot = (async () => {
    await assertFixturePortFree();
    return await bootTestRealmServer(options);
  })();
  pendingBoot = boot;
  try {
    return await boot;
  } finally {
    // Clearing the handle is what tells teardown it has nothing to wait for:
    // the caller has the boot's outcome. Only a boot whose caller never
    // reaches here leaves it set.
    if (pendingBoot === boot) {
      pendingBoot = undefined;
      reportSlowFixture();
    }
  }
}

/**
 * A fixture that stands up at its usual cost — around a second, most of it the
 * server boot — is silent. One an order of magnitude above that prints its
 * phase breakdown, well before the hook budget is in danger, because a suite
 * whose fixtures have drifted toward the limit is what turns runner load into
 * hook timeouts. The breakdown says which phase to go after.
 */
const SLOW_FIXTURE_THRESHOLD_MS = 10_000;
let slowFixtureReported = false;

function reportSlowFixture(): void {
  if (slowFixtureReported || fixtureTotalMs() < SLOW_FIXTURE_THRESHOLD_MS) {
    return;
  }
  slowFixtureReported = true;
  console.log(`[boxel-cli fixture] slow setup: ${formatFixturePhases()}`);
}

/**
 * Fail before booting when something already holds the fixture port, and say
 * what that means. A bare `listen EADDRINUSE` from inside the realm server's
 * boot names a port and nothing else; the failure a reader needs to recognise
 * is that this file never had the port to begin with.
 */
async function assertFixturePortFree(): Promise<void> {
  if (
    !(await isPortListening(TEST_REALM_SERVER_HOST, TEST_REALM_SERVER_PORT))
  ) {
    return;
  }
  throw new Error(
    `fixture port ${TEST_REALM_SERVER_URL} is already accepting connections, ` +
      `so a test realm server cannot bind it. The usual cause is a fixture ` +
      `boot that outlived the teardown of the file that started it — look ` +
      `for a hook timeout in the file that ran before this one.`,
  );
}

async function bootTestRealmServer(
  options: StartTestRealmServerOptions,
): Promise<{ realms: Realm[]; testRealmHttpServer: Server }> {
  prepareTestDB();
  dbAdapter = await timePhase('clone-test-db', () => createTestPgAdapter());
  publisher = new PgQueuePublisher(dbAdapter);
  // Test-only hardening for a leak in runtime-common's enqueueReindexRealmJob:
  // server.createRealm, handle-publish-realm, and full-reindex discard the Job
  // returned by queue.publish(), but publish() still registers a Deferred that
  // rejects when cancelRunningJobsInConcurrencyGroup fires during a concurrent
  // delete-realm (status: 418, "User initiated job cancellation"). A discarded
  // Deferred with no handler surfaces to vitest as an unhandled rejection and
  // fails the suite even though every assertion passes. Other consumers chained
  // off the same job.done still see the rejection through their own handlers.
  // Upstream fix belongs in packages/runtime-common/jobs/reindex-realm.ts; we
  // keep this branch scoped to boxel-cli.
  let basePublish = publisher.publish.bind(publisher);
  publisher.publish = (async (args) => {
    let job = await basePublish(args);
    void job.done.catch(() => {});
    return job;
  }) as typeof publisher.publish;
  runner = new PgQueueRunner({
    adapter: dbAdapter,
    workerId: 'cli-test-worker',
  });

  let virtualNetwork = createVirtualNetwork();
  for (let [prefix, target] of Object.entries(options.realmPrefixes ?? {})) {
    virtualNetwork.addRealmMapping(prefix, target);
  }
  realmsRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-cli-realms-'));

  let realms: RealmConfig[] = options.realms ?? [
    {
      realmURL: new URL(`${TEST_REALM_SERVER_URL}/test/`),
      fileSystem: options.fileSystem,
      permissions: {
        '*': ['read', 'write'],
        [`@${TEST_USERNAME}:localhost`]: ['read', 'write', 'realm-owner'],
      },
    },
  ];

  // Bound outside the timing closure: the pieces above live in module state so
  // teardown can reach them, and a closure over module state reads them as
  // possibly-undefined.
  let bootArgs = {
    realmsRootPath: path.join(realmsRootDir, 'realm_server_1'),
    realms,
    virtualNetwork,
    publisher,
    runner,
    dbAdapter,
    matrixURL,
    prerenderer: options.prerenderer ?? noopPrerenderer,
  };
  let result = await timePhase('boot-realm-server', () =>
    runTestRealmServerWithRealms(bootArgs),
  );

  testRealmHttpServer = result.testRealmHttpServer;
  activeRealms = result.realms;

  if (options.registerMatrixUser !== false) {
    await timePhase('register-matrix-user', () => registerCliTestUser());
  }

  return {
    realms: activeRealms,
    testRealmHttpServer: result.testRealmHttpServer,
  };
}

/**
 * Returns the PgAdapter created by `startTestRealmServer`, or undefined if
 * the server hasn't been started yet. Intended for tests that need to seed
 * or read realm-server tables directly (e.g. injecting a `has_error` row
 * into `boxel_index` to exercise endpoints that surface index errors).
 */
export function getTestDbAdapter(): PgAdapter | undefined {
  return dbAdapter;
}

// The two budgeted steps below both wait on the same thing: index work this
// suite started and stopped caring about. A suite whose assertions finish
// before the from-scratch index does is asking teardown to sit through a whole
// index pass, prerender round-trips included. `fixture-budgets` carries why
// each step can wait indefinitely and why a harness must not.
//
// Abandoning that work is safe in the one way that matters: `prepareTestDB`
// names a database per process and per call, so the job runs on a database
// belonging to this file alone and cannot reach the next file's data. It logs
// connection errors once the pool is gone, and its pool stays checked out
// until the process exits — noise and a handful of connections against a
// throwaway test cluster, in exchange for ports that are free when the next
// suite starts.

// Resolves true if the step finished, false if the budget expired or it threw.
// Never rejects: a teardown failure must not replace whatever the suite was
// reporting, and the timer is unref'd so a step still running cannot be the
// reason the process stays up.
async function withBudget(
  label: string,
  step: Promise<unknown>,
  budgetMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  let finished = await Promise.race([
    step.then(
      () => true,
      (e: unknown) => {
        console.warn(`[teardown] ${label} failed: ${String(e)}`);
        return false;
      },
    ),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), budgetMs);
      timer.unref();
    }),
  ]);
  if (timer) {
    clearTimeout(timer);
  }
  return finished;
}

export async function stopTestRealmServer(): Promise<void> {
  // A boot whose caller stopped waiting for it is still going to publish a
  // listening server into the module state below, so teardown waits for it
  // rather than racing it. Everything after this point tears down the full
  // set of resources the boot created, whether or not the hook that asked
  // for them ever saw them.
  await settleBoot();
  for (let realm of activeRealms) {
    realm.unsubscribe();
  }
  activeRealms = [];
  if (testRealmHttpServer) {
    await closeServer(testRealmHttpServer);
    testRealmHttpServer = undefined;
  }
  if (publisher) {
    await publisher.destroy();
    publisher = undefined;
  }
  if (runner) {
    let drained = await withBudget(
      'queue runner drain',
      runner.destroy(),
      DRAIN_BUDGET_MS,
    );
    runner = undefined;
    if (!drained) {
      console.warn(
        `[teardown] a claimed job outlived its ${DRAIN_BUDGET_MS / 1000}s drain ` +
          `budget and is left running against ${process.env.PGDATABASE}. Queue or ` +
          `database errors logged past this point belong to the suite that just ended.`,
      );
    }
  }
  if (dbAdapter) {
    let closed = await withBudget(
      'database pool close',
      dbAdapter.close(),
      DB_CLOSE_BUDGET_MS,
    );
    dbAdapter = undefined;
    if (!closed) {
      console.warn(
        `[teardown] the pool for ${process.env.PGDATABASE} still had clients ` +
          `checked out after ${DB_CLOSE_BUDGET_MS / 1000}s; its connections are ` +
          `left to the process exit.`,
      );
    }
  }
  if (realmsRootDir) {
    fs.rmSync(realmsRootDir, { recursive: true, force: true });
    realmsRootDir = undefined;
  }
}

export function createTestProfileDir(): {
  dir: string;
  cleanup: () => void;
  profileManager: ProfileManager;
} {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-cli-test-'));
  let profileManager = new ProfileManager(dir);
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
    profileManager,
  };
}

/**
 * A throwaway HOME for driving the CLI as a subprocess. The returned
 * `profileManager` is scoped to `<home>/.boxel-cli` — the exact path the
 * subprocess reads when spawned with `HOME=<home>` (`ProfileManager`'s
 * default config dir is `os.homedir()/.boxel-cli`, and `os.homedir()`
 * honors `$HOME`). Seed it test-side with `setupTestProfile` /
 * `setupJwtTestProfile` (both persist to disk via `saveConfig`), then
 * pass `home` to `runBoxel` so the CLI authenticates without a Matrix
 * round-trip. After a command mutates the profile on disk (e.g. `realm
 * create` stores a realm token), call `reloadProfile(home)` to read the
 * fresh state back — the seeded `profileManager`'s in-memory copy is
 * stale once the subprocess has written.
 */
export function createTestHome(): {
  home: string;
  cleanup: () => void;
  profileManager: ProfileManager;
} {
  let home = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-cli-home-'));
  let profileManager = new ProfileManager(path.join(home, '.boxel-cli'));
  return {
    home,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
    profileManager,
  };
}

/**
 * Read the profile a subprocess left on disk under `<home>/.boxel-cli`.
 * Returns a fresh `ProfileManager` whose in-memory config reflects the
 * current file, for inspecting state the CLI wrote (realm tokens,
 * active profile, …).
 */
export function reloadProfile(home: string): ProfileManager {
  return new ProfileManager(path.join(home, '.boxel-cli'));
}

/**
 * Register the cli-test user in Synapse, idempotently: the account already
 * existing is the expected outcome for a second call, which is what a file
 * that boots the fixture more than once produces (the username is per-process,
 * and Synapse keeps the account for the life of the container). Most tests get
 * this via `startTestRealmServer` (default `registerMatrixUser: true`); tests
 * that opt out and use JWT injection don't need it.
 */
export async function registerCliTestUser(): Promise<void> {
  try {
    await registerUser({
      matrixURL,
      displayname: 'CLI Test User',
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
      registrationSecret: matrixRegistrationSecret,
    });
  } catch (err) {
    // Synapse's admin-register endpoint reports a taken user id with
    // `M_USER_IN_USE`, which `registerUser` surfaces as a thrown error
    // carrying the response body. The account we want exists with the
    // password we want; anything else is a real failure.
    if (!String(err).includes('M_USER_IN_USE')) {
      throw err;
    }
  }
}

/**
 * Set up a test profile that authenticates via Matrix login (the CLI's
 * production path). Pairs with `registerCliTestUser` / `startTestRealmServer`'s
 * default Matrix-registration step.
 */
export async function setupTestProfile(
  pm: ProfileManager,
  realmServerUrl: string = `${TEST_REALM_SERVER_URL}/`,
): Promise<string> {
  let matrixId = `@${TEST_USERNAME}:localhost`;
  // Synapse hashes the password on every login, so this is a real cost in the
  // setup hook rather than a local write — it belongs in the phase list beside
  // the server boot.
  await timePhase('matrix-login', () =>
    pm.addProfile(
      matrixId,
      TEST_PASSWORD,
      'CLI Test User',
      matrixURL.href,
      realmServerUrl,
    ),
  );
  reportSlowFixture();
  return matrixId;
}

/**
 * Set up a test profile by directly injecting a realm-server JWT signed
 * with `realmSecretSeed`. Bypasses the Matrix login flow entirely — no
 * Synapse user registration required. Useful for tests that want to
 * isolate the CLI's HTTP/search behavior from the auth handshake.
 *
 * The injected token is cached in `realmServerToken`, so the CLI's
 * `getOrRefreshServerToken()` short-circuits without attempting login.
 */
export async function setupJwtTestProfile(
  pm: ProfileManager,
  opts: {
    user: string; // matrix-style ID, e.g. '@cli-test:localhost'
    realmServerUrl: string; // realm server origin with trailing slash
    sessionRoom?: string;
  },
): Promise<void> {
  // Use addProfileWithAuth so we skip the real Matrix login round-trip — the
  // injected realm-server JWT means we never need a working Matrix token.
  await pm.addProfileWithAuth(
    opts.user,
    {
      accessToken: 'test-access-token',
      userId: opts.user,
      deviceId: 'CLI_TEST_DEVICE',
      matrixUrl: matrixURL.href,
    },
    'CLI Test User',
    opts.realmServerUrl,
  );
  let jwt = createRealmServerJWT(
    {
      user: opts.user,
      sessionRoom: opts.sessionRoom ?? 'cli-test-session',
    },
    realmSecretSeed,
  );
  pm.setRealmServerToken(jwt);
}

export function uniqueRealmName(): string {
  let ts = Date.now().toString(36);
  let rand = Math.random().toString(36).slice(2, 6);
  return `cli-test-${ts}-${rand}`;
}

/**
 * Create a realm through the CLI binary — `boxel realm create <name>
 * <display>` — rather than the in-process `createRealm`, and return its
 * URL. The command stores a realm token keyed by realm URL in the
 * profile on disk, so we read the URL back from there (matching how the
 * in-process tests derived it from the in-memory profile).
 *
 * Requires a profile already seeded on disk under `<home>/.boxel-cli`
 * (via `setupTestProfile` / `setupJwtTestProfile` on a `ProfileManager`
 * scoped to that home — see `createTestHome`).
 */
export async function createTestRealmViaCli(
  home: string,
  name: string = uniqueRealmName(),
): Promise<{ realmUrl: string; name: string }> {
  let res = await runBoxel(['realm', 'create', name, `Test ${name}`], { home });
  if (!res.ok) {
    throw new Error(
      `\`realm create\` failed (exit ${res.exitCode}):\n${res.stderr}`,
    );
  }
  let realmTokens =
    reloadProfile(home).getActiveProfile()?.profile.realmTokens ?? {};
  let entry = Object.entries(realmTokens).find(([url]) => url.includes(name));
  if (!entry) {
    throw new Error(`No realm JWT stored for ${name} after \`realm create\``);
  }
  return { realmUrl: entry[0], name };
}
