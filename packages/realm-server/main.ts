import './instrument';
import './setup-logger'; // This should be first
import './lib/wtfnode-on-signal';
import { writeSync } from 'node:fs';
import {
  Realm,
  VirtualNetwork,
  isUrlLike,
  logger,
  Deferred,
  CachingDefinitionLookup,
  DEFAULT_CARD_SIZE_LIMIT_BYTES,
  DEFAULT_FILE_SIZE_LIMIT_BYTES,
} from '@cardstack/runtime-common';
import { NodeAdapter } from './node-realm';
import yargs from 'yargs';
import { RealmServer } from './server';
import { join } from 'path';
import * as Sentry from '@sentry/node';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';

import 'decorator-transforms/globals';
import { createRemotePrerenderer } from './prerender/remote-prerenderer';
import { buildCreatePrerenderAuth } from './prerender/auth';
import {
  isEnvironmentMode,
  getEnvironmentSlug,
  serviceURL,
  registerService,
  deregisterEnvironment,
} from './lib/dev-service-registry';
import { writeRuntimeMetadataFile } from './lib/runtime-metadata-file';
import { runRegistryBackfillWithAdvisoryLock } from './lib/realm-registry-backfill';
import {
  RealmRegistryReconciler,
  type RealmRegistryRow,
} from './lib/realm-registry-reconciler';
import { RealmFileChangesListener } from './lib/realm-file-changes-listener';
import { RealmIndexUpdatedListener } from './lib/realm-index-updated-listener';
import { ModuleCacheInvalidationListener } from './lib/module-cache-invalidation-listener';
import { ModuleCacheCoordinator } from './lib/module-cache-coordination';
import { JobsFinishedListener } from './lib/jobs-finished-listener';
import { JobScopedSearchCache } from './job-scoped-search-cache';
import { resolveFullIndexOnStartup } from './lib/full-index-on-startup';
import { PUBLISHED_DIRECTORY_NAME } from '@cardstack/runtime-common';

// FD-level synchronous stderr write — `writeSync(2, ...)` calls the
// write(2) syscall directly, bypassing Node's stream layer.
// `process.stderr.write` is libuv-async when stderr is a pipe (the
// Docker / ECS case), so it can be lost if the process exits before
// libuv flushes. Stamps that fire just before death need to use the
// FD-level form. Proof the Node process actually started, at what
// pid/ppid, independent of the logger pipeline.
writeSync(
  2,
  `[realm-server] STARTUP pid=${process.pid} ppid=${process.ppid} argv=${JSON.stringify(process.argv)}\n`,
);

let log = logger('main');
const runtimeMetadataFile = process.env.TEST_HARNESS_REALM_SERVER_METADATA_FILE;

function writeRuntimeMetadata(payload: unknown): void {
  writeRuntimeMetadataFile(runtimeMetadataFile, 'realm-server', payload);
}

if (process.env.NODE_ENV === 'test') {
  (globalThis as any).__environment = 'test';
}

const REALM_SERVER_SECRET_SEED = process.env.REALM_SERVER_SECRET_SEED;
if (!REALM_SERVER_SECRET_SEED) {
  console.error(
    `The REALM_SERVER_SECRET_SEED environment variable is not set. Please make sure this env var has a value`,
  );
  process.exit(-1);
}

const REALM_SECRET_SEED = process.env.REALM_SECRET_SEED;
if (!REALM_SECRET_SEED) {
  console.error(
    `The REALM_SECRET_SEED environment variable is not set. Please make sure this env var has a value`,
  );
  process.exit(-1);
}

const GRAFANA_SECRET = process.env.GRAFANA_SECRET;
if (!GRAFANA_SECRET) {
  console.error(
    `The GRAFANA_SECRET environment variable is not set. Please make sure this env var has a value`,
  );
  process.exit(-1);
}

const MATRIX_URL = process.env.MATRIX_URL;
if (!MATRIX_URL) {
  console.error(
    `The MATRIX_URL environment variable is not set. Please make sure this env var has a value`,
  );
  process.exit(-1);
}

const REALM_SERVER_MATRIX_USERNAME = process.env.REALM_SERVER_MATRIX_USERNAME;
if (!REALM_SERVER_MATRIX_USERNAME) {
  console.error(
    `The REALM_SERVER_MATRIX_USERNAME environment variable is not set. Please make sure this env var has a value`,
  );
  process.exit(-1);
}

const MATRIX_REGISTRATION_SHARED_SECRET =
  process.env.MATRIX_REGISTRATION_SHARED_SECRET;

// Synapse admin credentials. Optional: only consumed by operator-action
// endpoints that need to admin-impersonate a target user to read or write
// their account_data on their behalf (synapse admin tokens can read but
// not write another user's account_data). When unset on a localhost
// matrix homeserver, the grafana upsert handler defaults to the dev
// admin/password pair register-matrix-users.ts creates.
const MATRIX_ADMIN_USERNAME = process.env.MATRIX_ADMIN_USERNAME;
const MATRIX_ADMIN_PASSWORD = process.env.MATRIX_ADMIN_PASSWORD;

if (process.env.DISABLE_MODULE_CACHING === 'true') {
  console.warn(
    `module caching has been disabled, module executables will be served directly from the filesystem`,
  );
}

const ENABLE_FILE_WATCHER = process.env.ENABLE_FILE_WATCHER === 'true';
// REALM_SERVER_FULL_INDEX_ON_STARTUP is a three-state override (resolved in
// lib/full-index-on-startup.ts) that controls whether each realm runs a
// from-scratch index when its process boots. The `isNewIndex` branch in
// Realm.start() is independent of this flag, so a brand-new (empty) index
// still builds on first boot regardless of which value is set here.
//   - default (unset, or any value other than 'true' / 'false'): only
//     kind='bootstrap' realms (the ones passed via the CLI --path args,
//     e.g. base / catalog / skills) full-index on startup. kind='source'
//     (user realms) and kind='published' realms skip the boot reindex.
//   - 'true': every realm full-indexes on startup, regardless of kind.
//     Matches the pre-flip behavior.
//   - 'false': suppresses the env-driven full-index for every kind. Used by
//     the cached-index dev flow (scripts/import-cached-index.sh) where the
//     index tables were just restored from a recent CI snapshot.
// The deploy-time platform-code reindex flows through a different path
// (handle-post-deployment.ts + boxel-ui checksum), so flipping the default
// here does not affect post-deploy reindex storms.
const FULL_INDEX_ON_STARTUP_OVERRIDE =
  process.env.REALM_SERVER_FULL_INDEX_ON_STARTUP;
// When set to 'true', skip the unconditional modules-cache clear on startup.
// Used by the software-factory test harness, which restores a known-good
// modules cache from a template database (URLs already rewritten to match
// the runtime port) and would otherwise pay a full cold prerender on every
// test's first lookupDefinition.
const SKIP_MODULES_CACHE_CLEAR_ON_STARTUP =
  process.env.REALM_SERVER_SKIP_MODULES_CACHE_CLEAR_ON_STARTUP === 'true';
// CS-10953 cross-process prerender coalesce. Off by default — flip on
// after a stage burn-in. Effectively inert at N=1 (no contention; the
// in-process #inFlight coalescer already dedups same-process callers),
// but the extra BEGIN/try-lock/COMMIT roundtrip on every cache miss is
// measurable, so we ship dormant and flip explicitly. At N>1 enables
// 1-prerender-per-fleet on cold fan-out.
const PRERENDER_COALESCE_ACROSS_PROCESSES =
  process.env.PRERENDER_COALESCE_ACROSS_PROCESSES === 'true';

let {
  port,
  matrixURL,
  realmsRootPath,
  serviceName = 'realm-server',
  serverURL = isEnvironmentMode()
    ? serviceURL(serviceName)
    : `https://localhost:${port}`,
  distURL = isEnvironmentMode()
    ? serviceURL('host')
    : (process.env.HOST_URL ?? 'https://localhost:4200'),
  path: paths,
  fromUrl: fromUrls,
  toUrl: toUrls,
  username: usernames,
  useRegistrationSecretFunction,
  migrateDB,
  workerManagerPort,
  workerManagerUrl,
  prerendererUrl,
} = yargs(process.argv.slice(2))
  .usage('Start realm server')
  .options({
    port: {
      description: 'port number',
      demandOption: true,
      type: 'number',
    },
    fromUrl: {
      description: 'the source of the realm URL proxy',
      demandOption: true,
      type: 'array',
    },
    toUrl: {
      description: 'the target of the realm URL proxy',
      demandOption: true,
      type: 'array',
    },
    realmsRootPath: {
      description: 'the path in which dynamically created realms are created',
      demandOption: true,
      type: 'string',
    },
    serverURL: {
      description: 'the unresolved URL of the realm server',
      type: 'string',
    },
    path: {
      description: 'realm directory path',
      demandOption: true,
      type: 'array',
    },
    distURL: {
      description:
        'the URL of a deployed host app. (This can be provided instead of the --distPath)',
      type: 'string',
    },
    matrixURL: {
      description: 'The matrix homeserver for the realm',
      demandOption: true,
      type: 'string',
    },
    username: {
      description: 'The matrix username for the realm user',
      demandOption: true,
      type: 'array',
    },
    migrateDB: {
      description:
        'When this flag is set the database will automatically migrate when server is started',
      type: 'boolean',
    },
    useRegistrationSecretFunction: {
      description:
        'The flag should be set when running matrix tests where the synapse instance is torn down and restarted multiple times during the life of the realm server.',
      type: 'boolean',
    },
    workerManagerPort: {
      description:
        'The port the worker manager is running on. used to wait for the workers to be ready',
      type: 'number',
    },
    workerManagerUrl: {
      description:
        'The full URL of the worker manager. Used in branch mode instead of workerManagerPort.',
      type: 'string',
    },
    prerendererUrl: {
      demandOption: true,
      description: 'URL of the prerender server to invoke',
      type: 'string',
    },
    serviceName: {
      description:
        'Traefik service name for registration in branch mode (default: realm-server)',
      type: 'string',
    },
  })
  .parseSync();

if (fromUrls.length !== toUrls.length) {
  console.error(
    `Mismatched number of URLs, the --fromUrl params must be matched to the --toUrl params`,
  );
  process.exit(-1);
}
if (fromUrls.length < paths.length) {
  console.error(
    `not enough url pairs were provided to satisfy the paths provided. There must be at least one --fromUrl/--toUrl pair for each --path parameter`,
  );
  process.exit(-1);
}

if (paths.length !== usernames.length) {
  console.error(
    `not enough usernames were provided to satisfy the paths provided. There must be at least one --username set for each --path parameter`,
  );
  process.exit(-1);
}

if (!useRegistrationSecretFunction && !MATRIX_REGISTRATION_SHARED_SECRET) {
  console.error(
    `The MATRIX_REGISTRATION_SHARED_SECRET environment variable is not set. Please make sure this env var has a value (or specify --useRegistrationSecretFunction)`,
  );
  process.exit(-1);
}

let virtualNetwork = new VirtualNetwork();
let urlMappings: [URL, URL][] = [];
for (let i = 0; i < fromUrls.length; i++) {
  let from = String(fromUrls[i]);
  let to = new URL(String(toUrls[i]));
  if (isUrlLike(from)) {
    let fromURL = new URL(from);
    virtualNetwork.addURLMapping(fromURL, to);
    urlMappings.push([fromURL, to]);
  } else {
    virtualNetwork.addRealmMapping(from, to.href);
    urlMappings.push([to, to]); // use toUrl for both in hrefs
  }
}
let hrefs = urlMappings.map(([from, to]) => [from.href, to.href]);
let dist: URL = new URL(distURL);
let autoMigrate = migrateDB || undefined;

log.info(
  `Realm server boot config: port=${port} serverURL=${serverURL} distURL=${distURL} matrixURL=${matrixURL} realmsRootPath=${realmsRootPath} migrateDB=${Boolean(
    migrateDB,
  )} workerManagerPort=${workerManagerPort ?? 'none'} prerendererUrl=${prerendererUrl} enableFileWatcher=${ENABLE_FILE_WATCHER} fullIndexOnStartupOverride=${FULL_INDEX_ON_STARTUP_OVERRIDE ?? 'unset (bootstrap-only)'}`,
);
log.info(`Realm paths: ${paths.map(String).join(', ')}`);

const getIndexHTML = async () => {
  let response = await fetch(distURL);
  if (!response.ok) {
    throw new Error(
      `Received unsuccessful response fetching index.html from host app URL: ${response.status} - ${await response.text()}`,
    );
  }
  return await response.text();
};

// At boot, the host app may not yet be reachable: vite's first
// optimizer pass takes several seconds; in env mode Traefik's macOS
// file-watcher reloads can race the realm-server's first probe; and
// fresh shells without `mkcert -install` may still be missing trust
// for a TLS handshake until NODE_EXTRA_CA_CERTS propagates. A single
// fetch attempt with `process.exit(-2)` on failure turns any of these
// transient conditions into a crash-loop that takes the whole stack
// down. Retry with linear backoff for ~30s before giving up.
const SMOKE_TEST_TIMEOUT_MS = 30_000;
const SMOKE_TEST_BACKOFF_MS = 2_000;
const smokeTestHostApp = async () => {
  let started = Date.now();
  let lastError: Error | undefined;
  while (Date.now() - started < SMOKE_TEST_TIMEOUT_MS) {
    try {
      await getIndexHTML();
      return;
    } catch (e) {
      lastError = e as Error;
      let cause = (e as { cause?: { message?: string; code?: string } }).cause;
      let detail = cause?.code || cause?.message || lastError.message;
      console.warn(
        `Host app URL ${distURL} not yet reachable (${detail}); retrying in ${SMOKE_TEST_BACKOFF_MS}ms…`,
      );
      await new Promise((r) => setTimeout(r, SMOKE_TEST_BACKOFF_MS));
    }
  }
  throw lastError ?? new Error('host app smoke test timed out');
};

(async () => {
  try {
    await smokeTestHostApp();
  } catch (e: any) {
    Sentry.captureException(e);
    let cause = e?.cause as { message?: string; code?: string } | undefined;
    let detail = cause?.code
      ? `${cause.code}${cause.message ? `: ${cause.message}` : ''}`
      : (cause?.message ?? e.message);
    console.error(`Unable to fetch from host app URL ${distURL}: ${detail}`);
    process.exit(-2);
  }
  let realms: Realm[] = [];
  let dbAdapter = new PgAdapter({ autoMigrate });
  let queue = new PgQueuePublisher(dbAdapter);
  // One process-wide job-scoped search cache, shared between the request
  // handlers (via RealmServer → createRoutes) and the JobsFinishedListener
  // so a `jobs_finished` NOTIFY evicts the same entries the handlers populate.
  let searchCache = new JobScopedSearchCache();
  let reconciler: RealmRegistryReconciler | undefined;
  let fileChangesListener: RealmFileChangesListener | undefined;
  let indexUpdatedListener: RealmIndexUpdatedListener | undefined;
  let jobsFinishedListener: JobsFinishedListener | undefined;
  let moduleCacheInvalidationListener:
    | ModuleCacheInvalidationListener
    | undefined;
  let moduleCacheCoordinator: ModuleCacheCoordinator | undefined;

  if (workerManagerUrl) {
    await waitForWorkerManager(workerManagerUrl);
  } else if (workerManagerPort != null) {
    await waitForWorkerManager(`http://localhost:${workerManagerPort}`);
  }

  let matrixClient = new MatrixClient({
    matrixURL: new URL(MATRIX_URL),
    username: REALM_SERVER_MATRIX_USERNAME,
    seed: REALM_SECRET_SEED,
  });
  let prerenderer = createRemotePrerenderer(prerendererUrl);
  let createPrerenderAuth = buildCreatePrerenderAuth(
    REALM_SECRET_SEED,
    serverURL,
  );

  // CS-10953: optionally construct a cross-process prerender coalescer
  // (advisory-lock + NOTIFY) and wire it into CachingDefinitionLookup.
  // Off by default — flip via PRERENDER_COALESCE_ACROSS_PROCESSES=true.
  // The listener has to be `start()`ed before any coordinated load can
  // park on it, so we spin it up here, before the CachingDefinitionLookup
  // would ever serve its first lookup.
  if (PRERENDER_COALESCE_ACROSS_PROCESSES) {
    moduleCacheCoordinator = new ModuleCacheCoordinator({ dbAdapter });
    await moduleCacheCoordinator.start();
  }

  let definitionLookup = new CachingDefinitionLookup(
    dbAdapter,
    prerenderer,
    virtualNetwork,
    createPrerenderAuth,
    moduleCacheCoordinator,
  );

  if (SKIP_MODULES_CACHE_CLEAR_ON_STARTUP) {
    log.info('Skipping modules cache clear on startup (opted out via env)');
  } else {
    log.info('Clearing modules cache...');
    await definitionLookup.clearAllDefinitions();
  }

  // Backfill realm_registry from CLI args (bootstrap), on-disk source realms,
  // and on-disk published realms. Runs before Realm construction so the
  // registry reflects known state before anything mounts. Shadow data only in
  // Phase 1: no reader depends on these rows yet (see CS-10888, CS-10889).
  // Guarded by a pg advisory lock so, in a future multi-instance deployment,
  // only one process does the disk scan per startup wave (CS-10890).
  await runRegistryBackfillWithAdvisoryLock(dbAdapter, {
    dbAdapter,
    realmsRootPath,
    serverURL: new URL(String(serverURL)),
    bootstrapRealms: paths.map((p, i) => ({
      diskPath: String(p),
      url: hrefs[i][0],
    })),
  });

  // Validate per-CLI-path username invariant. Phase 3 no longer constructs
  // realms here — the reconciler does it via mountFromRow once registry
  // rows are read — but we still want the misconfiguration to fail fast.
  for (let [i] of paths.entries()) {
    let username = String(usernames[i]);
    if (username.length === 0) {
      console.error(`missing username for realm ${hrefs[i][0]}`);
      process.exit(-1);
    }
  }

  let registrationSecretDeferred: Deferred<string>;
  async function getRegistrationSecret() {
    if (process.send) {
      registrationSecretDeferred = new Deferred();
      process.send('get-registration-secret');
      return registrationSecretDeferred.promise;
    } else {
      return undefined;
    }
  }

  // Domains to use for when users publish their realms.
  // PUBLISHED_REALM_BOXEL_SPACE_DOMAIN is used to form urls like "mike.boxel.space/game-mechanics"
  // PUBLISHED_REALM_BOXEL_SITE_DOMAIN is used to form urls like "mike.boxel.site"
  let defaultPublishedDomain = isEnvironmentMode()
    ? `realm-server.${getEnvironmentSlug()}.localhost`
    : 'localhost:4201';
  let domainsForPublishedRealms = {
    boxelSpace:
      process.env.PUBLISHED_REALM_BOXEL_SPACE_DOMAIN || defaultPublishedDomain,
    boxelSite:
      process.env.PUBLISHED_REALM_BOXEL_SITE_DOMAIN || defaultPublishedDomain,
  };

  // Construct the reconciler before the server so the server can hold a
  // reference to it. The reconciler doesn't begin its background poll
  // loop until reconciler.start() is called below, after server.start()
  // has finished its first reconcile pass.
  reconciler = new RealmRegistryReconciler({
    dbAdapter,
    prepareRealmFromRow: (row: RealmRegistryRow) => {
      let diskPath: string;
      if (row.kind === 'bootstrap') {
        diskPath = row.disk_id;
      } else if (row.kind === 'source') {
        diskPath = join(realmsRootPath, row.disk_id);
      } else {
        diskPath = join(realmsRootPath, PUBLISHED_DIRECTORY_NAME, row.disk_id);
      }
      const reconciledAdapter = new NodeAdapter(diskPath, ENABLE_FILE_WATCHER);
      let fullIndexOnStartup = resolveFullIndexOnStartup(
        row.kind,
        FULL_INDEX_ON_STARTUP_OVERRIDE,
      );
      const reconciledRealm = new Realm(
        {
          url: row.url,
          adapter: reconciledAdapter,
          secretSeed: REALM_SECRET_SEED,
          virtualNetwork,
          dbAdapter,
          queue,
          matrixClient,
          realmServerURL: serverURL,
          definitionLookup,
          // CS-11030: reuse the same coordinator that powers
          // CachingDefinitionLookup's cross-process coalesce. Distinct
          // coalesce keys ("transpile|..." vs the prerender key shape)
          // route through the shared MODULE_CACHE_POPULATED_CHANNEL —
          // waiters key off the int64 hash of the full coalesceKey, so
          // crosstalk between the two flows is a benign hash miss in
          // each direction.
          transpileCoordinator: moduleCacheCoordinator,
          cardSizeLimitBytes: Number(
            process.env.CARD_SIZE_LIMIT_BYTES ?? DEFAULT_CARD_SIZE_LIMIT_BYTES,
          ),
          fileSizeLimitBytes: Number(
            process.env.FILE_SIZE_LIMIT_BYTES ?? DEFAULT_FILE_SIZE_LIMIT_BYTES,
          ),
        },
        {
          ...(fullIndexOnStartup ? { fullIndexOnStartup: true as const } : {}),
          ...(process.env.DISABLE_MODULE_CACHING === 'true'
            ? { disableModuleCaching: true }
            : {}),
        },
      );
      // Publish synchronously into realms[] + virtualNetwork. The
      // reconciler awaits realm.start() separately — by the time start()
      // begins (which awaits a multi-minute fullIndex on a fresh DB),
      // the realm is already reachable on the request path. This keeps
      // worker self-fetches (e.g., `<realm>/_mtimes`) and concurrent
      // request handlers from re-entering ensureMounted() on an
      // in-flight mount.
      realms.push(reconciledRealm);
      virtualNetwork.mount(reconciledRealm.handle);
      return reconciledRealm;
    },
    unmount: async (realm) => {
      realm.unsubscribe();
      virtualNetwork.unmount(realm.handle);
      const idx = realms.indexOf(realm);
      if (idx >= 0) {
        realms.splice(idx, 1);
      }
    },
  });

  let server = new RealmServer({
    realms,
    reconciler,
    virtualNetwork,
    matrixClient,
    realmsRootPath,
    realmServerSecretSeed: REALM_SERVER_SECRET_SEED,
    realmSecretSeed: REALM_SECRET_SEED,
    grafanaSecret: GRAFANA_SECRET,
    dbAdapter,
    queue,
    searchCache,
    definitionLookup,
    assetsURL: process.env.ASSETS_URL_OVERRIDE
      ? new URL(process.env.ASSETS_URL_OVERRIDE)
      : dist,
    getIndexHTML,
    serverURL: new URL(serverURL),
    matrixRegistrationSecret: MATRIX_REGISTRATION_SHARED_SECRET,
    matrixAdminUsername: MATRIX_ADMIN_USERNAME,
    matrixAdminPassword: MATRIX_ADMIN_PASSWORD,
    enableFileWatcher: ENABLE_FILE_WATCHER,
    domainsForPublishedRealms,
    getRegistrationSecret: useRegistrationSecretFunction
      ? getRegistrationSecret
      : undefined,
    prerenderer,
  });

  let httpServer = server.listen(port);
  httpServer.on('listening', () => {
    let actualPort =
      (httpServer.address() as import('net').AddressInfo | null)?.port ?? port;
    writeRuntimeMetadata({
      pid: process.pid,
      port: actualPort,
    });
    if (isEnvironmentMode()) {
      registerService(httpServer, serviceName, { wildcardSubdomains: true });
    }
  });
  let stopping = false;
  let stopRealmServer = (notifyParent = false) => {
    if (stopping) return;
    stopping = true;
    let stopPort =
      (httpServer.address() as import('net').AddressInfo | null)?.port ?? port;
    console.log(`stopping realm server on port ${stopPort}...`);
    if (isEnvironmentMode()) {
      deregisterEnvironment();
    }
    // Close per-realm file watchers (sane → fs.watch) on shutdown.
    // Each mounted Realm owns a NodeAdapter watcher that holds FSWatcher
    // handles open; leaving them pins the event loop and prevents the
    // process from exiting naturally. Safe to run before httpServer.close
    // — watchers only feed cache invalidation, not request serving.
    for (let r of realms) {
      try {
        r.unsubscribe();
      } catch (err) {
        console.error(`error unsubscribing realm ${r.url}:`, err);
      }
    }
    // Both the plain `http.Server` and the TLS-mode `net.Server`
    // dispatcher (see `server.ts`) expose `closeAllConnections()`. The
    // dispatcher's mirror force-closes in-flight TLS / HTTP/2 /
    // keep-alive sessions instead of waiting for peers to release them
    // — without it `close()` can hang for a tab-keep-alive lifetime.
    if (typeof (httpServer as any).closeAllConnections === 'function') {
      (httpServer as any).closeAllConnections();
    }
    httpServer.close(() => {
      (async () => {
        await Promise.all([
          reconciler?.shutDown(),
          fileChangesListener?.shutDown(),
          indexUpdatedListener?.shutDown(),
          jobsFinishedListener?.shutDown(),
          moduleCacheInvalidationListener?.shutDown(),
          moduleCacheCoordinator?.shutDown(),
        ]);
        queue.destroy(); // warning this is async
        dbAdapter.close(); // warning this is async
        console.log(`realm server on port ${stopPort} has stopped`);
        if (notifyParent && process.send) {
          process.send('stopped');
        }
        process.exit(0);
      })().catch((err) => {
        console.error('error during shutdown', err);
        process.exit(1);
      });
    });
  };
  // SIGTERM/SIGINT take the same shutdown path as the IPC `stop`
  // message, so process-group sweeps from `mise dev` and equivalent
  // orchestrators trigger graceful cleanup (close httpServer, unsubscribe
  // realm watchers, drain queue + DB) instead of leaking the open
  // handles into a SIGKILL escalation.
  // `writeSync(2, ...)` (FD-level, syscall-synchronous) for the same
  // reason as the STARTUP stamp at the top of this file.
  process.on('SIGTERM', () => {
    writeSync(
      2,
      `[realm-server] SIGTERM received pid=${process.pid} ppid=${process.ppid}\n`,
    );
    stopRealmServer(false);
  });
  process.on('SIGINT', () => {
    writeSync(
      2,
      `[realm-server] SIGINT received pid=${process.pid} ppid=${process.ppid}\n`,
    );
    stopRealmServer(false);
  });
  process.on('message', (message) => {
    if (message === 'stop') {
      stopRealmServer(true);
    } else if (message === 'kill') {
      console.log(`Ending server process...`);
      process.exit(0);
    } else if (
      typeof message === 'string' &&
      message.startsWith('registration-secret:') &&
      registrationSecretDeferred
    ) {
      registrationSecretDeferred.fulfill(
        message.substring('registration-secret:'.length),
      );
    } else if (
      typeof message === 'string' &&
      message.startsWith('execute-sql:')
    ) {
      let sql = message.substring('execute-sql:'.length);
      dbAdapter
        .execute(sql)
        .then((results) => {
          if (process.send) {
            let serializedResults = JSON.stringify(results);
            process.send(`sql-results:${serializedResults}`);
          }
        })
        .catch((e) => {
          if (process.send) {
            process.send(`sql-error:${e.message}`);
          }
        });
    }
  });
  process.on('disconnect', () => {
    console.log(`realm server IPC disconnected, shutting down...`);
    stopRealmServer(false);
  });

  // Phase 3: server.start() awaits reconciler.reconcile() to do the
  // initial pinned mount (bootstrap realms — base, catalog) before the
  // HTTP listener accepts traffic. Non-pinned realms (source, published)
  // wait for first-request mount via reconciler.lookupOrMount().
  await server.start();

  // Begin the reconciler's background poll loop (LISTEN realm_registry +
  // 30s safety poll). It picks up changes from peer instances (publish,
  // unpublish, delete) and reconciles them into local mounted state.
  await reconciler.start();

  // Cross-instance cache invalidation. Realm.write() emits NOTIFY
  // realm_file_changes; this listener receives those and forwards to the
  // local Realm's invalidateCache(path). Under single-instance the writer
  // has already invalidated its own caches synchronously, so self-echoes
  // are idempotent no-ops. Lookups go through the same `realms` array the
  // reconciler maintains via mountFromRow / unmount.
  fileChangesListener = new RealmFileChangesListener({
    dbAdapter,
    lookupMountedRealm: (url) => realms.find((r) => r.url === url),
  });
  await fileChangesListener.start();

  // CS-11119: cross-instance #inFlightSearch invalidation. Sibling of
  // fileChangesListener — same lookup function, different channel. Fires
  // at INDEX-UPDATE time (peer's worker batch.done committed boxel_index)
  // rather than write time, so post-update callers on this replica don't
  // coalesce into pre-update pending promises.
  indexUpdatedListener = new RealmIndexUpdatedListener({
    dbAdapter,
    lookupMountedRealm: (url) => realms.find((r) => r.url === url),
  });
  await indexUpdatedListener.start();

  // CS-11179: NOTIFY-driven eviction for the in-memory JobScopedSearchCache.
  // On `jobs_finished` it drops the finished job's cache entries immediately
  // instead of waiting for their TTL. Shares the same searchCache instance the
  // request handlers populate (passed into RealmServer above).
  jobsFinishedListener = new JobsFinishedListener({
    dbAdapter,
    searchCache,
  });
  await jobsFinishedListener.start();

  // Cross-instance module-cache invalidation (CS-10952). When a peer
  // realm-server emits NOTIFY module_cache_invalidated, replay the bump on
  // this instance's CachingDefinitionLookup so its in-flight prerenders
  // observe the invalidation at persist time and discard stale results.
  // Self-notify is harmless — the emitter already bumped synchronously
  // before the DELETE; a second bump from the listener loop is idempotent.
  moduleCacheInvalidationListener = new ModuleCacheInvalidationListener({
    dbAdapter,
    definitionLookup,
  });
  await moduleCacheInvalidationListener.start();

  let actualPort =
    (httpServer.address() as import('net').AddressInfo | null)?.port ?? port;
  log.info(`Realm server listening on port ${actualPort} is serving realms:`);
  // Phase 3: realms[] is populated by the reconciler in realm_registry
  // row order, not in CLI --path order, so hrefs[index] / paths[index]
  // no longer correspond. Log just the realm URLs; URL mappings are
  // logged separately below.
  for (let { url } of realms) {
    log.info(`    ${url}`);
  }
  if (hrefs.length) {
    log.info('CLI URL mappings:');
    for (let [from, to] of hrefs) {
      log.info(`    ${from} => ${to}`);
    }
  }
  log.info(`Using host url: '${distURL}' for card pre-rendering`);

  if (process.send) {
    process.send('ready');
  }
})().catch((e: any) => {
  Sentry.captureException(e);
  console.error(
    `Unexpected error encountered starting realm, stopping server`,
    e,
  );
  process.exit(-3);
});

async function waitForWorkerManager(url: string) {
  let isReady = false;
  let timeoutMs = isEnvironmentMode() ? 120_000 : 30_000;
  let timeout = Date.now() + timeoutMs;
  let normalizedUrl = url.replace(/\/$/, '') + '/';
  do {
    try {
      let response = await fetch(normalizedUrl);
      if (response.ok) {
        let json = await response.json();
        isReady = json.ready;
      }
    } catch (error) {
      // Worker manager hasn't started yet, continue retrying
    }
    if (!isReady) {
      // Add a small delay between retries to avoid hammering the server
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } while (!isReady && Date.now() < timeout);
  if (!isReady) {
    throw new Error(
      `timed out waiting for worker manager to be ready at ${url}`,
    );
  }
  log.info('workers are ready');
}
