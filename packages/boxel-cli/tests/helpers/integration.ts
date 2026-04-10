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
import { registerUser } from '#realm-server/synapse';
import {
  PgQueuePublisher,
  PgQueueRunner,
  type PgAdapter,
} from '@cardstack/postgres';
import type { Prerenderer } from '@cardstack/runtime-common';
import type { Server } from 'http';

// CLI tests don't need card rendering — stub out the prerenderer
// so we don't launch Chrome.
const noopPrerenderer: Prerenderer = {
  prerenderCard: async () => ({ html: '', status: 200 }) as any,
  prerenderModule: async () => ({ html: '', status: 200 }) as any,
  prerenderFileExtract: async () => ({ html: '', status: 200 }) as any,
  prerenderFileRender: async () => ({ html: '', status: 200 }) as any,
  runCommand: async () => ({ status: 'ready' }),
};

export const TEST_REALM_SERVER_URL = 'http://127.0.0.1:4446';

const TEST_USERNAME = `cli-test-${Date.now()}`;
const TEST_PASSWORD = 'test-password-for-cli';

let testRealmHttpServer: Server | undefined;
let dbAdapter: PgAdapter | undefined;
let publisher: PgQueuePublisher | undefined;
let runner: PgQueueRunner | undefined;

export async function startTestRealmServer(): Promise<void> {
  prepareTestDB();
  dbAdapter = await createTestPgAdapter();
  publisher = new PgQueuePublisher(dbAdapter);
  runner = new PgQueueRunner({
    adapter: dbAdapter,
    workerId: 'cli-test-worker',
  });

  let virtualNetwork = createVirtualNetwork();
  let realmURL = new URL(`${TEST_REALM_SERVER_URL}/test/`);

  let { testRealmHttpServer: server } = await runTestRealmServer({
    testRealmDir: fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-cli-realm-')),
    realmsRootPath: fs.mkdtempSync(
      path.join(os.tmpdir(), 'boxel-cli-realms-root-'),
    ),
    realmURL,
    virtualNetwork,
    publisher,
    runner,
    dbAdapter,
    matrixURL,
    permissions: {
      '*': ['read', 'write'],
    },
    prerenderer: noopPrerenderer,
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
