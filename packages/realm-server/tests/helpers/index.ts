import fsExtra from 'fs-extra';
const {
  writeFileSync,
  writeJSONSync,
  readdirSync,
  statSync,
  ensureDirSync,
  copySync,
} = fsExtra;
import { NodeAdapter } from '../../node-realm.ts';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import type {
  LooseSingleCardDocument,
  RealmPermissions,
  User,
  Subscription,
  Plan,
  RealmAdapter,
  DefinitionLookup,
  Query,
  CardResource,
  FileMetaResource,
  QueryResultsMeta,
} from '@cardstack/runtime-common';
import {
  Realm,
  searchEntryWireQueryFromQuery,
  parseSearchEntryQueryFromPayload,
  baseRealm,
  VirtualNetwork,
  Worker,
  insertPermissions,
  IndexWriter,
  asExpressions,
  query,
  insert,
  param,
  unixTime,
  uuidv4,
  RealmPaths,
  PUBLISHED_DIRECTORY_NAME,
  DEFAULT_CARD_SIZE_LIMIT_BYTES,
  DEFAULT_FILE_SIZE_LIMIT_BYTES,
  type MatrixConfig,
  type QueuePublisher,
  type QueueRunner,
  type Prerenderer,
  type PopulateCoordinator,
  CachingDefinitionLookup,
} from '@cardstack/runtime-common';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms.ts';
import { dirSync, setGracefulCleanup, type DirResult } from 'tmp';
import { getLocalConfig as getSynapseConfig } from '../../synapse.ts';
import { RealmServer } from '../../server.ts';
import jsonwebtoken from 'jsonwebtoken';
const { sign: jwtSign } = jsonwebtoken;
import {
  RealmRegistryReconciler,
  type RealmRegistryRow,
} from '../../lib/realm-registry-reconciler.ts';
import { upsertPublishedRealmInRegistry } from '../../lib/realm-registry-writes.ts';

import {
  PgAdapter,
  PgQueuePublisher,
  PgQueueRunner,
} from '@cardstack/postgres';
import type { RealmHttpServer as Server } from '../../server.ts';
import { Socket as NetSocket } from 'net';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  Prerenderer as LocalPrerenderer,
  type Prerenderer as TestPrerenderer,
} from '../../prerender/index.ts';

import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import type {
  IncrementalIndexEventContent,
  MatrixEvent,
  RealmEvent,
  RealmEventContent,
} from 'https://cardstack.com/base/matrix-event';
import { createRemotePrerenderer } from '../../prerender/remote-prerenderer.ts';
import { createPrerenderHttpServer } from '../../prerender/prerender-app.ts';
import { buildCreatePrerenderAuth } from '../../prerender/auth.ts';
import { Client as PgClient } from 'pg';
import {
  isEnvironmentMode,
  getEnvironmentSlug,
  serviceURL,
} from '../../lib/dev-service-registry.ts';

/**
 * In environment mode we shift test ports by a deterministic offset derived
 * from the environment slug so that parallel environments never collide.
 */
function environmentPortOffset(): number {
  if (!isEnvironmentMode()) {
    return 0;
  }
  let slug = getEnvironmentSlug();
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash << 5) - hash + slug.charCodeAt(i)) | 0;
  }
  // offset in range [1000, 9000) — keeps ports well within valid range
  return 1000 + (Math.abs(hash) % 8000);
}

/** Return a test port, shifted by a per-environment offset when needed. */
// Test-only: fetch the card/file-meta serializations matching a card-rooted
// `Query` through the entry engine, returning them in the
// `{ data, meta }` collection shape index assertions read. Requests the
// data-only fieldset (one full `item` per entry).
export async function searchCardsForTest(
  engine: Realm['realmIndexQueryEngine'],
  cardQuery: Query,
  opts?: Parameters<Realm['realmIndexQueryEngine']['searchEntries']>[1],
): Promise<{
  data: (CardResource | FileMetaResource)[];
  included: (CardResource | FileMetaResource)[];
  meta: QueryResultsMeta;
}> {
  let doc = await engine.searchEntries(
    parseSearchEntryQueryFromPayload(
      searchEntryWireQueryFromQuery(cardQuery, { fields: ['item'] }),
    ),
    opts,
  );
  // The top-level result items (one per entry, by the entry's `item` rel) land
  // in `data`; every other linked card/file-meta resource is sideloaded in
  // `included` — the legacy collection shape these assertions read.
  // Key by the full `(type, id)` the entry `item` relationship carries,
  // not `id` alone — matches the wire contract (and the store's resolver).
  let itemKeys = new Set<string>();
  for (let entry of doc.data) {
    let ref = entry.relationships.item?.data;
    if (ref) {
      itemKeys.add(`${ref.type}:${ref.id}`);
    }
  }
  let itemsByKey = new Map<string, CardResource | FileMetaResource>();
  let included: (CardResource | FileMetaResource)[] = [];
  for (let resource of doc.included ?? []) {
    if (resource.type !== 'card' && resource.type !== 'file-meta') {
      continue;
    }
    if (resource.id == null) {
      continue;
    }
    let key = `${resource.type}:${resource.id}`;
    if (itemKeys.has(key)) {
      itemsByKey.set(key, resource);
    } else {
      included.push(resource);
    }
  }
  let data = doc.data
    .map((entry) => entry.relationships.item?.data)
    .filter((ref): ref is NonNullable<typeof ref> => ref != null)
    .map((ref) => itemsByKey.get(`${ref.type}:${ref.id}`))
    .filter((item): item is CardResource | FileMetaResource => Boolean(item));
  return { data, included, meta: doc.meta };
}

export function testPort(basePort: number): number {
  return basePort + environmentPortOffset();
}

const testRealmURL = new URL(`http://127.0.0.1:${testPort(4444)}/`);
const testRealmHref = testRealmURL.href;

/** Build the default test-realm URL with an optional sub-path. */
export function testRealmURLFor(path: string): URL {
  return new URL(path, testRealmURL);
}

const migratedTestDatabaseTemplate = 'boxel_migrated_template';

export const testRealmServerMatrixUsername = 'node-test_realm-server';
export const testRealmServerMatrixUserId = `@${testRealmServerMatrixUsername}:localhost`;

export type RealmRequest = {
  get(path: string): Test;
  post(path: string): Test;
  put(path: string): Test;
  patch(path: string): Test;
  delete(path: string): Test;
  head(path: string): Test;
};

export function withRealmPath(
  request: SuperTest<Test>,
  realmURL: URL,
): RealmRequest {
  let realmPath = realmURL.pathname.replace(/\/?$/, '/');
  let prefixPath = (path: string) => {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    if (path.startsWith(realmPath)) {
      return path;
    }
    if (path.startsWith('/')) {
      return `${realmPath}${path.slice(1)}`;
    }
    return `${realmPath}${path}`;
  };
  return {
    get: (path: string) => request.get(prefixPath(path)),
    post: (path: string) => request.post(prefixPath(path)),
    put: (path: string) => request.put(prefixPath(path)),
    patch: (path: string) => request.patch(prefixPath(path)),
    delete: (path: string) => request.delete(prefixPath(path)),
    head: (path: string) => request.head(prefixPath(path)),
  };
}

export { testRealmHref, testRealmURL };

const REALM_EVENT_TS_SKEW_BUFFER_MS = 2000;

export async function waitUntil<T>(
  condition: () => Promise<T>,
  options: {
    timeout?: number;
    interval?: number;
    timeoutMessage?: string | (() => string);
  } = {},
): Promise<T> {
  let timeout = options.timeout ?? 1000;
  let interval = options.interval ?? 250;

  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await condition();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  let message =
    typeof options.timeoutMessage === 'function'
      ? options.timeoutMessage()
      : options.timeoutMessage;
  throw new Error(
    'Timeout waiting for condition' + (message ? `: ${message}` : ''),
  );
}

export const testRealm = 'http://test-realm/';
export const localBaseRealm = isEnvironmentMode()
  ? `${serviceURL('realm-server')}/base`
  : 'http://localhost:4201/base';
export const matrixURL = new URL(
  isEnvironmentMode() ? serviceURL('matrix') : 'http://localhost:8008',
);
const testPrerenderHost = '127.0.0.1';
const testPrerenderPort = testPort(4460);

export const testRealmInfo = {
  name: 'Test Realm',
  backgroundURL: null,
  iconURL: null,
  showAsCatalog: null,
  visibility: 'public',
  realmUserId: testRealmServerMatrixUserId,
  publishable: null,
  lastPublishedAt: null,
  includePrerenderedDefaultRealmIndex: null,
};

export const realmServerTestMatrix: MatrixConfig = {
  url: matrixURL,
  username: 'node-test_realm-server',
};
export const realmServerSecretSeed = "mum's the word";
export const realmSecretSeed = `shhh! it's a secret`;
export const grafanaSecret = `shhh! it's a secret`;
export const aiBotDelegationSecret = `delegation shared secret for tests`;

function getMatrixRegistrationSecret(): string {
  let secret =
    getSynapseConfig()?.registration_shared_secret ??
    process.env.MATRIX_REGISTRATION_SHARED_SECRET;

  if (!secret) {
    throw new Error(
      'Missing Matrix registration shared secret. Start Synapse first or set MATRIX_REGISTRATION_SHARED_SECRET.',
    );
  }

  return secret;
}

export const matrixRegistrationSecret = getMatrixRegistrationSecret();
export const testCreatePrerenderAuth =
  buildCreatePrerenderAuth(realmSecretSeed);

const PRERENDER_POOL_CAPACITY_OVERRIDE_ENV_KEYS = [
  'PRERENDER_PAGE_POOL_MIN',
  'PRERENDER_PAGE_POOL_MAX',
  'PRERENDER_PAGE_POOL_INITIAL',
  'PRERENDER_PAGE_POOL_HIGH_PRIORITY_MAX',
  'PRERENDER_HIGH_PRIORITY_THRESHOLD',
  'PRERENDER_POOL_IDLE_CONTRACTION_MS',
] as const;

function withEnvUnset<T>(keys: readonly string[], fn: () => T): T {
  let previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (let key of keys) {
      delete process.env[key];
    }
    return fn();
  } finally {
    for (let [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

let prerenderServer: Server | undefined;
let prerenderServerStart: Promise<void> | undefined;
const trackedServers = new Set<Server>();
const trackedPrerenderers = new Set<TestPrerenderer>();
const trackedDbAdapters = new Set<PgAdapter>();
const trackedQueuePublishers = new Set<QueuePublisher>();
const trackedQueueRunners = new Set<QueueRunner>();

export function cleanWhiteSpace(text: string) {
  return text
    .replace(/<!---->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createVirtualNetwork() {
  let virtualNetwork = new VirtualNetwork();
  virtualNetwork.addURLMapping(new URL(baseRealm.url), new URL(localBaseRealm));
  // Mirror the host's network.ts and main.ts symmetry: when the
  // baseRealm fake URL is registered as a URL alias, also register the
  // @cardstack/base/ realm-prefix mapping so unresolveURL on either
  // form canonicalises to the same RRI.
  virtualNetwork.addRealmMapping('@cardstack/base/', localBaseRealm);
  return virtualNetwork;
}

let testDbCounter = 0;

// Build a reconciler suitable for tests. Pre-constructed realms (passed
// via `realms`) are registered into `mounted` so subsequent
// lookupOrMount() calls resolve from the fast path.
//
// When `dynamicMountDeps` is provided, prepareRealmFromRow constructs a
// real Realm from a registry row — required by Phase 3 stateless
// handler tests where /_create-realm + /_publish-realm only write to
// realm_registry and rely on the reconciler / lazy mount to mount on
// first request. Without these deps, lookupOrMount on an
// unpre-mounted URL throws (used by tests that don't exercise the
// dynamic-creation path).
//
// unmount on the test reconciler calls realm.unsubscribe() (matches
// production) and removes the realm from realms[] / virtualNetwork so
// the deletion-path assertions about file-watcher cleanup work the
// same way they did pre-Phase 3.
export function makeTestReconciler(
  dbAdapter: PgAdapter,
  realms: Realm[],
  dynamicMountDeps?: {
    realmsRootPath: string;
    virtualNetwork: VirtualNetwork;
    queue: QueuePublisher;
    matrixClient: MatrixClient;
    serverURL: URL;
    definitionLookup: CachingDefinitionLookup;
    enableFileWatcher?: boolean;
  },
): RealmRegistryReconciler {
  let reconciler = new RealmRegistryReconciler({
    dbAdapter,
    prepareRealmFromRow: (row: RealmRegistryRow) => {
      if (!dynamicMountDeps) {
        throw new Error(
          `test reconciler cannot construct realms; URL not pre-mounted: ${row.url}`,
        );
      }
      let diskPath: string;
      if (row.kind === 'bootstrap') {
        diskPath = row.disk_id;
      } else if (row.kind === 'source') {
        diskPath = join(dynamicMountDeps.realmsRootPath, row.disk_id);
      } else {
        diskPath = join(
          dynamicMountDeps.realmsRootPath,
          PUBLISHED_DIRECTORY_NAME,
          row.disk_id,
        );
      }
      let adapter = new NodeAdapter(
        diskPath,
        dynamicMountDeps.enableFileWatcher,
      );
      let reconciledRealm = new Realm({
        url: row.url,
        adapter,
        secretSeed: realmSecretSeed,
        virtualNetwork: dynamicMountDeps.virtualNetwork,
        dbAdapter,
        queue: dynamicMountDeps.queue,
        matrixClient: dynamicMountDeps.matrixClient,
        realmServerURL: dynamicMountDeps.serverURL.href,
        definitionLookup: dynamicMountDeps.definitionLookup,
      });
      realms.push(reconciledRealm);
      dynamicMountDeps.virtualNetwork.mount(reconciledRealm.handle);
      return reconciledRealm;
    },
    unmount: async (realm) => {
      realm.unsubscribe();
      if (dynamicMountDeps) {
        dynamicMountDeps.virtualNetwork.unmount(realm.handle);
      }
      let idx = realms.findIndex((r) => r.url === realm.url);
      if (idx !== -1) {
        realms.splice(idx, 1);
      }
    },
  });
  reconciler.registerExistingMounts(realms);
  return reconciler;
}

export function prepareTestDB(): void {
  // PID + monotonic counter rules out same-process collisions and makes
  // cross-process collisions essentially impossible. The previous
  // `Math.random() * 10_000_000` form had ~0.6% birthday-paradox collision
  // probability across ~350 tests in a shard, which surfaced in CI as
  // `database "test_db_<n>" already exists` from cloneTestDBFromTemplate.
  process.env.PGDATABASE = `test_db_${process.pid}_${++testDbCounter}`;
}

function pgAdminConnectionConfig() {
  return {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || undefined,
    database: 'postgres',
  };
}

function quotePgIdentifier(identifier: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
    throw new Error(`unsafe postgres identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function withPgDatabaseEnv<T>(
  databaseName: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  let previousDatabase = process.env.PGDATABASE;
  process.env.PGDATABASE = databaseName;
  try {
    return await fn();
  } finally {
    if (previousDatabase == null) {
      delete process.env.PGDATABASE;
    } else {
      process.env.PGDATABASE = previousDatabase;
    }
  }
}

async function dropDatabase(databaseName: string): Promise<void> {
  let client = new PgClient(pgAdminConnectionConfig());
  try {
    await client.connect();
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await client.query(
      `DROP DATABASE IF EXISTS ${quotePgIdentifier(databaseName)}`,
    );
  } finally {
    await client.end();
  }
}

async function createTemplateSnapshot(
  sourceDatabaseName: string,
  templateDatabaseName: string,
): Promise<void> {
  let client = new PgClient(pgAdminConnectionConfig());
  try {
    await client.connect();
    await client.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [templateDatabaseName],
    );
    await client.query(
      `DROP DATABASE IF EXISTS ${quotePgIdentifier(templateDatabaseName)}`,
    );
    await client.query(
      `CREATE DATABASE ${quotePgIdentifier(templateDatabaseName)} TEMPLATE ${quotePgIdentifier(
        sourceDatabaseName,
      )}`,
    );
    await client.query(
      `ALTER DATABASE ${quotePgIdentifier(templateDatabaseName)} WITH IS_TEMPLATE true`,
    );
  } finally {
    await client.end();
  }
}

async function cloneTestDBFromTemplate(
  templateDatabaseName: string,
  databaseName?: string,
): Promise<void> {
  let database = databaseName ?? process.env.PGDATABASE;
  if (!database) {
    throw new Error(
      'PGDATABASE must be set before cloning a test database (call prepareTestDB())',
    );
  }

  if (database === templateDatabaseName) {
    throw new Error(
      `refusing to create test DB using the same name as template database '${templateDatabaseName}'`,
    );
  }

  // Defensive: drop a same-named DB before creating. prepareTestDB() now
  // produces unique names, but a stray DB from a crashed prior run or a
  // shared cluster could otherwise resurface as "database already exists".
  await dropDatabase(database);
  let client = new PgClient(pgAdminConnectionConfig());
  try {
    await client.connect();
    await client.query(
      `CREATE DATABASE ${quotePgIdentifier(database)} TEMPLATE ${quotePgIdentifier(
        templateDatabaseName,
      )}`,
    );
  } catch (e: any) {
    if (e?.message?.includes('does not exist')) {
      throw new Error(
        `template database '${templateDatabaseName}' is missing. Run packages/realm-server/tests/scripts/prepare-test-pg.sh first.`,
      );
    }
    throw e;
  } finally {
    await client.end();
  }
}

export async function cloneTestDBFromMigratedTemplate(): Promise<void> {
  await cloneTestDBFromTemplate(migratedTestDatabaseTemplate);
}

export async function createTestPgAdapter(options?: {
  templateDatabase?: string;
  databaseName?: string;
}): Promise<PgAdapter> {
  let databaseName = options?.databaseName ?? process.env.PGDATABASE;
  if (!databaseName) {
    throw new Error(
      'PGDATABASE must be set before creating a test adapter (call prepareTestDB())',
    );
  }
  await cloneTestDBFromTemplate(
    options?.templateDatabase ?? migratedTestDatabaseTemplate,
    databaseName,
  );
  return await withPgDatabaseEnv(databaseName, async () => new PgAdapter());
}

export async function closeServer(server: Server) {
  if (!server) {
    return;
  }
  // Capture the listening address before close() so we can poll the OS until
  // the port is fully unbound. node's `server.close(cb)` only waits for the
  // listener to stop accepting new connections — under load, the kernel can
  // hold the port in TIME_WAIT briefly and the next bind() races into
  // EADDRINUSE.
  let address = server.address();
  let host: string | undefined;
  let port: number | undefined;
  if (address && typeof address === 'object') {
    host = address.address;
    port = address.port;
  }

  // Force-close idle keep-alive sockets so server.close() resolves promptly.
  // Without this, a lingering connection from the host page (puppeteer fetching
  // from the realm server) can hold the port bound long after the test moves
  // on, causing EADDRINUSE when the next test tries to re-bind. http.Server
  // exposes these methods; Http2SecureServer does not — cast to widen at this
  // call site and let the optional chain swallow the missing case.
  (server as { closeIdleConnections?: () => void }).closeIdleConnections?.();
  (server as { closeAllConnections?: () => void }).closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));

  if (host && typeof port === 'number' && port > 0) {
    await awaitPortRelease(host, port);
  }
}

/**
 * Poll a TCP port on `host` until a fresh connect() is refused (i.e. nothing
 * is LISTENing there anymore). Used after `server.close()` returns to give
 * the kernel a chance to fully release the bind slot before the next fixture
 * tries to listen on the same port.
 *
 * Resolves on first refusal. Logs a clear diagnostic on timeout so the next
 * failure points to the leaked port rather than the downstream EADDRINUSE.
 */
export async function awaitPortRelease(
  host: string,
  port: number,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  let timeoutMs = options.timeoutMs ?? 2000;
  let intervalMs = options.intervalMs ?? 25;
  // Map the wildcard bind address back to a connectable loopback address.
  // Server.address() reports `::` for IPv6-any, `0.0.0.0` for IPv4-any —
  // neither is a valid connect target. Probe in the same address family the
  // listener was bound to: if we map `::` to `127.0.0.1` and the system has
  // IPv6-only binding behavior, the IPv4 probe gets ECONNREFUSED while the
  // original IPv6 listener is still bound, falsely reporting release.
  let connectHost = host;
  if (host === '::') {
    connectHost = '::1';
  } else if (host === '0.0.0.0') {
    connectHost = '127.0.0.1';
  }

  let started = Date.now();
  while (Date.now() - started < timeoutMs) {
    let stillListening = await new Promise<boolean>((resolve) => {
      let socket = new NetSocket();
      let settled = false;
      let done = (listening: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(listening);
      };
      socket.setTimeout(Math.max(50, intervalMs * 2));
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(true));
      socket.once('error', () => {
        // ECONNREFUSED is the expected signal that the port is fully released.
        // Anything else (host unreachable, etc.) we also treat as released —
        // we're not the right place to diagnose upstream network errors and
        // a non-listening socket is a non-listening socket.
        done(false);
      });
      socket.connect(port, connectHost);
    });

    if (!stillListening) {
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  console.warn(
    `awaitPortRelease: ${connectHost}:${port} still appears bound after ${timeoutMs}ms; ` +
      `the next fixture binding this port will likely EADDRINUSE.`,
  );
}

function trackServer(server: Server): Server {
  trackedServers.add(server);
  server.once('close', () => trackedServers.delete(server));
  return server;
}

export async function closeTrackedServers(): Promise<void> {
  let servers = [...trackedServers].filter((server) => server.listening);
  await Promise.all(servers.map((server) => closeServer(server)));
}

export function trackPrerenderer(prerenderer: TestPrerenderer): void {
  trackedPrerenderers.add(prerenderer);
}

export function getPrerendererForTesting(options: {
  serverURL: string;
  maxPages?: number;
}): TestPrerenderer {
  let prerenderer =
    options.maxPages === undefined
      ? new LocalPrerenderer(options)
      : withEnvUnset(PRERENDER_POOL_CAPACITY_OVERRIDE_ENV_KEYS, () => {
          return new LocalPrerenderer(options);
        });
  trackPrerenderer(prerenderer);
  return prerenderer;
}

export async function stopTrackedPrerenderers(): Promise<void> {
  let prerenderers = [...trackedPrerenderers];
  trackedPrerenderers.clear();
  await Promise.all(
    prerenderers.map(async (prerenderer) => {
      try {
        await prerenderer.stop();
      } catch {
        // best-effort cleanup
      }
    }),
  );
}

export async function closeTrackedDbAdapters(): Promise<void> {
  let adapters = [...trackedDbAdapters];
  trackedDbAdapters.clear();
  for (let adapter of adapters) {
    if (!adapter.isClosed) {
      try {
        await adapter.close();
      } catch {
        // best-effort cleanup
      }
    }
  }
}

export async function destroyTrackedQueuePublishers(): Promise<void> {
  let publishers = [...trackedQueuePublishers];
  trackedQueuePublishers.clear();
  for (let publisher of publishers) {
    try {
      await publisher.destroy();
    } catch {
      // best-effort cleanup
    }
  }
}

export async function destroyTrackedQueueRunners(): Promise<void> {
  let runners = [...trackedQueueRunners];
  trackedQueueRunners.clear();
  for (let runner of runners) {
    try {
      await runner.destroy();
    } catch {
      // best-effort cleanup
    }
  }
}

async function waitForQueueIdle(
  databaseName: string,
  // Generous: a template build's queue drains the realm's whole-realm
  // prerender_html job (every card's HTML) after the index job resolves.
  timeout = 300000,
): Promise<void> {
  await waitUntil(
    async () => {
      let client = new PgClient({
        ...pgAdminConnectionConfig(),
        database: databaseName,
      });
      try {
        await client.connect();
        // A rejected job means the template would snapshot with silently
        // missing data (e.g. absent HTML) and surface later as confusing
        // failures in unrelated tests — fail here, loudly and immediately.
        let { rows: rejected } = await client.query<{
          id: number;
          job_type: string;
        }>(`SELECT id, job_type FROM jobs WHERE status = 'rejected'`);
        if (rejected.length > 0) {
          throw new Error(
            `job(s) rejected while waiting for queue to become idle: ${rejected
              .map((row) => `${row.job_type}#${row.id}`)
              .join(', ')}`,
          );
        }
        let {
          rows: [{ count: unfulfilledJobs }],
        } = await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM jobs WHERE status = 'unfulfilled'`,
        );
        let {
          rows: [{ count: activeReservations }],
        } = await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM job_reservations WHERE completed_at IS NULL`,
        );
        return unfulfilledJobs === 0 && activeReservations === 0;
      } finally {
        await client.end();
      }
    },
    {
      timeout,
      interval: 50,
      timeoutMessage: 'waiting for queue to become idle',
    },
  );
}

// Pure diagnostics — never changes behavior. `_types` (and any reader of the
// precomputed `realm_meta`) returns instances from the `realm_meta` row whose
// `generation` equals `realm_generations.current_generation`. An empty result has
// three distinguishable causes, and this dump tells them apart in the CI log
// without needing another iteration:
//   1. The from-scratch index produced no instance rows at all
//      (boxel_index.instances = 0).
//   2. Instances were indexed but their `types` couldn't be resolved (a render
//      or module fetch failed) — `#fetchTypeSummary` requires `types->>0`, so
//      those rows silently drop out of `realm_meta` (null_types > 0).
//   3. No `realm_meta` row matches `current_generation` (a version mismatch —
//      e.g. a from-scratch reset left only orphan rows), so the JOIN is empty
//      even though instances exist (matched = NONE while instances > 0).
// Logged unconditionally as a one-liner; degraded/error instance rows are
// dumped only when something looks off. Wrapped so a diagnostics failure can
// never affect a test result.
export async function logRealmIndexDiagnostics(
  dbAdapter: PgAdapter,
  realmURL: string,
  label: string,
): Promise<void> {
  try {
    let [versionRow] = await dbAdapter.execute(
      `SELECT current_generation FROM realm_generations WHERE realm_url = $1`,
      { bind: [realmURL] },
    );
    let currentVersion = versionRow?.current_generation ?? null;

    let metaRows = await dbAdapter.execute(
      `SELECT generation,
              COALESCE(jsonb_array_length(value->'instances'), -1) AS instances,
              COALESCE(jsonb_array_length(value->'files'), -1) AS files
       FROM realm_meta WHERE realm_url = $1 ORDER BY generation`,
      { bind: [realmURL] },
    );

    let [counts] = await dbAdapter.execute(
      `SELECT
         COUNT(*) FILTER (WHERE type = 'instance' AND (is_deleted IS NULL OR is_deleted = false)) AS instances,
         COUNT(*) FILTER (WHERE type = 'instance' AND types IS NULL AND (is_deleted IS NULL OR is_deleted = false)) AS null_types,
         COUNT(*) FILTER (WHERE type = 'instance' AND has_error = true AND (is_deleted IS NULL OR is_deleted = false)) AS errored
       FROM boxel_index WHERE realm_url = $1`,
      { bind: [realmURL] },
    );

    let metaSummary =
      metaRows
        .map(
          (r) => `v${r.generation}{instances:${r.instances},files:${r.files}}`,
        )
        .join(', ') || '(none)';
    let matched = metaRows.find((r) => r.generation === currentVersion);
    let nullTypes = Number(counts?.null_types ?? 0);
    let errored = Number(counts?.errored ?? 0);

    console.log(
      `[realm-index-diag ${label}] realm=${realmURL} current_generation=${currentVersion} ` +
        `realm_meta=[${metaSummary}] ` +
        `matched=${matched ? `instances:${matched.instances}` : 'NONE(version-mismatch)'} ` +
        `boxel_index.instances=${counts?.instances ?? '?'} null_types=${nullTypes} errored=${errored}`,
    );

    if (
      !matched ||
      Number(matched.instances) <= 0 ||
      nullTypes > 0 ||
      errored > 0
    ) {
      let badRows = await dbAdapter.execute(
        `SELECT url, has_error, error_doc->>'message' AS message
         FROM boxel_index
         WHERE realm_url = $1 AND type = 'instance'
           AND (types IS NULL OR has_error = true)
           AND (is_deleted IS NULL OR is_deleted = false)
         ORDER BY url
         LIMIT 25`,
        { bind: [realmURL] },
      );
      for (let r of badRows) {
        console.log(
          `[realm-index-diag ${label}]   instance ${r.url} has_error=${r.has_error} ` +
            `error_doc.message=${r.message ?? 'none'}`,
        );
      }
    }
  } catch (e) {
    console.log(
      `[realm-index-diag ${label}] failed to gather diagnostics for ${realmURL}: ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

interface CachedPermissionedRealmTemplateEntry {
  ready: Promise<void>;
}

const permissionedRealmTemplateCache = new Map<
  string,
  CachedPermissionedRealmTemplateEntry
>();
const permissionedRealmTemplateNamePrefix = `rs_tpl_${process.pid}_`;
const permissionedRealmBuilderDbNamePrefix = `rs_bld_${process.pid}_`;
const prerendererCacheIds = new WeakMap<object, number>();
let nextPrerendererCacheId = 1;

function stableStringify(value: unknown): string {
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

function hashCacheKeyPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function templateDatabaseNameForCacheKey(cacheKey: string): string {
  return `${permissionedRealmTemplateNamePrefix}${cacheKey.slice(0, 24)}`;
}

function builderDatabaseNameForCacheKey(cacheKey: string): string {
  return `${permissionedRealmBuilderDbNamePrefix}${cacheKey.slice(0, 24)}`;
}

function prerendererCacheKeyPart(prerenderer?: Prerenderer): string | null {
  if (!prerenderer) {
    return null;
  }
  let key = prerenderer as unknown as object;
  let id = prerendererCacheIds.get(key);
  if (!id) {
    id = nextPrerendererCacheId++;
    prerendererCacheIds.set(key, id);
  }
  return `injected:${id}`;
}

const testPrerenderURL = `http://${testPrerenderHost}:${testPrerenderPort}`;

async function startTestPrerenderServer(): Promise<string> {
  if (prerenderServer?.listening) {
    return testPrerenderURL;
  }
  if (prerenderServerStart) {
    await prerenderServerStart;
    return testPrerenderURL;
  }
  let server = createPrerenderHttpServer({
    maxPages: 1,
    fatalExitOnUncaught: false, // tests share the qunit process; see CS-10813
  });
  prerenderServer = server;
  trackServer(server);
  prerenderServerStart = new Promise<void>((resolve, reject) => {
    let onError = (error: Error) => {
      server.off('error', onError);
      prerenderServer = undefined;
      prerenderServerStart = undefined;
      if (server.listening) {
        server.close(() => reject(error));
      } else {
        reject(error);
      }
    };
    server.once('error', onError);
    server.listen(testPrerenderPort, testPrerenderHost, () => {
      server.off('error', onError);
      prerenderServerStart = undefined;
      resolve();
    });
  });
  await prerenderServerStart;
  return testPrerenderURL;
}

export async function stopTestPrerenderServer() {
  if (prerenderServer && prerenderServer.listening) {
    if (hasStopPrerenderer(prerenderServer)) {
      await prerenderServer.__stopPrerenderer?.();
    }
    await closeServer(prerenderServer);
  }
  prerenderServer = undefined;
  prerenderServerStart = undefined;
}

type StoppablePrerenderServer = Server & {
  __stopPrerenderer?: () => Promise<void>;
};

function hasStopPrerenderer(
  server: Server,
): server is StoppablePrerenderServer {
  return (
    typeof (server as StoppablePrerenderServer).__stopPrerenderer === 'function'
  );
}

export async function getTestPrerenderer(): Promise<Prerenderer> {
  let url = await startTestPrerenderServer();
  return createRemotePrerenderer(url);
}

type BeforeAfterCallback = (
  dbAdapter: PgAdapter,
  publisher: QueuePublisher,
  runner: QueueRunner,
) => Promise<void>;

type TestDatabaseTemplateProvider = string | (() => string | undefined);

export function setupDB(
  hooks: NestedHooks,
  args: {
    before?: BeforeAfterCallback;
    after?: BeforeAfterCallback;
    beforeEach?: BeforeAfterCallback;
    afterEach?: BeforeAfterCallback;
    templateDatabase?: TestDatabaseTemplateProvider;
  } = {},
) {
  let dbAdapter: PgAdapter | undefined;
  let publisher: QueuePublisher | undefined;
  let runner: QueueRunner | undefined;

  const runBeforeHook = async () => {
    prepareTestDB();
    let templateDatabase =
      typeof args.templateDatabase === 'function'
        ? args.templateDatabase()
        : args.templateDatabase;
    dbAdapter = await createTestPgAdapter({
      templateDatabase,
    });
    trackedDbAdapters.add(dbAdapter);
    publisher = new PgQueuePublisher(dbAdapter);
    trackedQueuePublishers.add(publisher);
    runner = new PgQueueRunner({ adapter: dbAdapter, workerId: 'test-worker' });
    trackedQueueRunners.add(runner);
  };

  const runAfterHook = async () => {
    // Snapshot and clear closure refs up front so that, regardless of
    // how cleanup goes, the next test's beforeEach starts from a clean
    // slate. A partial-setup beforeEach (e.g. the create-DB step throws
    // after the previous test already closed its adapter) used to
    // cascade into "Called end on pool more than once" when the next
    // afterEach ran against stale closure state.
    let p = publisher;
    let r = runner;
    let a = dbAdapter;
    publisher = undefined;
    runner = undefined;
    dbAdapter = undefined;

    // Each resource's cleanup is independent — a failure in one must
    // not skip the others. Matches the best-effort pattern used by
    // closeTrackedDbAdapters / destroyTrackedQueuePublishers / etc.
    if (p) {
      trackedQueuePublishers.delete(p);
      try {
        await p.destroy();
      } catch {
        // best-effort cleanup
      }
    }
    if (r) {
      trackedQueueRunners.delete(r);
      try {
        await r.destroy();
      } catch {
        // best-effort cleanup
      }
    }
    if (a) {
      trackedDbAdapters.delete(a);
      if (!a.isClosed) {
        try {
          await a.close();
        } catch {
          // best-effort cleanup
        }
      }
    }
  };

  // we need to pair before/after and beforeEach/afterEach. within this setup
  // function we can't mix before/after with beforeEach/afterEach as that will
  // result in an unbalanced DB lifecycle (e.g. creating a DB in the before hook and
  // destroying in the afterEach hook)
  if (args.before) {
    if (args.beforeEach || args.afterEach) {
      throw new Error(
        `cannot pair a "before" hook with a "beforeEach" or "afterEach" hook in setupDB--the DB setup must be balanced, you can either create a new DB in "before" or in "beforeEach" but not both`,
      );
    }
    hooks.before(async function () {
      await runBeforeHook();
      await args.before!(dbAdapter!, publisher!, runner!);
    });

    hooks.after(async function () {
      if (dbAdapter && publisher && runner) {
        await args.after?.(dbAdapter, publisher, runner);
      }
      await runAfterHook();
    });
  }

  if (args.beforeEach) {
    if (args.before || args.after) {
      throw new Error(
        `cannot pair a "beforeEach" hook with a "before" or "after" hook in setupDB--the DB setup must be balanced, you can either create a new DB in "before" or in "beforeEach" but not both`,
      );
    }
    hooks.beforeEach(async function () {
      await runBeforeHook();
      await args.beforeEach!(dbAdapter!, publisher!, runner!);
    });

    hooks.afterEach(async function () {
      if (dbAdapter && publisher && runner) {
        await args.afterEach?.(dbAdapter, publisher, runner);
      }
      await runAfterHook();
    });
  }
}

export async function getIndexHTML() {
  let url =
    process.env.HOST_URL ??
    (isEnvironmentMode() ? serviceURL('host') : 'http://localhost:4200/');
  let request = await fetch(url);
  return await request.text();
}

export async function createRealm({
  dir,
  definitionLookup,
  fileSystem = {},
  realmURL = testRealm,
  permissions = { '*': ['read'] },
  virtualNetwork,
  runner,
  publisher,
  dbAdapter,
  withWorker,
  prerenderer: providedPrerenderer,
  enableFileWatcher = false,
  cardSizeLimitBytes,
  fileSizeLimitBytes,
  transpileCoordinator,
  fullIndexOnStartup,
}: {
  dir: string;
  definitionLookup: DefinitionLookup;
  fileSystem?: Record<string, string | LooseSingleCardDocument>;
  realmURL?: string;
  permissions?: RealmPermissions;
  virtualNetwork: VirtualNetwork;
  matrixConfig?: MatrixConfig;
  publisher: QueuePublisher;
  runner?: QueueRunner;
  dbAdapter: PgAdapter;
  deferStartUp?: true;
  prerenderer?: Prerenderer;
  enableFileWatcher?: boolean;
  cardSizeLimitBytes?: number;
  fileSizeLimitBytes?: number;
  // CS-11030: optional cross-process transpile coordinator. Tests that
  // simulate two peer realms need each peer to hold its own coordinator
  // pointing at the same dbAdapter so the advisory-lock + NOTIFY plumbing
  // is the only thing serializing them — that's the behavior we want to
  // exercise.
  transpileCoordinator?: PopulateCoordinator;
  // Forwarded to the Realm constructor's `fullIndexOnStartup` option so
  // tests can exercise the bootstrap-realm code path in `Realm.#startup`
  // (the kind='bootstrap' branch that triggers the CS-11245 broadcast).
  // Production sets this via `resolveFullIndexOnStartup`; tests opt in
  // explicitly because `createRealm` has no realm-registry row to read.
  fullIndexOnStartup?: true;
  // if you are creating a realm  to test it directly without a server, you can
  // also specify `withWorker: true` to also include a worker with your realm
  withWorker?: true;
}): Promise<{ realm: Realm; adapter: RealmAdapter }> {
  await insertPermissions(dbAdapter, new URL(realmURL), permissions);

  for (let username of Object.keys(permissions)) {
    if (username !== '*') {
      await ensureTestUser(dbAdapter, username);
    }
  }

  for (let [filename, contents] of Object.entries(fileSystem)) {
    let path = join(dir, filename);
    ensureDirSync(dirname(path));
    if (typeof contents === 'string') {
      writeFileSync(path, contents);
    } else {
      writeJSONSync(path, contents);
    }
  }

  let adapter = new NodeAdapter(dir, enableFileWatcher);
  let worker: Worker | undefined;
  if (withWorker) {
    if (!runner) {
      throw new Error(`must provider a QueueRunner when using withWorker`);
    }
    let prerenderer = providedPrerenderer ?? (await getTestPrerenderer());
    worker = new Worker({
      indexWriter: new IndexWriter(dbAdapter),
      queue: runner,
      dbAdapter,
      queuePublisher: publisher,
      virtualNetwork,
      matrixURL: realmServerTestMatrix.url,
      secretSeed: realmSecretSeed,
      realmServerMatrixUsername: testRealmServerMatrixUsername,
      prerenderer,
      createPrerenderAuth: testCreatePrerenderAuth,
    });
  }
  let matrixClient = new MatrixClient({
    matrixURL: realmServerTestMatrix.url,
    username: realmServerTestMatrix.username,
    seed: realmSecretSeed,
  });
  let realm = new Realm(
    {
      url: realmURL,
      adapter,
      secretSeed: realmSecretSeed,
      virtualNetwork,
      dbAdapter,
      queue: publisher,
      matrixClient,
      realmServerURL: new URL(new URL(realmURL).origin).href,
      definitionLookup,
      cardSizeLimitBytes:
        cardSizeLimitBytes ??
        Number(
          process.env.CARD_SIZE_LIMIT_BYTES ?? DEFAULT_CARD_SIZE_LIMIT_BYTES,
        ),
      fileSizeLimitBytes:
        fileSizeLimitBytes ??
        Number(
          process.env.FILE_SIZE_LIMIT_BYTES ?? DEFAULT_FILE_SIZE_LIMIT_BYTES,
        ),
      transpileCoordinator,
    },
    fullIndexOnStartup ? { fullIndexOnStartup: true as const } : undefined,
  );
  if (worker) {
    virtualNetwork.mount(realm.handle);
    await worker.run();
  }
  return { realm, adapter };
}

// Defense-in-depth for test bootstraps that don't share `tests/index.ts`:
// strip the dev TLS env vars before any fixture realm-server is spun up.
// `env-vars.sh` exports these whenever the local mkcert cert exists, which
// is now the CI default (the init action provisions it). Without this
// delete, an in-process fixture would bind the HTTPS+HTTP/2 dispatcher
// on its random `127.0.0.1:444X` port and supertest / direct-fetch
// callers in tests that connect plain HTTP would get 308-redirected to
// `https://…`, breaking every assertion that expects `200`/`4xx`.
// The qunit-runner-driven realm-server tests already do this in their
// own `tests/index.ts`; this call covers callers like the boxel-cli and
// workspace-sync vitest suites that consume the helpers without that
// bootstrap.
function stripTlsEnvVars() {
  delete process.env.REALM_SERVER_TLS_CERT_FILE;
  delete process.env.REALM_SERVER_TLS_KEY_FILE;
}

export async function runTestRealmServer({
  testRealmDir,
  realmsRootPath,
  fileSystem,
  realmURL,
  virtualNetwork,
  publisher,
  runner,
  dbAdapter,
  matrixConfig,
  matrixURL,
  permissions = { '*': ['read'] },
  enableFileWatcher = false,
  cardSizeLimitBytes,
  fileSizeLimitBytes,
  domainsForPublishedRealms = {
    boxelSpace: 'localhost',
    boxelSite: 'localhost',
  },
  prerenderer: providedPrerenderer,
}: {
  testRealmDir: string;
  realmsRootPath: string;
  fileSystem?: Record<string, string | LooseSingleCardDocument>;
  realmURL: URL;
  permissions?: RealmPermissions;
  virtualNetwork: VirtualNetwork;
  publisher: QueuePublisher;
  runner: QueueRunner;
  dbAdapter: PgAdapter;
  matrixURL: URL;
  matrixConfig?: MatrixConfig;
  enableFileWatcher?: boolean;
  cardSizeLimitBytes?: number;
  fileSizeLimitBytes?: number;
  domainsForPublishedRealms?: {
    boxelSpace?: string;
    boxelSite?: string;
  };
  prerenderer?: Prerenderer;
}) {
  stripTlsEnvVars();
  let prerenderer = providedPrerenderer ?? (await getTestPrerenderer());
  let definitionLookup = new CachingDefinitionLookup(
    dbAdapter,
    prerenderer,
    virtualNetwork,
    testCreatePrerenderAuth,
  );
  let worker = new Worker({
    indexWriter: new IndexWriter(dbAdapter),
    queue: runner,
    dbAdapter,
    queuePublisher: publisher,
    virtualNetwork,
    matrixURL,
    secretSeed: realmSecretSeed,
    realmServerMatrixUsername: testRealmServerMatrixUsername,
    prerenderer,
    createPrerenderAuth: testCreatePrerenderAuth,
  });
  await worker.run();
  let { realm: testRealm, adapter: testRealmAdapter } = await createRealm({
    dir: testRealmDir,
    fileSystem,
    realmURL: realmURL.href,
    permissions,
    virtualNetwork,
    matrixConfig,
    publisher,
    dbAdapter,
    enableFileWatcher,
    definitionLookup,
    cardSizeLimitBytes,
    fileSizeLimitBytes,
  });

  await testRealm.logInToMatrix();

  virtualNetwork.mount(testRealm.handle);
  let realms = [testRealm];
  let matrixClient = new MatrixClient({
    matrixURL: realmServerTestMatrix.url,
    username: realmServerTestMatrix.username,
    seed: realmSecretSeed,
  });

  let reconciler = makeTestReconciler(dbAdapter, realms, {
    realmsRootPath,
    virtualNetwork,
    queue: publisher,
    matrixClient,
    serverURL: new URL(realmURL.origin),
    definitionLookup,
    enableFileWatcher,
  });
  let testRealmServer = new RealmServer({
    realms,
    reconciler,
    virtualNetwork,
    matrixClient,
    realmServerSecretSeed,
    realmSecretSeed,
    matrixRegistrationSecret,
    realmsRootPath,
    dbAdapter,
    queue: publisher,
    getIndexHTML,
    grafanaSecret,
    aiBotDelegationSecret,
    serverURL: new URL(realmURL.origin),
    assetsURL: new URL(`http://example.com/notional-assets-host/`),
    domainsForPublishedRealms,
    definitionLookup,
    prerenderer,
  });
  let testRealmHttpServer = testRealmServer.listen(parseInt(realmURL.port));
  trackServer(testRealmHttpServer);
  try {
    await testRealmServer.start();
  } catch (err) {
    // Close the http listener so the port is released — otherwise a throw
    // from start() leaves the listener bound, causing EADDRINUSE on the next
    // retry.
    try {
      await closeServer(testRealmHttpServer);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
  return {
    testRealmDir,
    testRealm,
    testRealmServer,
    testRealmHttpServer,
    testRealmAdapter,
    matrixClient,
    virtualNetwork,
  };
}

// Use when a single RealmServer instance must expose multiple realms
// (e.g. server endpoints that federate across realms like /_search).
export async function runTestRealmServerWithRealms({
  realmsRootPath,
  realms,
  virtualNetwork,
  publisher,
  runner,
  dbAdapter,
  matrixURL,
  enableFileWatcher = false,
  domainsForPublishedRealms = {
    boxelSpace: 'localhost',
    boxelSite: 'localhost',
  },
  prerenderer: providedPrerenderer,
}: {
  realmsRootPath: string;
  realms: {
    realmURL: URL;
    fileSystem?: Record<string, string | LooseSingleCardDocument>;
    permissions?: RealmPermissions;
    matrixConfig?: MatrixConfig;
  }[];
  virtualNetwork: VirtualNetwork;
  publisher: QueuePublisher;
  runner: QueueRunner;
  dbAdapter: PgAdapter;
  matrixURL: URL;
  enableFileWatcher?: boolean;
  domainsForPublishedRealms?: {
    boxelSpace?: string;
    boxelSite?: string;
  };
  prerenderer?: Prerenderer;
}) {
  stripTlsEnvVars();
  ensureDirSync(realmsRootPath);

  let prerenderer = providedPrerenderer ?? (await getTestPrerenderer());
  let definitionLookup = new CachingDefinitionLookup(
    dbAdapter,
    prerenderer,
    virtualNetwork,
    testCreatePrerenderAuth,
  );
  let worker = new Worker({
    indexWriter: new IndexWriter(dbAdapter),
    queue: runner,
    dbAdapter,
    queuePublisher: publisher,
    virtualNetwork,
    matrixURL,
    secretSeed: realmSecretSeed,
    realmServerMatrixUsername: testRealmServerMatrixUsername,
    prerenderer,
    createPrerenderAuth: testCreatePrerenderAuth,
  });
  await worker.run();

  let createdRealms: Realm[] = [];
  let realmAdapters: RealmAdapter[] = [];
  let matrixUsers = ['test_realm', 'node-test_realm'];

  for (let [index, realmConfig] of realms.entries()) {
    let realmDir = join(realmsRootPath, `realm_${index}`);
    ensureDirSync(realmDir);
    let { realm, adapter } = await createRealm({
      dir: realmDir,
      fileSystem: realmConfig.fileSystem,
      realmURL: realmConfig.realmURL.href,
      permissions: realmConfig.permissions,
      virtualNetwork,
      matrixConfig: realmConfig.matrixConfig ?? {
        url: matrixURL,
        username: matrixUsers[index] ?? matrixUsers[0],
      },
      publisher,
      dbAdapter,
      enableFileWatcher,
      definitionLookup,
    });
    await realm.logInToMatrix();
    virtualNetwork.mount(realm.handle);
    createdRealms.push(realm);
    realmAdapters.push(adapter);
  }

  let matrixClient = new MatrixClient({
    matrixURL: realmServerTestMatrix.url,
    username: realmServerTestMatrix.username,
    seed: realmSecretSeed,
  });

  let serverURL = new URL(realms[0].realmURL.origin);
  let reconciler = makeTestReconciler(dbAdapter, createdRealms, {
    realmsRootPath,
    virtualNetwork,
    queue: publisher,
    matrixClient,
    serverURL,
    definitionLookup,
    enableFileWatcher,
  });
  let testRealmServer = new RealmServer({
    realms: createdRealms,
    reconciler,
    virtualNetwork,
    matrixClient,
    realmServerSecretSeed,
    realmSecretSeed,
    matrixRegistrationSecret,
    realmsRootPath,
    dbAdapter,
    queue: publisher,
    getIndexHTML,
    grafanaSecret,
    aiBotDelegationSecret,
    serverURL,
    assetsURL: new URL(`http://example.com/notional-assets-host/`),
    domainsForPublishedRealms,
    definitionLookup,
    prerenderer,
  });
  let testRealmHttpServer = testRealmServer.listen(parseInt(serverURL.port));
  trackServer(testRealmHttpServer);
  await testRealmServer.start();

  return {
    realms: createdRealms,
    realmAdapters,
    testRealmServer,
    testRealmHttpServer,
    matrixClient,
  };
}

// Spins up one RealmServer per realm. Use for cross-realm behavior that doesn't
// require a shared server (authorization, permissions, etc.).
type PermissionedRealmsFixtureRealm = {
  realm: Realm;
  realmPath: string;
  realmHttpServer: Server;
  realmAdapter: RealmAdapter;
};

type InternalPermissionedRealmsSetupOptions = {
  realms: {
    realmURL: string;
    permissions: RealmPermissions;
    fileSystem?: Record<string, string | LooseSingleCardDocument>;
    fixture?: RealmFixtureName;
  }[];
  prerenderer?: Prerenderer;
};

async function startPermissionedRealmsFixture(
  dbAdapter: PgAdapter,
  publisher: QueuePublisher,
  runner: QueueRunner,
  { realms: realmConfigs, prerenderer }: InternalPermissionedRealmsSetupOptions,
): Promise<{ realms: PermissionedRealmsFixtureRealm[] }> {
  let realms: PermissionedRealmsFixtureRealm[] = [];

  for (let realmArg of realmConfigs.values()) {
    if (realmArg.fileSystem && realmArg.fixture) {
      throw new Error(
        'setupPermissionedRealms: pass either `fileSystem` or `fixture` per realm, not both',
      );
    }
    let testRealmDir = dirSync().name;
    if (!realmArg.fileSystem) {
      // The plural helper has historically left the disk empty by default;
      // preserve that — only copy a fixture onto disk when one is named.
      if (realmArg.fixture) {
        copySync(fixtureDir(realmArg.fixture), testRealmDir);
      }
    }
    let {
      testRealm: realm,
      testRealmHttpServer: realmHttpServer,
      testRealmAdapter: realmAdapter,
    } = await runTestRealmServer({
      virtualNetwork: await createVirtualNetwork(),
      testRealmDir,
      realmsRootPath: dirSync().name,
      realmURL: new URL(realmArg.realmURL),
      fileSystem: realmArg.fileSystem,
      permissions: realmArg.permissions,
      matrixURL,
      dbAdapter,
      publisher,
      runner,
      prerenderer,
    });
    realms.push({
      realm,
      realmPath: testRealmDir,
      realmHttpServer,
      realmAdapter,
    });
  }

  return { realms };
}

async function teardownPermissionedRealmsFixture(
  realms: PermissionedRealmsFixtureRealm[],
): Promise<void> {
  for (let realm of realms) {
    realm.realm.__testOnlyClearCaches();
    await closeServer(realm.realmHttpServer);
  }
}

export function setupPermissionedRealms(
  hooks: NestedHooks,
  {
    mode = 'beforeEach',
    realms: realmsArg,
    onRealmSetup,
    prerenderer,
    dbTemplateDatabase,
  }: {
    mode?: 'beforeEach' | 'before';
    realms: {
      realmURL: string;
      permissions: RealmPermissions;
      fileSystem?: Record<string, string | LooseSingleCardDocument>;
      fixture?: RealmFixtureName;
    }[];
    prerenderer?: Prerenderer;
    // Internal hook used by cached setup wrappers
    dbTemplateDatabase?: TestDatabaseTemplateProvider;
    onRealmSetup?: (args: {
      dbAdapter: PgAdapter;
      realms: PermissionedRealmsFixtureRealm[];
    }) => void;
  },
) {
  // We want 2 different realm users to test authorization between them - these
  // names are selected because they are already available in the test
  // environment (via register-realm-users.ts)
  let realms: PermissionedRealmsFixtureRealm[] = [];
  let _dbAdapter: PgAdapter;
  setupDB(hooks, {
    templateDatabase: dbTemplateDatabase,
    [mode]: async (
      dbAdapter: PgAdapter,
      publisher: QueuePublisher,
      runner: QueueRunner,
    ) => {
      _dbAdapter = dbAdapter;
      ({ realms } = await startPermissionedRealmsFixture(
        dbAdapter,
        publisher,
        runner,
        {
          realms: realmsArg,
          prerenderer,
        },
      ));
      onRealmSetup?.({
        dbAdapter: _dbAdapter!,
        realms,
      });
    },
  });

  hooks[mode === 'beforeEach' ? 'afterEach' : 'after'](async function () {
    await teardownPermissionedRealmsFixture(realms);
    realms = [];
  });
}

export async function insertUser(
  dbAdapter: PgAdapter,
  matrixUserId: string,
  stripeCustomerId: string,
  stripeCustomerEmail: string | null,
): Promise<User> {
  let { valueExpressions, nameExpressions } = asExpressions({
    matrix_user_id: matrixUserId,
    stripe_customer_id: stripeCustomerId,
    stripe_customer_email: stripeCustomerEmail,
  });
  let result = await query(
    dbAdapter,
    insert('users', nameExpressions, valueExpressions),
  );

  return {
    id: result[0].id,
    matrixUserId: result[0].matrix_user_id,
    stripeCustomerId: result[0].stripe_customer_id,
    stripeCustomerEmail: result[0].stripe_customer_email,
    sessionRoomId: result[0].session_room_id ?? null,
  } as User;
}

export async function ensureTestUser(
  dbAdapter: PgAdapter,
  matrixUserId: string,
) {
  await dbAdapter.execute(
    `INSERT INTO users (matrix_user_id) VALUES ($1) ON CONFLICT (matrix_user_id) DO NOTHING`,
    { bind: [matrixUserId] },
  );
}

export async function insertPlan(
  dbAdapter: PgAdapter,
  name: string,
  monthlyPrice: number,
  creditsIncluded: number,
  stripePlanId: string,
): Promise<Plan> {
  let { valueExpressions, nameExpressions } = asExpressions({
    name,
    monthly_price: monthlyPrice,
    credits_included: creditsIncluded,
    stripe_plan_id: stripePlanId,
  });
  let result = await query(
    dbAdapter,
    insert('plans', nameExpressions, valueExpressions),
  );
  return {
    id: result[0].id,
    name: result[0].name,
    monthlyPrice: parseFloat(result[0].monthly_price as string),
    creditsIncluded: result[0].credits_included,
    stripePlanId: result[0].stripe_plan_id,
  } as Plan;
}

export async function fetchSubscriptionsByUserId(
  dbAdapter: PgAdapter,
  userId: string,
): Promise<Subscription[]> {
  let results = (await query(dbAdapter, [
    `SELECT * FROM subscriptions WHERE user_id = `,
    param(userId),
  ])) as {
    id: string;
    user_id: string;
    plan_id: string;
    started_at: number;
    ended_at: number;
    status: string;
    stripe_subscription_id: string;
  }[];

  return results.map((result) => ({
    id: result.id,
    userId: result.user_id,
    planId: result.plan_id,
    startedAt: result.started_at,
    endedAt: result.ended_at,
    status: result.status,
    stripeSubscriptionId: result.stripe_subscription_id,
  }));
}

export function mtimes(
  path: string,
  realmURL: URL,
): { [path: string]: number } {
  const mtimes: { [path: string]: number } = {};
  let paths = new RealmPaths(realmURL);

  function traverseDir(currentPath: string) {
    const entries = readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      if (entry.isDirectory()) {
        traverseDir(fullPath);
      } else if (entry.isFile()) {
        const stats = statSync(fullPath);
        mtimes[paths.fileURL(fullPath.substring(path.length)).href] = unixTime(
          stats.mtime.getTime(),
        );
      }
    }
  }
  traverseDir(path);
  return mtimes;
}

export async function insertJob(
  dbAdapter: PgAdapter,
  params: {
    job_type: string;
    args?: Record<string, any>;
    concurrency_group?: string | null;
    timeout?: number;
    status?: string;
    finished_at?: string | null;
    result?: Record<string, any> | null;
    priority?: number;
  },
): Promise<Record<string, any>> {
  let { valueExpressions, nameExpressions } = asExpressions({
    job_type: params.job_type,
    args: params.args ?? {},
    concurrency_group: params.concurrency_group ?? null,
    timeout: params.timeout ?? 240,
    status: params.status ?? 'unfulfilled',
    finished_at: params.finished_at ?? null,
    result: params.result ?? null,
    priority: params.priority ?? 0,
  });
  let result = await query(
    dbAdapter,
    insert('jobs', nameExpressions, valueExpressions),
  );
  return {
    id: result[0].id,
    job_type: result[0].job_type,
    args: result[0].args,
    concurrency_group: result[0].concurrency_group,
    timeout: result[0].timeout,
    status: result[0].status,
    finished_at: result[0].finished_at,
    result: result[0].result,
    priority: result[0].priority,
  };
}

export function setupMatrixRoom(
  hooks: NestedHooks,
  getRealmSetup: () => {
    testRealm: Realm;
    testRealmHttpServer: Server;
    request: { post(path: string): Test };
    serverRequest?: SuperTest<Test>;
    dir: DirResult;
    dbAdapter: PgAdapter;
  },
) {
  let matrixClient = new MatrixClient({
    matrixURL: realmServerTestMatrix.url,
    username: 'node-test_realm',
    seed: realmSecretSeed,
  });

  let testAuthRoomId: string | undefined;

  hooks.beforeEach(async function () {
    await matrixClient.login();

    let realmSetup = getRealmSetup();
    let openIdToken = await matrixClient.getOpenIdToken();
    if (!openIdToken) {
      throw new Error('matrixClient did not return an OpenID token');
    }

    let response = await (realmSetup.serverRequest ?? realmSetup.request)
      .post('/_server-session')
      .send(JSON.stringify(openIdToken))
      .set('Accept', 'application/json')
      .set('Content-Type', 'application/json');

    let jwt = response.header['authorization'];
    if (!jwt) {
      throw new Error('Realm server did not send Authorization header');
    }

    let payload = JSON.parse(
      Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'),
    ) as { sessionRoom: string };
    console.log('Session room', payload.sessionRoom);

    let { joined_rooms: rooms } = await matrixClient.getJoinedRooms();

    if (!rooms.includes(payload.sessionRoom)) {
      await matrixClient.joinRoom(payload.sessionRoom);
    }

    testAuthRoomId = payload.sessionRoom;
  });

  return {
    matrixClient,
    getMessagesSince: async function (since: number) {
      let allMessages = await matrixClient.roomMessages(testAuthRoomId!);
      // Allow same-ms clock values between the test process and matrix so we don't
      // miss events that are emitted immediately after we record the start time.
      let messagesAfterSentinel = allMessages.filter(
        (m) => m.origin_server_ts >= since,
      );

      return messagesAfterSentinel;
    },
  };
}

export async function waitForRealmEvent(
  getMessagesSince: (since: number) => Promise<MatrixEvent[]>,
  since: number,
  options: {
    predicate?: (event: RealmEvent) => boolean;
    timeout?: number;
    timeoutMessage?: string;
  } = {},
): Promise<RealmEvent> {
  let { predicate = () => true, timeout, timeoutMessage } = options;

  let event = await waitUntil<RealmEvent | undefined>(
    async () => {
      let findMatchingEvent = (messages: MatrixEvent[]) =>
        messages.find((event): event is RealmEvent => {
          if (event.type !== APP_BOXEL_REALM_EVENT_TYPE) {
            return false;
          }
          return predicate(event as RealmEvent);
        });

      let matrixMessages = await getMessagesSince(since);
      let matchingEvent = findMatchingEvent(matrixMessages);

      if (!matchingEvent) {
        let skewedSince = Math.max(0, since - REALM_EVENT_TS_SKEW_BUFFER_MS);
        if (skewedSince !== since) {
          let skewedMessages = await getMessagesSince(skewedSince);
          matchingEvent = findMatchingEvent(skewedMessages);
        }
      }

      if (matchingEvent) {
        return matchingEvent;
      }

      return undefined;
    },
    {
      timeout: timeout ?? 5000,
      timeoutMessage,
    },
  );

  return event!;
}

export function findRealmEvent(
  events: MatrixEvent[],
  eventName: string,
  indexType: string,
): RealmEvent | undefined {
  return events.find(
    (m) =>
      m.type === APP_BOXEL_REALM_EVENT_TYPE &&
      m.content.eventName === eventName &&
      (realmEventIsIndex(m.content) ? m.content.indexType === indexType : true),
  ) as RealmEvent | undefined;
}

function realmEventIsIndex(
  event: RealmEventContent,
): event is IncrementalIndexEventContent {
  return event.eventName === 'index';
}

// The three realm fixtures available under tests/fixtures/. See CS-10009.
//   blank      — empty directory; for tests that need a working realm
//                with no card content.
//   simple     — one card def (Person), one instance, one non-card file; for
//                tests that need *some* indexed content but nothing exotic.
//   realistic  — kitchen-sink fixture with the full set of card defs,
//                instances, cyclic imports, error cases, Unicode filenames,
//                etc.; for tests that lean on that specific content.
export type RealmFixtureName = 'blank' | 'simple' | 'realistic';

export function fixtureDir(name: RealmFixtureName): string {
  return join(import.meta.dirname, '..', 'fixtures', name);
}

type InternalPermissionedRealmSetupOptions = {
  permissions: RealmPermissions;
  realmURL?: URL;
  fileSystem?: Record<string, string | LooseSingleCardDocument>;
  fixture?: RealmFixtureName;
  subscribeToRealmEvents?: boolean;
  prerenderer?: Prerenderer;
  published?: boolean;
  cardSizeLimitBytes?: number;
  fileSizeLimitBytes?: number;
};

async function startPermissionedRealmFixture(
  dbAdapter: PgAdapter,
  publisher: QueuePublisher,
  runner: QueueRunner,
  {
    permissions,
    realmURL,
    fileSystem,
    fixture,
    subscribeToRealmEvents = false,
    prerenderer,
    published = false,
    cardSizeLimitBytes,
    fileSizeLimitBytes,
  }: InternalPermissionedRealmSetupOptions,
): Promise<{
  testRealmServer: Awaited<ReturnType<typeof runTestRealmServer>>;
  request: SuperTest<Test>;
  dir: DirResult;
}> {
  if (fileSystem && fixture) {
    throw new Error(
      'setupPermissionedRealm: pass either `fileSystem` or `fixture`, not both',
    );
  }
  let resolvedRealmURL = realmURL ?? testRealmURL;
  let dir = dirSync();

  let testRealmDir;

  if (published) {
    let publishedRealmId = uuidv4();
    let lastPublishedAt = Date.now();
    let ownerUsername = '@user:localhost';
    let sourceRealmURL = 'http://example.localhost/source';

    testRealmDir = join(
      dir.name,
      'realm_server_1',
      PUBLISHED_DIRECTORY_NAME,
      publishedRealmId,
    );

    await upsertPublishedRealmInRegistry(dbAdapter, {
      publishedRealmURL: resolvedRealmURL.href,
      publishedRealmId,
      ownerUsername,
      sourceRealmURL,
      lastPublishedAt,
    });
  } else {
    testRealmDir = join(dir.name, 'realm_server_1', 'test');
  }

  ensureDirSync(testRealmDir);

  // If a fileSystem is provided, the realm is populated through createRealm
  // from that object. Otherwise copy a fixture folder onto disk. Default to
  // `blank` — tests that need card content must opt in to `simple` or
  // `realistic`.
  if (!fileSystem) {
    copySync(fixtureDir(fixture ?? 'blank'), testRealmDir);
  }

  let virtualNetwork = createVirtualNetwork();

  let testRealmServer = await runTestRealmServer({
    virtualNetwork,
    testRealmDir,
    realmsRootPath: join(dir.name, 'realm_server_1'),
    realmURL: resolvedRealmURL,
    permissions,
    dbAdapter,
    runner,
    publisher,
    matrixURL,
    fileSystem,
    enableFileWatcher: subscribeToRealmEvents,
    cardSizeLimitBytes,
    fileSizeLimitBytes,
    prerenderer,
  });

  let request = supertest(testRealmServer.testRealmHttpServer);

  return {
    testRealmServer,
    request,
    dir,
  };
}

async function teardownPermissionedRealmFixture(
  testRealmServer?: Awaited<ReturnType<typeof runTestRealmServer>>,
): Promise<void> {
  if (!testRealmServer) {
    return;
  }

  let cleanupError: unknown;

  try {
    testRealmServer.testRealm.unsubscribe();
  } catch (error) {
    cleanupError ??= error;
  }

  try {
    if (!testRealmServer.matrixClient.isLoggedIn()) {
      await testRealmServer.matrixClient.login();
    }
  } catch (error) {
    cleanupError ??= error;
  }

  try {
    await closeServer(testRealmServer.testRealmHttpServer);
  } catch (error) {
    cleanupError ??= error;
  }

  try {
    resetCatalogRealms();
  } catch (error) {
    cleanupError ??= error;
  }

  if (cleanupError) {
    throw cleanupError;
  }
}

export function setupPermissionedRealm(
  hooks: NestedHooks,
  {
    permissions,
    realmURL,
    fileSystem,
    fixture,
    onRealmSetup,
    subscribeToRealmEvents = false,
    mode = 'beforeEach',
    prerenderer,
    dbTemplateDatabase,
    published = false,
    cardSizeLimitBytes,
    fileSizeLimitBytes,
  }: {
    permissions: RealmPermissions;
    realmURL?: URL;
    fileSystem?: Record<string, string | LooseSingleCardDocument>;
    fixture?: RealmFixtureName;
    onRealmSetup?: (args: {
      dbAdapter: PgAdapter;
      publisher: QueuePublisher;
      runner: QueueRunner;
      testRealmServer: Awaited<ReturnType<typeof runTestRealmServer>>;
      testRealm: Realm;
      testRealmPath: string;
      testRealmHttpServer: Server;
      testRealmAdapter: RealmAdapter;
      request: SuperTest<Test>;
      dir: DirResult;
      virtualNetwork: VirtualNetwork;
    }) => void;
    subscribeToRealmEvents?: boolean;
    mode?: 'beforeEach' | 'before';
    prerenderer?: Prerenderer;
    // Internal hook used by cached setup wrappers
    dbTemplateDatabase?: TestDatabaseTemplateProvider;
    published?: boolean;
    cardSizeLimitBytes?: number;
    fileSizeLimitBytes?: number;
  },
) {
  let testRealmServer: Awaited<ReturnType<typeof runTestRealmServer>>;

  setGracefulCleanup();

  setupDB(hooks, {
    templateDatabase: dbTemplateDatabase,
    [mode]: async (
      dbAdapter: PgAdapter,
      publisher: QueuePublisher,
      runner: QueueRunner,
    ) => {
      let {
        testRealmServer: server,
        request,
        dir,
      } = await startPermissionedRealmFixture(dbAdapter, publisher, runner, {
        realmURL,
        fileSystem,
        fixture,
        permissions,
        subscribeToRealmEvents,
        prerenderer,
        published,
        cardSizeLimitBytes,
        fileSizeLimitBytes,
      });
      testRealmServer = server;

      onRealmSetup?.({
        dbAdapter,
        publisher,
        runner,
        testRealmServer,
        testRealm: testRealmServer.testRealm,
        testRealmPath: testRealmServer.testRealmDir,
        testRealmHttpServer: testRealmServer.testRealmHttpServer,
        testRealmAdapter: testRealmServer.testRealmAdapter,
        virtualNetwork: testRealmServer.virtualNetwork,
        request,
        dir,
      });
    },
  });

  hooks[mode === 'beforeEach' ? 'afterEach' : 'after'](async function () {
    await teardownPermissionedRealmFixture(testRealmServer);
  });
}

type SetupPermissionedRealmCachedOptions = Omit<
  Parameters<typeof setupPermissionedRealm>[1],
  'dbTemplateDatabase'
>;

function permissionedRealmTemplateCacheKey(
  options: SetupPermissionedRealmCachedOptions,
): string {
  let resolvedRealmURL = options.realmURL ?? testRealmURL;
  // Canonicalize the fixture choice so callers that omit `fixture` (and
  // implicitly get 'blank') share a cache with callers that pass
  // `fixture: 'blank'` explicitly. When `fileSystem` is provided, the
  // fixture choice is irrelevant — fileSystem's own hash carries the
  // content.
  let resolvedFixture = options.fileSystem
    ? null
    : (options.fixture ?? 'blank');
  return hashCacheKeyPayload({
    version: 1,
    type: 'permissioned-realm',
    realmURL: resolvedRealmURL.href,
    permissions: options.permissions,
    fileSystem: options.fileSystem ?? null,
    fixture: resolvedFixture,
    subscribeToRealmEvents: Boolean(options.subscribeToRealmEvents),
    published: Boolean(options.published),
    cardSizeLimitBytes: options.cardSizeLimitBytes ?? null,
    fileSizeLimitBytes: options.fileSizeLimitBytes ?? null,
    prerenderer: prerendererCacheKeyPart(options.prerenderer),
  });
}

async function buildPermissionedRealmTemplate(
  cacheKey: string,
  options: SetupPermissionedRealmCachedOptions,
): Promise<void> {
  let templateDatabaseName = templateDatabaseNameForCacheKey(cacheKey);
  let builderDatabaseName = builderDatabaseNameForCacheKey(cacheKey);

  let dbAdapter: PgAdapter | undefined;
  let publisher: QueuePublisher | undefined;
  let runner: QueueRunner | undefined;
  let fixture:
    | Awaited<ReturnType<typeof startPermissionedRealmFixture>>
    | undefined;

  await dropDatabase(templateDatabaseName);
  await dropDatabase(builderDatabaseName);

  try {
    dbAdapter = await createTestPgAdapter({
      databaseName: builderDatabaseName,
      templateDatabase: migratedTestDatabaseTemplate,
    });
    publisher = new PgQueuePublisher(dbAdapter);
    runner = new PgQueueRunner({
      adapter: dbAdapter,
      workerId: 'template-worker',
    });

    fixture = await startPermissionedRealmFixture(
      dbAdapter,
      publisher,
      runner,
      {
        realmURL: options.realmURL,
        fileSystem: options.fileSystem,
        fixture: options.fixture,
        permissions: options.permissions,
        subscribeToRealmEvents: options.subscribeToRealmEvents,
        prerenderer: options.prerenderer,
        published: options.published,
        cardSizeLimitBytes: options.cardSizeLimitBytes,
        fileSizeLimitBytes: options.fileSizeLimitBytes,
      },
    );

    await waitForQueueIdle(builderDatabaseName);
    await logRealmIndexDiagnostics(
      dbAdapter,
      (options.realmURL ?? testRealmURL).href,
      'template-build',
    );
    await teardownPermissionedRealmFixture(fixture.testRealmServer);
    fixture = undefined;

    await publisher.destroy();
    publisher = undefined;
    await runner.destroy();
    runner = undefined;
    await dbAdapter.close();
    dbAdapter = undefined;

    await createTemplateSnapshot(builderDatabaseName, templateDatabaseName);
  } finally {
    if (fixture) {
      try {
        await teardownPermissionedRealmFixture(fixture.testRealmServer);
      } catch {
        // best-effort cleanup
      }
    }
    if (publisher) {
      try {
        await publisher.destroy();
      } catch {
        // best-effort cleanup
      }
    }
    if (runner) {
      try {
        await runner.destroy();
      } catch {
        // best-effort cleanup
      }
    }
    if (dbAdapter && !dbAdapter.isClosed) {
      try {
        await dbAdapter.close();
      } catch {
        // best-effort cleanup
      }
    }
    try {
      await dropDatabase(builderDatabaseName);
    } catch {
      // best-effort cleanup
    }
  }
}

async function acquirePermissionedRealmTemplate(
  options: SetupPermissionedRealmCachedOptions,
): Promise<{ cacheKey: string; templateDatabaseName: string }> {
  let cacheKey = permissionedRealmTemplateCacheKey(options);
  let templateDatabaseName = templateDatabaseNameForCacheKey(cacheKey);
  let existing = permissionedRealmTemplateCache.get(cacheKey);
  if (existing) {
    await existing.ready;
    return { cacheKey, templateDatabaseName };
  }

  let entry: CachedPermissionedRealmTemplateEntry = {
    ready: Promise.resolve(),
  };
  entry.ready = buildPermissionedRealmTemplate(cacheKey, options).catch(
    async (error) => {
      permissionedRealmTemplateCache.delete(cacheKey);
      try {
        await dropDatabase(templateDatabaseName);
      } catch {
        // best-effort cleanup
      }
      throw error;
    },
  );
  permissionedRealmTemplateCache.set(cacheKey, entry);
  await entry.ready;
  return { cacheKey, templateDatabaseName };
}

export function setupPermissionedRealmCached(
  hooks: NestedHooks,
  options: SetupPermissionedRealmCachedOptions,
) {
  // Validate before the cache lookup. The cache key canonicalizes
  // `fixture` to `null` when `fileSystem` is present (see
  // permissionedRealmTemplateCacheKey), so an invalid call passing
  // both would hash the same as a valid `fileSystem`-only call and
  // silently reuse that template — the throw in
  // startPermissionedRealmFixture only fires later at beforeEach,
  // after the misleading reuse. Mirror the same check up front so
  // an invalid combo errors at test-module load time, before any
  // cache work runs.
  if (options.fileSystem && options.fixture) {
    throw new Error(
      'setupPermissionedRealmCached: pass either `fileSystem` or `fixture`, not both',
    );
  }
  let acquiredTemplateDatabase: string | undefined;

  hooks.before(async function (assert) {
    // The first template acquisition builds the fixture realm's index — a
    // full boot whose queue drains the whole-realm prerender_html job. That
    // build runs inside the module's first test's budget, so extend it past
    // the suite-wide per-test timeout.
    assert.timeout(300_000);
    let { templateDatabaseName } =
      await acquirePermissionedRealmTemplate(options);
    acquiredTemplateDatabase = templateDatabaseName;
  });

  setupPermissionedRealm(hooks, {
    ...options,
    dbTemplateDatabase: () => acquiredTemplateDatabase,
  });
}

type SetupPermissionedRealmsCachedOptions = Omit<
  Parameters<typeof setupPermissionedRealms>[1],
  'dbTemplateDatabase'
>;

function permissionedRealmsTemplateCacheKey(
  options: SetupPermissionedRealmsCachedOptions,
): string {
  return hashCacheKeyPayload({
    version: 1,
    type: 'permissioned-realms',
    realms: options.realms,
    prerenderer: prerendererCacheKeyPart(options.prerenderer),
  });
}

async function buildPermissionedRealmsTemplate(
  cacheKey: string,
  options: SetupPermissionedRealmsCachedOptions,
): Promise<void> {
  let templateDatabaseName = templateDatabaseNameForCacheKey(cacheKey);
  let builderDatabaseName = builderDatabaseNameForCacheKey(cacheKey);

  let dbAdapter: PgAdapter | undefined;
  let publisher: QueuePublisher | undefined;
  let runner: QueueRunner | undefined;
  let fixture:
    | Awaited<ReturnType<typeof startPermissionedRealmsFixture>>
    | undefined;

  await dropDatabase(templateDatabaseName);
  await dropDatabase(builderDatabaseName);

  try {
    dbAdapter = await createTestPgAdapter({
      databaseName: builderDatabaseName,
      templateDatabase: migratedTestDatabaseTemplate,
    });
    publisher = new PgQueuePublisher(dbAdapter);
    runner = new PgQueueRunner({
      adapter: dbAdapter,
      workerId: 'template-worker',
    });

    fixture = await startPermissionedRealmsFixture(
      dbAdapter,
      publisher,
      runner,
      {
        realms: options.realms,
        prerenderer: options.prerenderer,
      },
    );

    await waitForQueueIdle(builderDatabaseName);
    for (let fixtureRealm of fixture.realms) {
      await logRealmIndexDiagnostics(
        dbAdapter,
        fixtureRealm.realm.url,
        'template-build',
      );
    }
    await teardownPermissionedRealmsFixture(fixture.realms);
    fixture = undefined;

    await publisher.destroy();
    publisher = undefined;
    await runner.destroy();
    runner = undefined;
    await dbAdapter.close();
    dbAdapter = undefined;

    await createTemplateSnapshot(builderDatabaseName, templateDatabaseName);
  } finally {
    if (fixture) {
      try {
        await teardownPermissionedRealmsFixture(fixture.realms);
      } catch {
        // best-effort cleanup
      }
    }
    if (publisher) {
      try {
        await publisher.destroy();
      } catch {
        // best-effort cleanup
      }
    }
    if (runner) {
      try {
        await runner.destroy();
      } catch {
        // best-effort cleanup
      }
    }
    if (dbAdapter && !dbAdapter.isClosed) {
      try {
        await dbAdapter.close();
      } catch {
        // best-effort cleanup
      }
    }
    try {
      await dropDatabase(builderDatabaseName);
    } catch {
      // best-effort cleanup
    }
  }
}

// Periodic heartbeat for long indexing phases. A from-scratch index runs as a
// single QUnit phase with no intermediate output, so a slow or stuck index
// surfaces only as an opaque `Test took longer than Nms` phase timeout — no
// signal about whether it was making progress or wedged. This logs elapsed
// time plus index progress (boxel_index rows per realm + unfulfilled job
// count) roughly every `intervalMs` while `fn` runs, so the next failure on
// this path shows a moving row count (slow) versus a frozen one (stuck) and
// which realm is mid-index. The next beat is scheduled only after the previous
// one finishes, so a progress query slower than `intervalMs` can't pile up
// concurrent queries on the same adapter during already-slow indexing. The
// timer is unref'd by the suite bootstrap, so it never keeps the process alive
// on its own; it only fires while the awaited work is holding the event loop.
export async function withIndexProgressHeartbeat<T>(
  label: string,
  dbAdapter: PgAdapter,
  fn: () => Promise<T>,
  { intervalMs = 15000 }: { intervalMs?: number } = {},
): Promise<T> {
  let startedAt = Date.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let beat = async () => {
    let elapsedS = Math.round((Date.now() - startedAt) / 1000);
    let detail = '';
    try {
      let rows = await dbAdapter.execute(
        `SELECT realm_url, COUNT(*)::int AS rows FROM boxel_index GROUP BY realm_url ORDER BY realm_url`,
      );
      let jobs = await dbAdapter.execute(
        `SELECT COUNT(*)::int AS count FROM jobs WHERE status = 'unfulfilled'`,
      );
      detail = ` boxel_index=[${rows
        .map((r) => `${r.realm_url}:${r.rows}`)
        .join(', ')}] unfulfilled_jobs=${jobs[0]?.count ?? '?'}`;
    } catch (e) {
      detail = ` (progress query failed: ${(e as Error).message})`;
    }
    console.log(
      `[index-heartbeat] ${label} still running after ${elapsedS}s;${detail}`,
    );
  };
  let schedule = () => {
    timer = setTimeout(async () => {
      if (stopped) {
        return;
      }
      await beat();
      if (!stopped) {
        schedule();
      }
    }, intervalMs);
  };
  schedule();
  try {
    return await fn();
  } finally {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  }
}

// Template-database cache for a fully-indexed base realm. Cold-indexing the
// whole base realm (every `.gts` definition rendered through the single-tab
// in-process prerenderer) is the most expensive setup in the suite — tens of
// seconds — and any test that does it inline pays that cost inside a QUnit
// phase bounded by `config.testTimeout`. Building it once here, snapshotting
// to a template database, and cloning that per test turns each test's
// `base.start()` into a no-op: the cloned database already holds base's
// `boxel_index` rows (so `isNewIndex()` is false and startup skips the
// from-scratch pass) and its `modules` definition cache (so a later
// `reindex()` re-derives every definition from a cache hit instead of a fresh
// prerender). Keyed by base source path + prerenderer identity so a different
// base directory or unrelated injected prerenderer doesn't reuse the wrong
// snapshot; built at most once per qunit process.
let baseRealmTemplateCache = new Map<string, { ready: Promise<void> }>();

function baseRealmTemplateCacheKey(
  basePath: string,
  prerenderer: Prerenderer,
): string {
  return hashCacheKeyPayload({
    version: 1,
    type: 'base-realm',
    basePath,
    prerenderer: prerendererCacheKeyPart(prerenderer),
  });
}

// Build (or reuse) a template database with the base realm fully indexed and
// return its name. Pass the resulting name as `setupDB`'s `templateDatabase`
// so each test clones a base-indexed database instead of re-indexing base.
// `basePath` is the on-disk base realm source (packages/base).
export async function acquireBaseRealmTemplate(
  basePath: string,
  prerenderer: Prerenderer,
): Promise<string> {
  let cacheKey = baseRealmTemplateCacheKey(basePath, prerenderer);
  let templateDatabaseName = templateDatabaseNameForCacheKey(cacheKey);
  let existing = baseRealmTemplateCache.get(cacheKey);
  if (existing) {
    await existing.ready;
    return templateDatabaseName;
  }

  let entry: { ready: Promise<void> } = { ready: Promise.resolve() };
  entry.ready = buildBaseRealmTemplate(cacheKey, basePath, prerenderer).catch(
    async (error) => {
      baseRealmTemplateCache.delete(cacheKey);
      try {
        await dropDatabase(templateDatabaseName);
      } catch {
        // best-effort cleanup
      }
      throw error;
    },
  );
  baseRealmTemplateCache.set(cacheKey, entry);
  await entry.ready;
  return templateDatabaseName;
}

// Dedicated port for the throwaway base-realm server the template builder
// stands up so the prerenderer can fetch base modules during the cold index.
// Routed through `testPort()` like the rest of the suite so environment-mode
// runs offset it per environment — two parallel realm-test processes both
// building the template won't collide on `127.0.0.1` with EADDRINUSE. Kept
// just below the prerender port (testPort(4460)); the builder also tears its
// server down before any test's `beforeEach` binds its own ports.
const baseRealmTemplateBuilderPort = testPort(4459);

async function buildBaseRealmTemplate(
  cacheKey: string,
  basePath: string,
  prerenderer: Prerenderer,
): Promise<void> {
  let templateDatabaseName = templateDatabaseNameForCacheKey(cacheKey);
  let builderDatabaseName = builderDatabaseNameForCacheKey(cacheKey);

  let dbAdapter: PgAdapter | undefined;
  let publisher: QueuePublisher | undefined;
  let runner: QueueRunner | undefined;
  let httpServer: Server | undefined;
  let base: Realm | undefined;

  await dropDatabase(templateDatabaseName);
  await dropDatabase(builderDatabaseName);

  try {
    dbAdapter = await createTestPgAdapter({
      databaseName: builderDatabaseName,
      templateDatabase: migratedTestDatabaseTemplate,
    });
    publisher = new PgQueuePublisher(dbAdapter);
    runner = new PgQueueRunner({
      adapter: dbAdapter,
      workerId: 'base-template-worker',
    });

    let virtualNetwork = createVirtualNetwork();
    let localBaseRealmURL = new URL(
      `http://127.0.0.1:${baseRealmTemplateBuilderPort}/base/`,
    );
    virtualNetwork.addURLMapping(new URL(baseRealm.url), localBaseRealmURL);
    // Mirror the symmetry from createVirtualNetwork: register the
    // @cardstack/base/ realm-prefix mapping too. unresolveURL on the
    // virtual base-realm URL needs the prefix mapping to canonicalise
    // to RRI form, matching what the host-side prerender writes.
    virtualNetwork.addRealmMapping('@cardstack/base/', localBaseRealmURL.href);

    let definitionLookup = new CachingDefinitionLookup(
      dbAdapter,
      prerenderer,
      virtualNetwork,
      testCreatePrerenderAuth,
    );

    ({ realm: base } = await createRealm({
      definitionLookup,
      withWorker: true,
      prerenderer,
      dir: basePath,
      realmURL: baseRealm.url,
      virtualNetwork,
      publisher,
      runner,
      dbAdapter,
      deferStartUp: true,
    }));
    virtualNetwork.mount(base.handle);

    let matrixClient = new MatrixClient({
      matrixURL: realmServerTestMatrix.url,
      username: realmServerTestMatrix.username,
      seed: realmSecretSeed,
    });
    let server = new RealmServer({
      realms: [base],
      reconciler: makeTestReconciler(dbAdapter, [base]),
      virtualNetwork,
      matrixClient,
      realmServerSecretSeed,
      realmSecretSeed,
      grafanaSecret,
      aiBotDelegationSecret,
      matrixRegistrationSecret,
      realmsRootPath: dirSync().name,
      dbAdapter,
      queue: publisher,
      getIndexHTML,
      serverURL: new URL(`http://127.0.0.1:${baseRealmTemplateBuilderPort}`),
      assetsURL: new URL(`http://example.com/notional-assets-host/`),
      definitionLookup,
      prerenderer,
    });
    httpServer = server.listen(baseRealmTemplateBuilderPort);
    await withIndexProgressHeartbeat(
      'base-realm template build (base.start)',
      dbAdapter,
      () => base!.start(),
    );

    await waitForQueueIdle(builderDatabaseName);

    await closeServer(httpServer);
    httpServer = undefined;
    base.__testOnlyClearCaches();
    base = undefined;

    await publisher.destroy();
    publisher = undefined;
    await runner.destroy();
    runner = undefined;
    await dbAdapter.close();
    dbAdapter = undefined;

    await createTemplateSnapshot(builderDatabaseName, templateDatabaseName);
  } finally {
    if (httpServer) {
      try {
        await closeServer(httpServer);
      } catch {
        // best-effort cleanup
      }
    }
    if (publisher) {
      try {
        await publisher.destroy();
      } catch {
        // best-effort cleanup
      }
    }
    if (runner) {
      try {
        await runner.destroy();
      } catch {
        // best-effort cleanup
      }
    }
    if (dbAdapter && !dbAdapter.isClosed) {
      try {
        await dbAdapter.close();
      } catch {
        // best-effort cleanup
      }
    }
    try {
      await dropDatabase(builderDatabaseName);
    } catch {
      // best-effort cleanup
    }
  }
}

async function acquirePermissionedRealmsTemplate(
  options: SetupPermissionedRealmsCachedOptions,
): Promise<{ cacheKey: string; templateDatabaseName: string }> {
  let cacheKey = permissionedRealmsTemplateCacheKey(options);
  let templateDatabaseName = templateDatabaseNameForCacheKey(cacheKey);
  let existing = permissionedRealmTemplateCache.get(cacheKey);
  if (existing) {
    await existing.ready;
    return { cacheKey, templateDatabaseName };
  }

  let entry: CachedPermissionedRealmTemplateEntry = {
    ready: Promise.resolve(),
  };
  entry.ready = buildPermissionedRealmsTemplate(cacheKey, options).catch(
    async (error) => {
      permissionedRealmTemplateCache.delete(cacheKey);
      try {
        await dropDatabase(templateDatabaseName);
      } catch {
        // best-effort cleanup
      }
      throw error;
    },
  );
  permissionedRealmTemplateCache.set(cacheKey, entry);
  await entry.ready;
  return { cacheKey, templateDatabaseName };
}

export function setupPermissionedRealmsCached(
  hooks: NestedHooks,
  options: SetupPermissionedRealmsCachedOptions,
) {
  // Same up-front validation as setupPermissionedRealmCached so the
  // per-realm fileSystem/fixture conflict errors at test-module load
  // time rather than at beforeEach inside startPermissionedRealmsFixture.
  for (let realm of options.realms) {
    if (realm.fileSystem && realm.fixture) {
      throw new Error(
        `setupPermissionedRealmsCached: realm "${realm.realmURL}" passed both \`fileSystem\` and \`fixture\` — pass one or the other, not both`,
      );
    }
  }
  let acquiredTemplateDatabase: string | undefined;

  hooks.before(async function (assert) {
    // See setupPermissionedRealmCached: the first acquisition builds the
    // fixture realms' indexes, whole-realm prerender_html jobs included.
    assert.timeout(300_000);
    let { templateDatabaseName } =
      await acquirePermissionedRealmsTemplate(options);
    acquiredTemplateDatabase = templateDatabaseName;
  });

  setupPermissionedRealms(hooks, {
    ...options,
    dbTemplateDatabase: () => acquiredTemplateDatabase,
  });
}

export function createJWT(
  realm: Realm,
  user: string,
  permissions: RealmPermissions['user'] = [],
) {
  return realm.createJWT(
    {
      user,
      realm: realm.url,
      permissions,
      sessionRoom: `test-session-room-for-${user}`,
      realmServerURL: realm.realmServerURL,
    },
    '7d',
  );
}

// Variant that builds a realm JWT from URL + seed instead of a Realm
// instance. Useful when the realm hasn't been mounted yet (Phase 3 lazy
// mount): the request that carries this JWT is the trigger that mounts
// the realm. Auth verification on the server side uses the same shared
// realmSecretSeed regardless of which Realm instance handles the
// request, so the token is accepted as long as the URL claim matches.
export function createJWTForRealmURL({
  realmURL,
  realmServerURL,
  user,
  permissions = [],
}: {
  realmURL: string;
  realmServerURL: string;
  user: string;
  permissions?: RealmPermissions['user'];
}) {
  return jwtSign(
    {
      user,
      realm: realmURL,
      permissions,
      sessionRoom: `test-session-room-for-${user}`,
      realmServerURL,
    },
    realmSecretSeed,
    { expiresIn: '7d' },
  );
}

export const cardInfo = {
  notes: null,
  name: null,
  summary: null,
  cardThumbnailURL: null,
};

// Builds the JSON string for a /realm.json RealmConfig card from a flat
// config object ({ name, iconURL, backgroundURL, ... }). The card stores
// `name` under cardInfo.name (matching the CardDef slot); other fields land
// on attributes directly. Mirrors the host helper so realm-server tests can
// build the same shape without depending on host.
export function realmConfigCardJSON(
  config: {
    name?: string;
    iconURL?: string;
    backgroundURL?: string;
    includePrerenderedDefaultRealmIndex?: boolean;
  } = {},
): string {
  let attrs: Record<string, unknown> = {};
  if (config.name !== undefined) {
    attrs.cardInfo = { name: config.name };
  }
  if (config.iconURL !== undefined) {
    attrs.iconURL = config.iconURL;
  }
  if (config.backgroundURL !== undefined) {
    attrs.backgroundURL = config.backgroundURL;
  }
  if (config.includePrerenderedDefaultRealmIndex !== undefined) {
    attrs.includePrerenderedDefaultRealmIndex =
      config.includePrerenderedDefaultRealmIndex;
  }
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: attrs,
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/realm-config',
          name: 'RealmConfig',
        },
      },
    },
  });
}
