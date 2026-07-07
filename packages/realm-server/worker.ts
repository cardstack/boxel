import './instrument.ts';
import './setup-logger.ts'; // This should be first
import './lib/wtfnode-on-signal.ts';
import { writeSync } from 'node:fs';

// Swallow EPIPE from stdout/stderr so a torn-down parent (worker manager
// SIGKILL'd or its dev-log-tee dead during dev-all Ctrl-C) doesn't make
// every subsequent `log.info` an uncaughtException. See the matching
// comment in worker-manager.ts (CS-11084).
const swallowEpipe = (err: NodeJS.ErrnoException) => {
  if (err?.code !== 'EPIPE') {
    throw err;
  }
};
process.stdout.on('error', swallowEpipe);
process.stderr.on('error', swallowEpipe);

// FD-level synchronous stderr write — `writeSync(2, ...)` calls the
// write(2) syscall directly, bypassing Node's stream layer.
// `process.stderr.write` is libuv-async when stderr is a pipe (the
// Docker / ECS case), so it can be lost if the process exits before
// libuv flushes. Stamps that fire just before death need to use the
// FD-level form. Proof the Node process actually started, at what
// pid/ppid, independent of the logger pipeline.
writeSync(
  2,
  `[worker] STARTUP pid=${process.pid} ppid=${process.ppid} argv=${JSON.stringify(process.argv)}\n`,
);

import {
  Worker,
  VirtualNetwork,
  isUrlLike,
  logger,
  IndexWriter,
  type StatusArgs,
  type IndexingProgressEvent,
} from '@cardstack/runtime-common';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';
import yargs from 'yargs';
import * as Sentry from '@sentry/node';
import {
  PgAdapter,
  PgQueuePublisher,
  PgQueueRunner,
} from '@cardstack/postgres';
import { createRemotePrerenderer } from './prerender/remote-prerenderer.ts';
import { buildCreatePrerenderAuth } from './prerender/auth.ts';
import { finalizeChildReservationAsFailure } from './lib/finalize-child-fatal-failure.ts';

let log = logger('worker');

const REALM_SECRET_SEED = process.env.REALM_SECRET_SEED;
if (!REALM_SECRET_SEED) {
  log.error(
    `The REALM_SECRET_SEED environment variable is not set. Please make sure this env var has a value`,
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

// This is an ENV var we get from ECS that looks like:
// http://169.254.170.2/v3/a1de500d004f49bea02ace30cefb0f01-3236013547 where the
// last segment is the "container runtime ID", where the value on the left of
// the '-' is the task ID.
const ECS_CONTAINER_METADATA_URI = process.env.ECS_CONTAINER_METADATA_URI;
let workerId = ECS_CONTAINER_METADATA_URI
  ? `${ECS_CONTAINER_METADATA_URI.split('/').pop()!}-pid-${process.pid}`
  : `worker-pid-${process.pid}`;

let {
  matrixURL,
  fromUrl: fromUrls,
  toUrl: toUrls,
  priority = 0,
  migrateDB,
  prerendererUrl,
} = yargs(process.argv.slice(2))
  .usage('Start worker')
  .options({
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
    migrateDB: {
      description:
        'When this flag is set the database will automatically migrate when server is started',
      type: 'boolean',
    },
    matrixURL: {
      description: 'The matrix homeserver for the realm server',
      demandOption: true,
      type: 'string',
    },
    priority: {
      description:
        'The minimum priority of jobs that the worker should process (defaults to 0)',
      type: 'number',
    },
    prerendererUrl: {
      description: 'URL of the prerender server to invoke',
      demandOption: true,
      type: 'string',
    },
  })
  .parseSync();

log.info(`starting worker with pid ${process.pid} and priority ${priority}`);

let prerenderer = createRemotePrerenderer(prerendererUrl);
let createPrerenderAuth = buildCreatePrerenderAuth(REALM_SECRET_SEED);
if (fromUrls.length !== toUrls.length) {
  log.error(
    `Mismatched number of URLs, the --fromUrl params must be matched to the --toUrl params`,
  );
  process.exit(-1);
}

let virtualNetwork = new VirtualNetwork();
for (let i = 0; i < fromUrls.length; i++) {
  let from = String(fromUrls[i]);
  let to = new URL(String(toUrls[i]));
  if (isUrlLike(from)) {
    virtualNetwork.addURLMapping(new URL(from), to);
    // Convention: https://cardstack.com/X/ aliases @cardstack/X/. Also
    // register the realm-prefix mapping so unresolveURL on either form
    // produces the same canonical RRI — same reasoning as main.ts.
    let m = from.match(/^https:\/\/cardstack\.com\/([^/]+)\/$/);
    if (m) {
      virtualNetwork.addRealmMapping(`@cardstack/${m[1]}/`, to.href);
    }
  } else {
    virtualNetwork.addRealmMapping(from, to.href);
  }
}
let autoMigrate = migrateDB || undefined;

(async () => {
  function reportStatus({ jobId, status, realm, url, deps }: StatusArgs) {
    if (process.send) {
      process.send(
        `status|${JSON.stringify({ jobId, status, realm, url, deps })}`,
      );
    }
  }

  function reportProgress(event: IndexingProgressEvent) {
    // Emit on every worker, including ECS — the manager's
    // IndexingEventSink turns these into `[indexing-progress]` log lines
    // and `job_progress` row writes that feed the cluster-wide Boxel Jobs
    // dashboard (CS-10930). Local-only HTML endpoints stay gated in
    // worker-manager.ts.
    if (process.send) {
      process.send(`progress|${JSON.stringify(event)}`);
    }
  }

  // A worker child holds no matrix client, so it can't broadcast a realm
  // event itself. It hands the event to the worker manager over the IPC
  // channel; the manager forwards it to the realm server, which broadcasts it
  // through the realm's matrix session rooms. The task requests the event via
  // the `reportRealmEvent` callback in TaskArgs without knowing this transport.
  function reportRealmEvent(event: RealmEventContent) {
    if (process.send) {
      process.send(`realm-event|${JSON.stringify(event)}`);
    }
  }

  let dbAdapter = new PgAdapter({ autoMigrate });
  let queue = new PgQueueRunner({ adapter: dbAdapter, workerId, priority });
  let worker = new Worker({
    indexWriter: new IndexWriter(dbAdapter),
    queue,
    virtualNetwork,
    matrixURL: new URL(matrixURL),
    secretSeed: REALM_SECRET_SEED,
    reportStatus,
    reportProgress,
    reportRealmEvent,
    realmServerMatrixUsername: REALM_SERVER_MATRIX_USERNAME,
    dbAdapter,
    queuePublisher: new PgQueuePublisher(dbAdapter),
    prerenderer,
    createPrerenderAuth,
  });

  await worker.run();
  log.info(`worker started`);
  if (process.send) {
    process.send(`ready:${workerId}`);
  }

  // Handle graceful shutdown. Registered against four triggers
  // (SIGINT/SIGTERM, parent IPC disconnect, and a `'stop'` message from the
  // manager), so the manager's IPC `'stop'` and a bash-trap SIGTERM can
  // both fire on the same child during dev-all teardown. The guard makes
  // shutdown idempotent — without it, the second invocation would call
  // `pool.end()` a second time and pg-pool throws `Called end on pool
  // more than once` synchronously from `dbAdapter.close()`.
  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    log.info(`Shutting down worker ${workerId}...`);
    try {
      await queue.destroy();
      await dbAdapter.close();
      log.info(`Worker ${workerId} shut down gracefully`);
      process.exit(0);
    } catch (err) {
      log.error(`Error during worker shutdown:`, err);
      process.exit(1);
    }
  };
  // `writeSync(2, ...)` (FD-level, syscall-synchronous) for the same
  // reason as the STARTUP stamp at the top of this file.
  process.on('SIGINT', () => {
    writeSync(
      2,
      `[worker] SIGINT received pid=${process.pid} ppid=${process.ppid}\n`,
    );
    shutdown();
  });
  process.on('SIGTERM', () => {
    writeSync(
      2,
      `[worker] SIGTERM received pid=${process.pid} ppid=${process.ppid}\n`,
    );
    shutdown();
  });
  process.on('disconnect', () => {
    writeSync(
      2,
      `[worker] disconnect received pid=${process.pid} ppid=${process.ppid}\n`,
    );
    shutdown();
  });
  process.on('message', (message) => {
    if (message === 'stop') {
      shutdown(); // warning this is async
    }
  });

  // Fatal-error backstop. Without these handlers a child that hits an
  // unhandled promise rejection or uncaught exception exits silently,
  // and the parent's `worker.on('exit')` finalizes the in-flight
  // reservation as 'interrupted' — which the per-job reservation cap
  // explicitly excludes. The result is an infinite respawn loop on any
  // deterministic crash that doesn't surface through pg-queue's own
  // catch path.
  //
  // We log, capture, and best-effort mark our reservation as a real
  // failure ('completed'), then exit so the parent can spawn a
  // replacement. The 5-second cap on the finalize race prevents a
  // damaged DB connection from blocking exit indefinitely.
  let isFatalHandlerRunning = false;
  const fatalExit = (reason: unknown, source: string) => {
    if (isFatalHandlerRunning || isShuttingDown) {
      return;
    }
    isFatalHandlerRunning = true;
    log.error(`Fatal ${source} in worker child ${workerId}:`, reason as Error);
    try {
      Sentry.captureException(reason);
    } catch {
      // best-effort
    }
    (async () => {
      try {
        await Promise.race([
          finalizeChildReservationAsFailure(dbAdapter, workerId),
          new Promise<void>((r) => setTimeout(r, 5000).unref()),
        ]);
      } catch (e) {
        log.error(`Fatal handler finalize failed for ${workerId}:`, e);
      } finally {
        process.exit(1);
      }
    })();
  };
  process.on('unhandledRejection', (reason) => {
    fatalExit(reason, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    fatalExit(err, 'uncaughtException');
  });
})().catch((e: any) => {
  Sentry.captureException(e);
  log.error(
    `worker: Unexpected error encountered starting worker, stopping worker`,
    e,
  );
  process.exit(1);
});
