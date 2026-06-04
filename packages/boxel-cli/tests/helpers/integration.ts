import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProfileManager } from '../../src/lib/profile-manager';
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

export const TEST_USERNAME = `cli-test-${Date.now()}`;
export const TEST_PASSWORD = 'test-password-for-cli';

let testRealmHttpServer: Server | undefined;
let activeRealms: Realm[] = [];
let dbAdapter: PgAdapter | undefined;
let publisher: PgQueuePublisher | undefined;
let runner: PgQueueRunner | undefined;
let realmsRootDir: string | undefined;

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
}

export async function startTestRealmServer(
  options: StartTestRealmServerOptions = {},
): Promise<{ realms: Realm[]; testRealmHttpServer: Server }> {
  if (options.realms && options.fileSystem) {
    throw new Error(
      'startTestRealmServer: pass either `realms` or `fileSystem`, not both',
    );
  }

  prepareTestDB();
  dbAdapter = await createTestPgAdapter();
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

  let result = await runTestRealmServerWithRealms({
    realmsRootPath: path.join(realmsRootDir, 'realm_server_1'),
    realms,
    virtualNetwork,
    publisher,
    runner,
    dbAdapter,
    matrixURL,
    prerenderer: options.prerenderer ?? noopPrerenderer,
  });

  testRealmHttpServer = result.testRealmHttpServer;
  activeRealms = result.realms;

  if (options.registerMatrixUser !== false) {
    await registerCliTestUser();
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

export async function stopTestRealmServer(): Promise<void> {
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
    await runner.destroy();
    runner = undefined;
  }
  if (dbAdapter) {
    await dbAdapter.close();
    dbAdapter = undefined;
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
 * Register the cli-test user in Synapse. Re-registering an existing user
 * produces a benign 4xx that callers can ignore. Most tests get this via
 * `startTestRealmServer` (default `registerMatrixUser: true`); tests that
 * opt out and use JWT injection don't need it.
 */
export async function registerCliTestUser(): Promise<void> {
  await registerUser({
    matrixURL,
    displayname: 'CLI Test User',
    username: TEST_USERNAME,
    password: TEST_PASSWORD,
    registrationSecret: matrixRegistrationSecret,
  });
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
  await pm.addProfile(
    matrixId,
    TEST_PASSWORD,
    'CLI Test User',
    matrixURL.href,
    realmServerUrl,
  );
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
