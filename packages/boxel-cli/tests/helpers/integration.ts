import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProfileManager } from '../../src/lib/profile-manager';
import {
  prepareTestDB,
  createTestPgAdapter,
  createVirtualNetwork,
  runTestRealmServer,
  closeServer,
  matrixURL,
  matrixRegistrationSecret,
} from '#realm-server/tests/helpers/index';
import { createRemotePrerenderer } from '#realm-server/prerender/remote-prerenderer';
import { registerUser } from '#realm-server/synapse';
import {
  PgQueuePublisher,
  PgQueueRunner,
  type PgAdapter,
} from '@cardstack/postgres';
import type {
  Prerenderer,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import type { Server } from 'http';

// Default prerenderer for CLI integration tests — returns empty render
// output so we don't depend on Chrome or a running host app. Tests that
// need real card indexing (e.g. content-based search assertions) opt in
// via `useRealPrerenderer: true`.
const noopPrerenderer: Prerenderer = {
  prerenderModule: async () => ({ html: '', status: 200 }) as any,
  prerenderVisit: async () => ({}) as any,
  runCommand: async () => ({ status: 'ready' }),
};

export const TEST_REALM_SERVER_URL = 'http://127.0.0.1:4446';
// Normalize `localhost` to `127.0.0.1` so Node 24 / undici doesn't try `::1`
// first and fail when the prerender manager binds IPv4 only. Matches the
// existing convention in `packages/realm-server/tests/helpers/index.ts:191`
// (testPrerenderHost = '127.0.0.1') and `setup-localhost-resolver.ts`.
const PRERENDER_MGR_URL = (
  process.env.PRERENDER_MGR_URL ?? 'http://localhost:4222'
).replace('://localhost', '://127.0.0.1');

const TEST_USERNAME = `cli-test-${Date.now()}`;
const TEST_PASSWORD = 'test-password-for-cli';

let testRealmHttpServer: Server | undefined;
let dbAdapter: PgAdapter | undefined;
let publisher: PgQueuePublisher | undefined;
let runner: PgQueueRunner | undefined;

let cachedRealPrerenderer: Prerenderer | undefined;

// We use the real prerenderer (and thus real Chrome-based indexing) for some
// tests, but since it requires the full dev stack to be running we don't want
// to make it the default. This helper provides a cached instance of the real
// prerenderer for tests that opt in.
// Please start the dev stack before running tests that use this,
// and make sure the PRERENDER_MGR_URL is correct (it should point to the prerender manager in the dev stack,
// which is separate from the realm server's test helper prerenderer).
async function getRealPrerenderer(): Promise<Prerenderer> {
  if (!cachedRealPrerenderer) {
    cachedRealPrerenderer = createRemotePrerenderer(PRERENDER_MGR_URL);
  }
  return cachedRealPrerenderer!;
}

export async function startTestRealmServer(options?: {
  fileSystem?: Record<string, string | LooseSingleCardDocument>;
  /**
   * When true, drive card indexing through the real Chrome-based
   * prerenderer (via realm-server's test helper). Requires the dev
   * stack (host app + base realm + prerender service) to be running.
   * Default: false (uses noop stub).
   */
  useRealPrerenderer?: boolean;
}): Promise<void> {
  prepareTestDB();
  dbAdapter = await createTestPgAdapter();
  publisher = new PgQueuePublisher(dbAdapter);
  runner = new PgQueueRunner({
    adapter: dbAdapter,
    workerId: 'cli-test-worker',
  });

  let virtualNetwork = createVirtualNetwork();
  let realmURL = new URL(`${TEST_REALM_SERVER_URL}/test/`);

  let prerenderer = options?.useRealPrerenderer
    ? await getRealPrerenderer()
    : noopPrerenderer;

  let { testRealmHttpServer: server } = await runTestRealmServer({
    testRealmDir: fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-cli-realm-')),
    realmsRootPath: fs.mkdtempSync(
      path.join(os.tmpdir(), 'boxel-cli-realms-root-'),
    ),
    fileSystem: options?.fileSystem,
    realmURL,
    virtualNetwork,
    publisher,
    runner,
    dbAdapter,
    matrixURL,
    permissions: {
      '*': ['read', 'write'],
      [`@${TEST_USERNAME}:localhost`]: ['read', 'write', 'realm-owner'],
    },
    prerenderer,
  });

  testRealmHttpServer = server;

  // Register a test user in Synapse so CLI can do a full Matrix login
  await registerUser({
    matrixURL,
    displayname: 'CLI Test User',
    username: TEST_USERNAME,
    password: TEST_PASSWORD,
    registrationSecret: matrixRegistrationSecret,
  });
}

export async function stopTestRealmServer(): Promise<void> {
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
  // No prerender server to stop — `getRealPrerenderer()` connects to the
  // dev stack's manager via PRERENDER_MGR_URL rather than starting one.
  cachedRealPrerenderer = undefined;
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

export async function setupTestProfile(pm: ProfileManager): Promise<string> {
  let matrixId = `@${TEST_USERNAME}:localhost`;
  await pm.addProfile(
    matrixId,
    TEST_PASSWORD,
    'CLI Test User',
    matrixURL.href,
    `${TEST_REALM_SERVER_URL}/`,
  );
  return matrixId;
}

export function uniqueRealmName(): string {
  let ts = Date.now().toString(36);
  let rand = Math.random().toString(36).slice(2, 6);
  return `cli-test-${ts}-${rand}`;
}
