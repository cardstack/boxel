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
  getTestPrerenderer,
  stopTestPrerenderServer,
} from '#realm-server/tests/helpers/index';
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

const TEST_USERNAME = `cli-test-${Date.now()}`;
const TEST_PASSWORD = 'test-password-for-cli';

let testRealmHttpServer: Server | undefined;
let dbAdapter: PgAdapter | undefined;
let publisher: PgQueuePublisher | undefined;
let runner: PgQueueRunner | undefined;

let cachedRealPrerenderer: Prerenderer | undefined;
let realPrerendererStarted = false;

const BOXEL_HOST_URL = process.env.BOXEL_HOST_URL ?? 'http://localhost:4200';

async function probeHostApp(): Promise<boolean> {
  try {
    let res = await fetch(BOXEL_HOST_URL, {
      signal: AbortSignal.timeout(2000),
    });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function getRealPrerenderer(): Promise<Prerenderer> {
  if (!cachedRealPrerenderer) {
    if (!(await probeHostApp())) {
      throw new Error(
        `Real prerenderer requested but ${BOXEL_HOST_URL} is unreachable. ` +
          `Start the host app (e.g. \`pnpm start\` from repo root) or ` +
          `unset useRealPrerenderer.`,
      );
    }
    cachedRealPrerenderer = await getTestPrerenderer();
    realPrerendererStarted = true;
  }
  return cachedRealPrerenderer!;
}

export async function startTestRealmServer(options?: {
  fileSystem?: Record<string, string | LooseSingleCardDocument>;
  /**
   * When true, drive card indexing through the real Chrome-based
   * prerenderer (via realm-server's test helper). Requires the host app
   * to be running at BOXEL_HOST_URL. Default: false (uses noop stub).
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
  if (realPrerendererStarted) {
    await stopTestPrerenderServer();
    cachedRealPrerenderer = undefined;
    realPrerendererStarted = false;
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
