import '../instrument';
import '../setup-logger';

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative, resolve } from 'path';

import {
  Realm,
  VirtualNetwork,
  CachingDefinitionLookup,
  DEFAULT_CARD_SIZE_LIMIT_BYTES,
  DEFAULT_FILE_SIZE_LIMIT_BYTES,
  IndexWriter,
  insertPermissions,
  baseRealm,
  Worker,
  type RealmPermissions,
  type RealmAdapter,
} from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  PgAdapter,
  PgQueuePublisher,
  PgQueueRunner,
} from '@cardstack/postgres';
import { ensureDirSync, copySync } from 'fs-extra';

import * as ContentTagGlobal from 'content-tag';

import 'decorator-transforms/globals';
import { NodeAdapter } from '../node-realm';
import { RealmServer } from '../server';
import { createRemotePrerenderer } from '../prerender/remote-prerenderer';
import { buildCreatePrerenderAuth } from '../prerender/auth';

(globalThis as any).ContentTagGlobal = ContentTagGlobal;

const workspaceRoot = resolve(__dirname, '..', '..', '..');
const packageRoot = resolve(__dirname, '..');
const baseRealmDir = resolve(packageRoot, '..', 'base');
const skillsRealmDir = resolve(packageRoot, '..', 'skills-realm', 'contents');
const REALM_SECRET_SEED =
  process.env.REALM_SECRET_SEED ?? "shhh! it's a secret";
const REALM_SERVER_SECRET_SEED =
  process.env.REALM_SERVER_SECRET_SEED ?? "mum's the word";
const GRAFANA_SECRET = process.env.GRAFANA_SECRET ?? "shhh! it's a secret";
const DEFAULT_HOST_URL = process.env.HOST_URL ?? 'http://localhost:4200/';
const INCLUDE_SKILLS = process.env.SOFTWARE_FACTORY_INCLUDE_SKILLS === '1';
const TRACE_TIMINGS = process.env.SOFTWARE_FACTORY_TRACE_TIMINGS === '1';
const DEFAULT_MATRIX_SERVER_USERNAME =
  process.env.SOFTWARE_FACTORY_MATRIX_SERVER_USERNAME ?? 'realm_server';
const TEST_REALM_MATRIX_USERNAME =
  process.env.SOFTWARE_FACTORY_TEST_REALM_MATRIX_USERNAME ?? 'test_realm';
const BASE_REALM_MATRIX_USERNAME =
  process.env.SOFTWARE_FACTORY_BASE_REALM_MATRIX_USERNAME ?? 'base_realm';
const SKILLS_REALM_MATRIX_USERNAME =
  process.env.SOFTWARE_FACTORY_SKILLS_REALM_MATRIX_USERNAME ?? 'skills_realm';
const createPrerenderAuth = buildCreatePrerenderAuth(REALM_SECRET_SEED);

let rootDir: string | undefined;
let httpServer: import('http').Server | undefined;
let realms: Realm[] = [];
let publisher: PgQueuePublisher | undefined;
let runner: PgQueueRunner | undefined;
let dbAdapter: PgAdapter | undefined;

type RuntimeStartPayload = {
  realmDir: string;
  realmURL: string;
  databaseName: string;
  permissions: RealmPermissions;
  fullIndexOnStartup: boolean;
  autoMigrate: boolean;
};

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!TRACE_TIMINGS) {
    return await fn();
  }
  let startedAt = nowMs();
  try {
    return await fn();
  } finally {
    console.error(
      `[software-factory in-process timing] ${label}: ${(
        nowMs() - startedAt
      ).toFixed(1)}ms`,
    );
  }
}

function shouldIgnoreFixturePath(relativePath: string): boolean {
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

function copyRealmFixture(realmDir: string, destination: string): void {
  copySync(realmDir, destination, {
    preserveTimestamps: true,
    filter(src) {
      let relativePath = relative(realmDir, src).replace(/\\/g, '/');
      return relativePath === '' || !shouldIgnoreFixturePath(relativePath);
    },
  });
}

async function ensureMatrixUserRecord(
  adapter: PgAdapter,
  matrixUserId: string,
): Promise<void> {
  await adapter.execute(
    `INSERT INTO users (matrix_user_id) VALUES ($1) ON CONFLICT (matrix_user_id) DO NOTHING`,
    { bind: [matrixUserId] },
  );
}

function localBaseRealmURL(realmURL: URL): URL {
  return new URL('/base/', realmURL.origin);
}

function localSkillsRealmURL(realmURL: URL): URL {
  return new URL('/skills/', realmURL.origin);
}

function ownedReadOnlyPermissions(username: string): RealmPermissions {
  return {
    '*': ['read'],
    [`@${username}:localhost`]: ['read', 'realm-owner'],
  };
}

async function fetchIndexHTML() {
  let request = await fetch(DEFAULT_HOST_URL);
  return await request.text();
}

async function createManagedRealm({
  dir,
  realmURL,
  realmServerURL,
  permissions,
  matrixURL,
  matrixUsername,
  virtualNetwork,
  definitionLookup,
  fullIndexOnStartup,
}: {
  dir: string;
  realmURL: URL;
  realmServerURL: URL;
  permissions: RealmPermissions;
  matrixURL: URL;
  matrixUsername: string;
  virtualNetwork: VirtualNetwork;
  definitionLookup: CachingDefinitionLookup;
  fullIndexOnStartup: boolean;
}): Promise<{ realm: Realm; adapter: RealmAdapter }> {
  if (!dbAdapter || !publisher) {
    throw new Error('realm runtime is not initialized');
  }
  await insertPermissions(dbAdapter, realmURL, permissions);
  for (let username of Object.keys(permissions)) {
    if (username !== '*') {
      await ensureMatrixUserRecord(dbAdapter, username);
    }
  }

  let adapter = new NodeAdapter(dir);
  let matrixClient = new MatrixClient({
    matrixURL,
    username: matrixUsername,
    seed: REALM_SECRET_SEED,
  });
  let realm = new Realm(
    {
      url: realmURL.href,
      adapter,
      secretSeed: REALM_SECRET_SEED,
      dbAdapter,
      queue: publisher,
      virtualNetwork,
      matrixClient,
      realmServerURL: realmServerURL.href,
      definitionLookup,
      cardSizeLimitBytes: Number(
        process.env.CARD_SIZE_LIMIT_BYTES ?? DEFAULT_CARD_SIZE_LIMIT_BYTES,
      ),
      fileSizeLimitBytes: Number(
        process.env.FILE_SIZE_LIMIT_BYTES ?? DEFAULT_FILE_SIZE_LIMIT_BYTES,
      ),
    },
    fullIndexOnStartup ? { fullIndexOnStartup: true } : undefined,
  );
  await realm.logInToMatrix();
  virtualNetwork.mount(realm.handle);
  return { realm, adapter };
}

async function cleanup() {
  let errors: unknown[] = [];

  for (let realm of realms) {
    try {
      realm.unsubscribe();
    } catch (error) {
      errors.push(error);
    }
  }
  realms = [];

  try {
    httpServer?.closeAllConnections?.();
    if (httpServer?.listening) {
      await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    }
  } catch (error) {
    errors.push(error);
  }

  try {
    await publisher?.destroy();
  } catch (error) {
    errors.push(error);
  }
  publisher = undefined;

  try {
    await runner?.destroy();
  } catch (error) {
    errors.push(error);
  }
  runner = undefined;

  try {
    if (dbAdapter && !dbAdapter.isClosed) {
      await dbAdapter.close();
    }
  } catch (error) {
    errors.push(error);
  }
  dbAdapter = undefined;

  if (rootDir) {
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
    rootDir = undefined;
  }

  if (errors.length) {
    throw errors[0];
  }
}

function parseRuntimeStartPayload(): RuntimeStartPayload | undefined {
  let realmDir = process.env.SOFTWARE_FACTORY_REALM_DIR;
  let realmURL = process.env.SOFTWARE_FACTORY_REALM_URL;
  let databaseName = process.env.SOFTWARE_FACTORY_DATABASE_NAME;
  if (!realmDir || !realmURL || !databaseName) {
    return undefined;
  }
  return {
    realmDir,
    realmURL,
    databaseName,
    permissions: (process.env.SOFTWARE_FACTORY_PERMISSIONS
      ? JSON.parse(process.env.SOFTWARE_FACTORY_PERMISSIONS)
      : { '*': ['read'] }) as RealmPermissions,
    fullIndexOnStartup:
      process.env.SOFTWARE_FACTORY_FULL_INDEX_ON_STARTUP === 'true',
    autoMigrate: process.env.SOFTWARE_FACTORY_AUTO_MIGRATE === 'true',
  };
}

async function startRuntime({
  realmDir,
  realmURL: realmURLString,
  databaseName,
  permissions,
  fullIndexOnStartup,
  autoMigrate,
}: RuntimeStartPayload) {
  let matrixURLString = process.env.SOFTWARE_FACTORY_MATRIX_URL;
  let prerenderURL = process.env.SOFTWARE_FACTORY_PRERENDER_URL;
  let matrixRegistrationSecret =
    process.env.SOFTWARE_FACTORY_MATRIX_REGISTRATION_SECRET;

  if (!matrixURLString || !prerenderURL || !matrixRegistrationSecret) {
    throw new Error('software factory realm runner is missing required env');
  }

  process.env.PGHOST = process.env.PGHOST ?? '127.0.0.1';
  process.env.PGPORT = process.env.PGPORT ?? '55436';
  process.env.PGUSER = process.env.PGUSER ?? 'postgres';
  process.env.PGDATABASE = databaseName;
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
  process.env.NODE_NO_WARNINGS = '1';

  let realmURL = new URL(realmURLString);
  let matrixURL = new URL(matrixURLString);

  rootDir = mkdtempSync(join(tmpdir(), 'software-factory-realms-'));
  let testRealmDir = join(rootDir, 'test');
  ensureDirSync(testRealmDir);
  await timed('copy realm fixture', async () => {
    copyRealmFixture(resolve(workspaceRoot, realmDir), testRealmDir);
  });

  dbAdapter = new PgAdapter(
    autoMigrate ? { autoMigrate: true, migrationLogging: false } : {},
  );
  publisher = new PgQueuePublisher(dbAdapter);
  runner = new PgQueueRunner({
    adapter: dbAdapter,
    workerId: `software-factory-${databaseName}`,
  });

  let virtualNetwork = new VirtualNetwork();
  virtualNetwork.addURLMapping(
    new URL(baseRealm.url),
    localBaseRealmURL(realmURL),
  );
  let prerenderer = createRemotePrerenderer(prerenderURL);
  let definitionLookup = new CachingDefinitionLookup(
    dbAdapter,
    prerenderer,
    virtualNetwork,
    createPrerenderAuth,
  );
  let worker = new Worker({
    indexWriter: new IndexWriter(dbAdapter),
    queue: runner,
    dbAdapter,
    queuePublisher: publisher,
    virtualNetwork,
    matrixURL,
    secretSeed: REALM_SECRET_SEED,
    realmServerMatrixUsername: DEFAULT_MATRIX_SERVER_USERNAME,
    prerenderer,
    createPrerenderAuth,
  });
  await worker.run();

  let createdRealms = await timed('create in-process realms', async () => {
    let testRealm = await createManagedRealm({
      dir: testRealmDir,
      realmURL,
      realmServerURL: new URL(realmURL.origin),
      permissions,
      matrixURL,
      matrixUsername: TEST_REALM_MATRIX_USERNAME,
      virtualNetwork,
      definitionLookup,
      fullIndexOnStartup,
    });
    let localBaseRealm = await createManagedRealm({
      dir: baseRealmDir,
      realmURL: new URL(baseRealm.url),
      realmServerURL: new URL(realmURL.origin),
      permissions: ownedReadOnlyPermissions(BASE_REALM_MATRIX_USERNAME),
      matrixURL,
      matrixUsername: BASE_REALM_MATRIX_USERNAME,
      virtualNetwork,
      definitionLookup,
      fullIndexOnStartup,
    });
    let loaded = [testRealm, localBaseRealm];

    if (INCLUDE_SKILLS) {
      loaded.push(
        await createManagedRealm({
          dir: skillsRealmDir,
          realmURL: localSkillsRealmURL(realmURL),
          realmServerURL: new URL(realmURL.origin),
          permissions: ownedReadOnlyPermissions(SKILLS_REALM_MATRIX_USERNAME),
          matrixURL,
          matrixUsername: SKILLS_REALM_MATRIX_USERNAME,
          virtualNetwork,
          definitionLookup,
          fullIndexOnStartup,
        }),
      );
    }

    return loaded;
  });
  realms = createdRealms.map(({ realm }) => realm);

  let matrixClient = new MatrixClient({
    matrixURL,
    username: DEFAULT_MATRIX_SERVER_USERNAME,
    seed: REALM_SECRET_SEED,
  });
  let server = new RealmServer({
    realms,
    virtualNetwork,
    matrixClient,
    realmServerSecretSeed: REALM_SERVER_SECRET_SEED,
    realmSecretSeed: REALM_SECRET_SEED,
    matrixRegistrationSecret,
    realmsRootPath: rootDir,
    dbAdapter,
    queue: publisher,
    getIndexHTML: fetchIndexHTML,
    grafanaSecret: GRAFANA_SECRET,
    serverURL: new URL(realmURL.origin),
    assetsURL: new URL(DEFAULT_HOST_URL),
    domainsForPublishedRealms: {
      boxelSpace: `localhost:${realmURL.port}`,
      boxelSite: `localhost:${realmURL.port}`,
    },
    definitionLookup,
    prerenderer,
  });

  httpServer = server.listen(parseInt(realmURL.port));
  await timed('start in-process realm server', async () => {
    await server.start();
  });
}

async function main() {
  let initialRuntime = parseRuntimeStartPayload();
  if (initialRuntime) {
    await startRuntime(initialRuntime);
  }
  process.send?.('ready');
}

process.on('message', async (message) => {
  if (typeof message === 'object' && message && 'type' in message) {
    let typedMessage = message as
      | { type: 'start-runtime'; payload: RuntimeStartPayload }
      | { type: 'stop-runtime' };
    if (typedMessage.type === 'start-runtime') {
      try {
        await cleanup();
        await startRuntime(typedMessage.payload);
        process.send?.({ type: 'runtime-started' });
      } catch (error) {
        console.error(error);
        try {
          await cleanup();
        } catch {
          // best effort cleanup
        }
        process.send?.({
          type: 'runtime-error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (typedMessage.type === 'stop-runtime') {
      await cleanup();
      process.send?.({ type: 'runtime-stopped' });
      return;
    }
  }

  if (message === 'stop') {
    try {
      await cleanup();
    } finally {
      process.send?.('stopped');
    }
  } else if (message === 'kill') {
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  cleanup()
    .catch((error) => {
      console.error(error);
    })
    .finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  cleanup()
    .catch((error) => {
      console.error(error);
    })
    .finally(() => process.exit(0));
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
