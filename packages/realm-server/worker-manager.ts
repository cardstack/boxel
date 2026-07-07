import './instrument.ts';
import './setup-logger.ts'; // This should be first
import './lib/wtfnode-on-signal.ts';
import { writeSync } from 'node:fs';

// During `mise dev-all` Ctrl-C, the bash trap walks the process tree
// deepest-first. The `dev-log-tee` reader on this process's stdout/stderr
// can die before this process gets SIGTERM, so any subsequent `log.info` /
// `console.error` write throws EPIPE. Without these listeners, EPIPE
// surfaces as an uncaughtException; the existing uncaughtException
// handler then calls `log.error`, which writes to the same dead stream
// and throws *again*. Node delivers the throw inside an uncaughtException
// handler as the next pending exception, so V8 hot-loops re-reporting it
// (uv__run_check → CheckImmediate → InspectorConsoleCall → Error.stack
// formatting) at ~100% CPU until the process is SIGKILLed —
// CS-11084. Swallowing EPIPE at the stream level breaks the loop and
// lets normal SIGTERM-driven shutdown finish.
const swallowEpipe = (err: NodeJS.ErrnoException) => {
  if (err?.code !== 'EPIPE') {
    throw err;
  }
};
process.stdout.on('error', swallowEpipe);
process.stderr.on('error', swallowEpipe);

// FD-level synchronous stderr write — `writeSync(2, ...)` calls the
// write(2) syscall directly, bypassing Node's stream layer. We do that
// (instead of `process.stderr.write`) because the stream-layer write is
// libuv-async when stderr is a pipe (the normal Docker / ECS case), so
// it can be lost if the process exits before libuv flushes. The whole
// point of these stamps is to land *just before* the process dies, so
// async loss would defeat them.
//
// Proof the Node process actually started, at what pid/ppid, independent
// of the logger pipeline. If we see STARTUP but never SIGTERM received,
// signal delivery is broken upstream of Node.
writeSync(
  2,
  `[worker-manager] STARTUP pid=${process.pid} ppid=${process.ppid} argv=${JSON.stringify(process.argv)}\n`,
);

import {
  logger,
  userInitiatedPrerenderHtmlPriority,
  systemInitiatedPrerenderHtmlPriority,
  query as _query,
  param,
  separatedByCommas,
  IndexWriter,
  isUrlLike,
  VirtualNetwork,
  type Expression,
  type StatusArgs,
  type IndexingProgressEvent,
} from '@cardstack/runtime-common';
import yargs from 'yargs';
import * as Sentry from '@sentry/node';
import { flattenDeep } from 'lodash-es';
import { spawn, type ChildProcess } from 'child_process';
import pluralize from 'pluralize';
import Koa from 'koa';
import Router from '@koa/router';
import {
  ecsMetadata,
  fullRequestURL,
  livenessCheck,
} from './middleware/index.ts';
import type { Server } from 'http';
import { PgAdapter } from '@cardstack/postgres';
import { startCronJobs, stopCronJobs } from './lib/cron-scheduler.ts';
import {
  isEnvironmentMode,
  registerService,
  deregisterService,
} from './lib/dev-service-registry.ts';
import { IndexingEventSink } from './indexing-event-sink.ts';
import {
  renderIndexingDashboard,
  type PendingJob,
} from './handlers/handle-indexing-dashboard.ts';
import { writeRuntimeMetadataFile } from './lib/runtime-metadata-file.ts';
import { finalizeOrphanedReservations } from './lib/finalize-orphan-reservations.ts';
import { dispatchWorkerRequest } from './lib/worker-request-forwarder.ts';
import type { WorkerRequestBody } from '@cardstack/runtime-common/worker-request';

/* About the Worker Manager
 *
 * This process runs on each queue worker container and is responsible starting and monitoring the worker processes. It does this via IPC (inter-process communication).
 * In test and development environments, the worker manager is also responsible for providing a readiness check HTTP endpoint so that tests can wait until the worker
 * manager is ready before proceeding.
 */

let log = logger('worker-manager');
const runtimeMetadataFile =
  process.env.TEST_HARNESS_WORKER_MANAGER_METADATA_FILE;

function writeRuntimeMetadata(payload: unknown): void {
  writeRuntimeMetadataFile(runtimeMetadataFile, 'worker-manager', payload);
}

const WORKER_START_TIMEOUT_MS = (() => {
  let parsed = Number.parseInt(
    process.env.TEST_HARNESS_WORKER_START_TIMEOUT_MS ?? '',
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
})();

// This is an ENV var we get from ECS that looks like:
// http://169.254.170.2/v3/a1de500d004f49bea02ace30cefb0f01-3236013547 where the
// last segment is the "container runtime ID", where the value on the left of
// the '-' is the task ID.
const ECS_CONTAINER_METADATA_URI = process.env.ECS_CONTAINER_METADATA_URI;

const REALM_SECRET_SEED = process.env.REALM_SECRET_SEED;
if (!REALM_SECRET_SEED) {
  log.error(
    `The REALM_SECRET_SEED environment variable is not set. Please make sure this env var has a value`,
  );
  process.exit(-1);
}

let {
  port,
  matrixURL,
  allPriorityCount = 1,
  highPriorityCount = 0,
  fromUrl: fromUrls,
  toUrl: toUrls,
  migrateDB,
  prerendererUrl,
  serviceName = 'worker',
} = yargs(process.argv.slice(2))
  .usage('Start worker manager')
  .options({
    port: {
      description:
        'HTTP port for worker manager to communicate readiness and status',
      type: 'number',
    },
    highPriorityCount: {
      description:
        'The number of workers that service user-initiated jobs, including user-initiated prerender-html, and nothing below that tier (default 0)',
      type: 'number',
    },
    allPriorityCount: {
      description:
        'The number of workers that service all jobs regardless of priority to start (default 1)',
      type: 'number',
    },
    migrateDB: {
      description:
        'When this flag is set the database will automatically migrate when server is started',
      type: 'boolean',
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
    matrixURL: {
      description: 'The matrix homeserver for the realm server',
      demandOption: true,
      type: 'string',
    },
    prerendererUrl: {
      demandOption: true,
      description: 'URL of the prerender server to invoke',
      type: 'string',
    },
    serviceName: {
      description:
        'Traefik service name for registration in branch mode (default: worker)',
      type: 'string',
    },
  })
  .parseSync();

let isReady = false;
let isExiting = false;
let workers: ChildProcess[] = [];
function isIndexingDashboardEnabled(): boolean {
  return !ECS_CONTAINER_METADATA_URI;
}

// Always create the sink — its in-memory state is small, and the
// `[indexing-progress]` log lines + `job_progress` write-through it
// emits are how the cluster-wide Boxel Jobs dashboard aggregates
// progress in staging/prod (CS-10930). The local-only HTML
// `/_indexing-dashboard` routes are still gated below.
//
// BOXEL_INDEXING_PROGRESS_LOG_EVERY (default 1) samples the per-file
// log line emission so operators can dial back Loki ingest cost during
// heavy indexing without dropping started/finished events.
let fileVisitedLogEvery = parseInt(
  process.env.BOXEL_INDEXING_PROGRESS_LOG_EVERY ?? '1',
  10,
);
if (!Number.isFinite(fileVisitedLogEvery) || fileVisitedLogEvery < 1) {
  fileVisitedLogEvery = 1;
}
let eventSink = new IndexingEventSink({ fileVisitedLogEvery });

let webServerInstance: Server | undefined;
let autoMigrate = migrateDB || undefined;

if (port != null) {
  let webServer = new Koa<Koa.DefaultState, Koa.Context>();
  let router = new Router();
  router.head('/', livenessCheck);
  router.get('/', async (ctxt: Koa.Context, _next: Koa.Next) => {
    let result = {
      ready: isReady,
    } as Record<string, boolean | number>;
    if (isReady) {
      result = {
        ...result,
        highPriorityWorkers: highPriorityCount,
        allPriorityWorkers: allPriorityCount,
      };
    }
    ctxt.set('Content-Type', 'application/json');
    ctxt.body = JSON.stringify(result);
    ctxt.status = isReady ? 200 : 503;
  });
  if (isIndexingDashboardEnabled()) {
    let getPendingJobs = async (): Promise<PendingJob[]> => {
      let rows = (await query([
        `SELECT j.id, j.job_type, j.args, j.priority, EXTRACT(EPOCH FROM j.created_at) * 1000 AS created_at_ms`,
        `FROM jobs j`,
        `WHERE j.status = 'unfulfilled'`,
        `AND j.job_type IN ('from-scratch-index', 'incremental-index')`,
        `AND NOT EXISTS (`,
        `  SELECT 1 FROM job_reservations jr`,
        `  WHERE jr.job_id = j.id AND jr.completed_at IS NULL`,
        `)`,
        `ORDER BY j.created_at ASC`,
      ])) as {
        id: string;
        job_type: string;
        args: { realmURL?: string };
        priority: number;
        created_at_ms: string;
      }[];
      return rows.map((r) => ({
        jobId: Number(r.id),
        jobType: r.job_type,
        realmURL: r.args?.realmURL ?? 'unknown',
        priority: r.priority,
        createdAt: Number(r.created_at_ms),
      }));
    };

    router.get('/_indexing-dashboard', async (ctxt: Koa.Context) => {
      ctxt.set('Content-Type', 'text/html; charset=utf-8');
      let pending = await getPendingJobs();
      ctxt.body = renderIndexingDashboard({
        ...eventSink.getSnapshot(),
        pending,
      });
      ctxt.status = 200;
    });
    router.get('/_indexing-status', async (ctxt: Koa.Context) => {
      ctxt.set('Content-Type', 'application/json');
      let pending = await getPendingJobs();
      ctxt.body = JSON.stringify({
        ...eventSink.getSnapshot(),
        pending,
      });
      ctxt.status = 200;
    });
  }

  webServer
    .use(router.routes())
    .use((ctxt: Koa.Context, next: Koa.Next) => {
      log.info(
        `<-- ${ctxt.method} ${ctxt.req.headers.accept} ${
          fullRequestURL(ctxt).href
        }`,
      );

      ctxt.res.on('finish', () => {
        log.info(
          `--> ${ctxt.method} ${ctxt.req.headers.accept} ${
            fullRequestURL(ctxt).href
          }: ${ctxt.status}`,
        );
        log.debug(JSON.stringify(ctxt.req.headers));
      });
      return next();
    })
    .use(ecsMetadata);

  webServer.on('error', (err: any) => {
    log.error(`worker manager HTTP server error: ${err.message}`);
  });

  webServerInstance = webServer.listen(port);
  webServerInstance.on('listening', () => {
    let actualPort =
      (webServerInstance!.address() as import('net').AddressInfo).port ?? port;
    writeRuntimeMetadata({
      pid: process.pid,
      port: actualPort,
      url: `http://127.0.0.1:${actualPort}`,
    });
    if (isEnvironmentMode()) {
      registerService(webServerInstance!, serviceName);
    }
    log.info(`worker manager HTTP listening on port ${actualPort}`);
  });
}

// Grace window for children to exit cleanly after they receive 'stop'.
// A worker that exits inside this window finalizes its own reservation
// via pg-queue's success path (completion_reason='completed', counts
// toward the cap — that's the correct accounting for a worker that had
// time to verdict). Anyone still alive after the window is force-killed
// in the next phase so its handler can't keep running while we free the
// reservation; otherwise a sibling ECS task would observe a freed
// reservation and re-claim the same job, executing it concurrently with
// the still-running original.
const STOP_GRACE_MS = 10_000;

// Per-worker cap on the awaited drain UPDATE. Drain runs in parallel,
// so this is the worst case per worker, not a sum. Sized to fit
// comfortably inside the ECS `stopTimeout` (60s recommended) alongside
// STOP_GRACE_MS and webserver close.
const DRAIN_PER_WORKER_TIMEOUT_MS = 10_000;

let isShuttingDown = false;
// Queue of cleanup callbacks accumulated across (re-)entrant shutdown
// calls. Without this, the second caller's callback would be silently
// dropped by the idempotent guard — which matters for the IPC 'stop'
// path that uses its callback to send a 'stopped' ack to its parent.
let shutdownCallbacks: Array<() => void> = [];

const shutdown = (onShutdown?: () => void) => {
  if (onShutdown) {
    shutdownCallbacks.push(onShutdown);
  }
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  // Disable replacement-respawn for every shutdown trigger, not just
  // SIGINT/SIGTERM. The IPC `'stop'` and `disconnect` paths used to
  // leave `isExiting` false, so a child exit during shutdown would
  // still spawn a fresh worker — which would then miss the drain
  // snapshot and could re-claim the very job we just freed.
  isExiting = true;
  runShutdown().catch((e) => {
    Sentry.captureException(e);
    log.error(`worker: shutdown threw, forcing exit`, e);
    runShutdownCallbacks();
    process.exit(1);
  });
};

async function runShutdown() {
  log.info(`Shutting down server for worker manager...`);
  if (isEnvironmentMode()) {
    deregisterService(serviceName);
  }

  stopCronJobs();

  // Snapshot the live workers BEFORE the worker.on('exit') handlers
  // start splicing them out of the global array as they exit. The drain
  // in Phase 4 wants the original set, including ones that finished
  // cleanly during Phase 2.
  let snapshot = [...workers];

  // Phase 1 — tell children to stop. Each child's pg-queue marks
  // shuttingDown and exits its WorkLoop after the in-flight handler
  // returns. We gate on `exitCode === null` (truly still alive) rather
  // than `!killed`, because `ChildProcess.killed` only records that a
  // signal was *sent* — a worker the watchdog sent SIGTERM to a
  // moment ago has `killed === true` but may still be running.
  // `subprocess.send` can also throw if the IPC channel has already
  // closed (child died between our liveness check and the send) —
  // swallow per-worker so one dead child can't abort the rest.
  if (snapshot.length > 0) {
    log.info(`Stopping ${snapshot.length} worker(s)...`);
    snapshot.forEach((worker) => {
      if (
        worker.exitCode === null &&
        worker.signalCode === null &&
        worker.pid
      ) {
        try {
          worker.send?.('stop');
        } catch (e) {
          log.warn(
            `worker.send('stop') threw for worker ${(worker as any).__workerId ?? worker.pid}:`,
            e,
          );
        }
      }
    });
  }

  // Phase 2 — brief grace window for clean exits. A child that exits
  // inside this window has already committed its reservation as
  // 'completed' via the normal pg-queue success path; the drain in
  // Phase 4 will be a no-op for those (UPDATE WHERE completed_at IS
  // NULL matches no rows).
  if (snapshot.length > 0) {
    await Promise.race([
      Promise.all(snapshot.map(waitForExit)),
      new Promise<void>((r) => setTimeout(r, STOP_GRACE_MS).unref()),
    ]);
  }

  // Phase 3 — stragglers. Any worker still alive is stuck in a
  // long-running handler (e.g. mid-from-scratch-index, ~22 min p50).
  // Force-kill so its handler cannot keep running while we free its
  // reservation in Phase 4. Without this, a sibling ECS task would
  // observe the freed reservation and start the same job again,
  // executing it concurrently with the still-running original — the
  // duplicate-execution race the codex review flagged on review.
  //
  // Liveness is `exitCode === null && signalCode === null`, not
  // `!killed`: a worker the watchdog already sent SIGTERM to has
  // `killed === true` but may still be running, and we want SIGKILL
  // to force-terminate it. After a child actually exits via signal,
  // its exitCode stays null but signalCode becomes set — both must
  // be null for "truly still alive". SIGKILL is idempotent on a
  // process that's gone, and the try/catch below covers any EPERM.
  let stragglers = snapshot.filter(
    (worker) => worker.exitCode === null && worker.signalCode === null,
  );
  if (stragglers.length > 0) {
    log.info(
      `Force-killing ${stragglers.length} unresponsive worker(s) before draining reservations`,
    );
    for (let worker of stragglers) {
      try {
        worker.kill('SIGKILL');
      } catch {
        // Worker may already be dying; not actionable.
      }
    }
    // Brief pause so the OS can deliver SIGKILL before we open the
    // reservation row up for re-claim. Tightens (not gates) the window
    // during which a sibling task could observe a still-locked
    // reservation; the row-level lock from Phase 4's UPDATE serializes
    // against any in-flight write either way.
    await new Promise<void>((r) => setTimeout(r, 250).unref());
  }

  // Phase 4 — drain. Awaited so the UPDATE flushes before process.exit.
  // The UPDATE filters by `completed_at IS NULL`, so it's a no-op for
  // reservations that pg-queue's commit path already closed during
  // Phase 2. For the rest it marks 'interrupted', which keeps the row
  // off the per-job reservation cap so a deploy never burns an attempt
  // on an otherwise-healthy job.
  if (adapter && snapshot.length > 0) {
    log.info(`Draining reservations for ${snapshot.length} worker(s)...`);
    await Promise.allSettled(snapshot.map(drainOneWorker));
  }

  // No workers are alive at this point — stop the indexing-progress
  // write-through timer before the adapter is closed by the caller's
  // shutdown callback (otherwise an in-flight flush could hit a
  // closed connection).
  eventSink.dispose();

  // Phase 5 — close the readiness web server (if it was started) and
  // exit. The web server is only created when --port is passed; in
  // staging/prod the manager runs without --port and webServerInstance
  // stays undefined. Without an explicit fallback, the close-callback
  // exit path never fires and the process lingers until ECS SIGKILLs
  // it on stopTimeout. Run callbacks + exit unconditionally below.
  let exitCode = 0;
  if (webServerInstance) {
    webServerInstance.closeAllConnections();
    await new Promise<void>((resolve) => {
      webServerInstance!.close((err?: Error) => {
        if (err) {
          log.error(
            `Error while closing the server for worker manager HTTP:`,
            err,
          );
          exitCode = 1;
        } else {
          log.info(`worker manager HTTP on port ${port} has stopped.`);
        }
        resolve();
      });
    });
  }
  runShutdownCallbacks();
  process.exit(exitCode);
}

function waitForExit(worker: ChildProcess): Promise<void> {
  // Resolve immediately only when the process has truly exited
  // (exitCode is non-null on natural exit, or signalCode is non-null
  // when killed by signal). `worker.killed` would short-circuit too
  // eagerly — it just means a signal was sent, not that the child
  // has actually terminated.
  if (worker.exitCode !== null || worker.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    worker.once('exit', () => resolve());
  });
}

async function drainOneWorker(worker: ChildProcess): Promise<void> {
  let workerId = (worker as any).__workerId as string | undefined;
  if (!workerId) {
    // Worker hadn't reported a `ready:<id>` yet, so it can't have a
    // reservation row in the DB — nothing to drain.
    return;
  }
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  let timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      log.error(
        `worker: drain finalize for worker ${workerId} timed out after ${DRAIN_PER_WORKER_TIMEOUT_MS}ms; reservation will fall back to lease expiry`,
      );
      resolve();
    }, DRAIN_PER_WORKER_TIMEOUT_MS);
    timer.unref();
  });
  try {
    await Promise.race([
      finalizeOrphanedReservations(adapter, workerId, 'interrupted'),
      timeout,
    ]);
  } finally {
    // Clear the timer when finalize wins the race so the timeout
    // callback can't fire later and log a spurious "timed out" message
    // even though the drain completed successfully.
    if (timer && !timedOut) {
      clearTimeout(timer);
    }
  }
}

function runShutdownCallbacks() {
  // Drain the queue (callbacks may be appended by re-entrant shutdown
  // calls during the async run; we want to fire those too).
  while (shutdownCallbacks.length > 0) {
    let cb = shutdownCallbacks.shift()!;
    try {
      cb();
    } catch (e) {
      log.error(`worker: shutdown callback threw`, e);
    }
  }
}

// `writeSync(2, ...)` (FD-level, syscall-synchronous) for the same
// reason as the STARTUP stamp above — `process.stderr.write` is
// libuv-async to a pipe, and these stamps fire on the exact paths where
// the process is about to die, so an async write can get lost.
process.on('SIGINT', () => {
  writeSync(
    2,
    `[worker-manager] SIGINT received pid=${process.pid} ppid=${process.ppid}\n`,
  );
  shutdown();
});
process.on('SIGTERM', () => {
  writeSync(
    2,
    `[worker-manager] SIGTERM received pid=${process.pid} ppid=${process.ppid}\n`,
  );
  shutdown();
});
process.on('disconnect', () => {
  writeSync(
    2,
    `[worker-manager] disconnect received pid=${process.pid} ppid=${process.ppid}\n`,
  );
  log.info(`Parent IPC disconnected, shutting down worker manager...`);
  shutdown();
});
process.on('uncaughtException', (err) => {
  writeSync(
    2,
    `[worker-manager] uncaughtException pid=${process.pid} ppid=${process.ppid}\n`,
  );
  log.error(`Uncaught exception in worker manager:`, err);
  shutdown();
});

process.on('message', (message) => {
  if (message === 'stop') {
    // Close the adapter *after* the drain UPDATE inside shutdown
    // commits; the drain needs a healthy adapter to mark in-flight
    // reservations 'interrupted' so the next worker can re-claim
    // immediately. The shutdown callback queue makes this work even
    // if a signal had already initiated shutdown — the ack still
    // fires when shutdown finishes.
    shutdown(() => {
      if (adapter) {
        adapter.close(); // warning this is async
      }
      process.send?.('stopped');
    });
  } else if (message === 'kill') {
    log.info(`Ending worker manager process for ${port}...`);
    process.exit(0);
  } else if (
    typeof message === 'string' &&
    message.startsWith('execute-sql:')
  ) {
    let sql = message.substring('execute-sql:'.length);
    adapter
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

let adapter: PgAdapter;

(async () => {
  log.info(
    `starting ${highPriorityCount} high-priority ${pluralize(
      'worker',
      highPriorityCount,
    )} and ${allPriorityCount} all-priority ${pluralize(
      'worker',
      allPriorityCount,
    )}`,
  );
  let urlMappings = fromUrls.map((fromUrl, i) => {
    let from = String(fromUrl);
    let to = new URL(String(toUrls[i]));
    return [isUrlLike(from) ? new URL(from) : from, to] as [URL | string, URL];
  });
  adapter = new PgAdapter({ autoMigrate });
  // Wire the indexing-progress write-through. The sink was constructed
  // at module load (above) so that log lines and event handling work
  // before this point; the periodic flush only starts once an adapter
  // is set.
  eventSink.setAdapter(adapter);

  // Each pool's minimum priority is a dequeue floor: its workers only
  // claim jobs at or above it. The high-priority pool floors at the
  // user-initiated prerender-html tier so it serves all user-initiated
  // work — prerender-html included — and never system-tier jobs; the
  // all-priority pool floors at the lowest tier and serves everything.
  for (let i = 0; i < highPriorityCount; i++) {
    await startWorker(userInitiatedPrerenderHtmlPriority, urlMappings);
  }
  for (let i = 0; i < allPriorityCount; i++) {
    await startWorker(systemInitiatedPrerenderHtmlPriority, urlMappings);
  }
  isReady = true;
  log.info('All workers have been started');
  startCronJobs();
})().catch((e: any) => {
  Sentry.captureException(e);
  log.error(
    `worker: Unexpected error encountered starting worker manager, stopping worker manager`,
    e,
  );
  process.exit(1);
});

async function monitorWorker(workerId: string, worker: ChildProcess) {
  let stuckJobs = (await query([
    `SELECT id, job_id FROM job_reservations jr WHERE worker_id=`,
    param(workerId),
    `AND completed_at IS NULL AND locked_until < NOW() - INTERVAL '30 seconds'`,
    `AND NOT EXISTS (`,
    // Skip stale reservations if this worker has already retried the job with a newer reservation.
    `  SELECT 1 FROM job_reservations newer WHERE`,
    `    newer.worker_id = jr.worker_id AND`,
    `    newer.job_id = jr.job_id AND`,
    `    newer.id > jr.id`,
    `)`,
  ])) as { id: string; job_id: string }[];

  if (stuckJobs.length > 0) {
    Sentry.captureMessage(
      `Detected stuck jobs for worker ${workerId}. job id(s): ${stuckJobs.map((j) => j.job_id).join()}. recycling worker`,
    );
    log.error(`detected stuck jobs for worker ${workerId}`);
    for (let { id, job_id: jobId } of stuckJobs) {
      log.info(`marking job ${jobId} as timed-out for worker ${workerId}`);
      let currentState =
        ((worker as any).__boxelIndexState as IndexState | undefined) ?? {};
      let { url, realm, deps } = currentState;
      if (url && realm && deps) {
        await markFailedIndexEntry({
          url,
          realm,
          deps,
          message: `worker time-out encountered while indexing ${url}`,
        });
      }
      await markFailedJob({
        reservationId: id,
        workerId,
        jobId,
        message: `Timed-out. Worker manager killed unresponsive worker ${workerId} for job reservation ${id}`,
      });
    }
    log.info(`killing worker ${workerId} due to stuck jobs`);
    worker.kill();
  }
}

async function markFailedIndexEntry({
  url,
  realm,
  message,
  deps,
}: {
  url: string;
  realm: string;
  message: string;
  deps?: string[];
}) {
  log.info(`marking index entry ${url} with an error doc`);
  let indexWriter = new IndexWriter(adapter);
  // The worker-manager doesn't run inside any particular realm context, so
  // it can't see the per-realm prefix mappings. An empty VirtualNetwork is
  // sufficient here because `invalidate` consumes already-URL-form inputs
  // and unresolveURL falls through to the original URL when no realm
  // mapping matches.
  let batch = await indexWriter.createBatch(
    new URL(realm),
    new VirtualNetwork(),
  );
  await batch.invalidate([new URL(url)]);
  let invalidations = batch.invalidations;
  for (let file of [url, ...invalidations]) {
    let entryType: 'instance-error' | 'file-error' = file.endsWith('.json')
      ? 'instance-error'
      : 'file-error';
    await batch.updateEntry(new URL(file), {
      type: entryType,
      error: {
        message,
        status: 500,
        additionalErrors: null,
        deps: file === url ? deps : [url],
      },
    });
  }
  await batch.done();
}

async function markFailedJob({
  workerId,
  jobId,
  reservationId,
  message,
}: {
  workerId: string | undefined;
  jobId: string;
  message: string;
  reservationId?: string;
}) {
  log.info(`marking job ${jobId} as failed for worker ${workerId}`);
  let id: string;
  if (!reservationId) {
    [{ id }] = (await query([
      `SELECT id FROM job_reservations WHERE job_id=`,
      param(jobId),
      `AND completed_at IS NULL`,
    ])) as { id: string }[];
    if (!id) {
      log.error(
        `Cannot determine job_reservation id for failed job ${jobId} of worker ${workerId}`,
      );
      return;
    }
  } else {
    id = reservationId;
  }

  await query([
    `UPDATE jobs SET `,
    ...separatedByCommas([
      [
        `result =`,
        param({
          status: 500,
          message: `Worker manager detected fatal error in worker ${workerId} for job ${jobId} with job_reservation id ${id}: ${message}`,
        }),
      ],
      [`status = 'rejected'`],
      [`finished_at = NOW()`],
    ]),
    'WHERE id =',
    param(jobId),
  ] as Expression);
  // The worker had uninterrupted access to the job and produced no
  // verdict before being killed by the watchdog (stuck) or after a fatal
  // error log line. That counts as a real attempt for cap purposes,
  // unlike the SIGTERM/child-crash paths which mark 'interrupted'.
  await query([
    `UPDATE job_reservations
     SET completed_at = NOW(), completion_reason = 'completed'
     WHERE id =`,
    param(id),
  ]);
  await query([`NOTIFY jobs_finished`]);
}

async function startWorker(
  priority: number,
  urlMappings: [URL | string, URL][],
) {
  let worker = spawn(
    'node',
    [
      'worker.ts',
      `--matrixURL='${matrixURL}'`,
      `--prerendererUrl=${prerendererUrl}`,
      `--priority=${priority}`,
      ...flattenDeep(
        urlMappings.map(([from, to]) => [
          `--fromUrl='${from instanceof URL ? from.href : from}'`,
          `--toUrl='${to.href}'`,
        ]),
      ),
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    },
  );
  let name = String(
    (ECS_CONTAINER_METADATA_URI
      ? `${ECS_CONTAINER_METADATA_URI.split('/').pop()!}-pid-${worker.pid}`
      : worker.pid)!,
  );

  let watchdog: NodeJS.Timeout;
  let workerId: string | undefined;
  let currentState: IndexState | undefined;

  workers.push(worker);

  worker.on('exit', (code, signal) => {
    clearInterval(watchdog);
    // Remove from workers array
    const index = workers.indexOf(worker);
    if (index > -1) {
      workers.splice(index, 1);
    }

    // Spawn the replacement first so a stalled DB call inside finalize
    // (connection lock, network blip, etc.) can't delay recovery.
    if (!isExiting) {
      // `code` and `signal` are mutually exclusive: a clean process exit
      // sets `code`, a kill-by-signal sets `signal`. The distinction
      // matters when triaging why a child died — silent SIGKILLs (cgroup
      // OOM, external kill) bypass the in-process fatal handlers in
      // worker.ts, and we currently can't tell those apart from a clean
      // exit without this on the parent side.
      log.info(
        `worker ${name} exited (code=${code}, signal=${signal}). spawning replacement worker`,
      );
      startWorker(priority, urlMappings);
    }

    // Free orphan reservations in the background. The new worker won't be
    // able to claim the dead worker's reservation until completed_at is
    // set, so this still races to be useful — but if it stalls, the
    // existing 60s monitorWorker / 7200s lease-expiry path is the
    // backstop, not this exit handler. A child exit while still holding
    // a reservation is by definition an interruption, so the row is
    // marked 'interrupted' and does not count toward the per-job cap.
    finalizeOrphanedReservations(adapter, workerId, 'interrupted').catch(
      (e) => {
        Sentry.captureException(e);
        log.error(
          `worker: finalizeOrphanedReservations threw for worker ${workerId}`,
          e,
        );
      },
    );
  });

  if (worker.stdout) {
    worker.stdout.on('data', (data: Buffer) =>
      log.info(`[worker ${name} priority ${priority}]: ${data.toString()}`),
    );
  }
  if (worker.stderr) {
    worker.stderr.on('data', (data: Buffer) => {
      let message = data.toString();
      let maybeLogUrl = currentState?.url ? ` (for ${currentState.url})` : '';
      log.error(
        `[worker ${name} priority ${priority}]${maybeLogUrl}: ${message}`,
      );
      if (message.includes('FATAL ERROR')) {
        (async () => {
          if (currentState?.url && currentState?.realm) {
            let { url, realm, deps } = currentState;
            message = `encountered fatal error indexing ${url}: ${message}`;
            await markFailedIndexEntry({ url, realm, deps, message });
          }
          if (workerId && currentState?.jobId) {
            await markFailedJob({
              workerId,
              jobId: currentState.jobId,
              message,
            });
          }
        })().catch((e) => {
          Sentry.captureException(e);
          log.error(
            `worker: Unexpected error encountered trying to mark a failed job for worker ${workerId} with job id ${currentState?.jobId}`,
            e,
          );
        });
      }
    });
  }

  let timeout = await Promise.race([
    new Promise<void>((r) => {
      worker.on('message', (message) => {
        if (typeof message === 'string' && message.startsWith('ready:')) {
          let id = message.substring('ready:'.length);
          workerId = id;
          // Expose the workerId so the manager-level SIGTERM drain
          // (`shutdown()`) can run finalizeOrphanedReservations against
          // every live child without having to capture closure scope.
          (worker as any).__workerId = id;
          watchdog = setInterval(() => monitorWorker(id, worker), 60_000);
          log.info(`[worker ${name} priority ${priority}]: worker ready`);
          r();
        } else if (
          typeof message === 'string' &&
          message.startsWith('status|')
        ) {
          let [_, args] = message.split('|');
          let { jobId, status, realm, url, deps } = JSON.parse(
            args,
          ) as StatusArgs;
          if (status === 'start') {
            currentState = {
              jobId,
              url,
              realm,
              deps,
            };
            (worker as any).__boxelIndexState = currentState;
          } else {
            currentState = undefined;
            (worker as any).__boxelIndexState = undefined;
          }
        } else if (
          typeof message === 'string' &&
          message.startsWith('progress|')
        ) {
          try {
            let payload = message.substring('progress|'.length);
            let progressEvent = JSON.parse(payload) as IndexingProgressEvent;
            eventSink.handleEvent(progressEvent);
          } catch (e) {
            log.error(`Failed to parse progress event: ${e}`);
          }
        } else if (
          typeof message === 'string' &&
          message.startsWith('worker-request|')
        ) {
          // A worker child handed us a typed request it can't service itself
          // (e.g. broadcasting a realm event — it holds no matrix client). We
          // dispatch on the request type and forward to the realm server over
          // the authenticated /_worker-request endpoint. Routing every request
          // through this single manager avoids per-replica fan-out (CS-11808).
          // Fixed-offset substring (not split) so the JSON payload may contain
          // the `|` delimiter freely.
          let payload = message.substring('worker-request|'.length);
          let request: WorkerRequestBody;
          try {
            request = JSON.parse(payload) as WorkerRequestBody;
          } catch (e) {
            log.error(
              `Failed to parse worker request from worker ${name}: ${e}`,
            );
            return;
          }
          dispatchWorkerRequest(request, {
            urlMappings,
            secret: REALM_SECRET_SEED!,
            workerName: name,
          }).catch((e) => {
            Sentry.captureException(e);
            log.error(
              `worker: failed dispatching worker request '${request.type}' from ${name}`,
              e,
            );
          });
        }
      });
    }),
    new Promise<true>((r) =>
      setTimeout(() => r(true), WORKER_START_TIMEOUT_MS).unref(),
    ),
  ]);
  if (timeout) {
    console.error(
      `timed-out waiting for worker ${name} to start after ${WORKER_START_TIMEOUT_MS}ms. Stopping worker manager`,
    );
    process.exit(-2);
  }
}

async function query(expression: Expression) {
  return await _query(adapter, expression);
}

interface IndexState {
  jobId?: string;
  url?: string;
  realm?: string;
  deps?: string[];
}
