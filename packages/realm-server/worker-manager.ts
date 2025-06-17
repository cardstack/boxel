import './instrument';
import './setup-logger'; // This should be first
import {
  logger,
  userInitiatedPriority,
  systemInitiatedPriority,
  query as _query,
  param,
  separatedByCommas,
  IndexWriter,
  type Expression,
  type StatusArgs,
} from '@cardstack/runtime-common';
import yargs from 'yargs';
import * as Sentry from '@sentry/node';
import flattenDeep from 'lodash/flattenDeep';
import { spawn, type ChildProcess } from 'child_process';
import pluralize from 'pluralize';
import Koa from 'koa';
import Router from '@koa/router';
import { ecsMetadata, fullRequestURL, livenessCheck } from './middleware';
import { Server } from 'http';
import { PgAdapter } from '@cardstack/postgres';

/* About the Worker Manager
 *
 * This process runs on each queue worker container and is responsible starting and monitoring the worker processes. It does this via IPC (inter-process communication).
 * In test and development environments, the worker manager is also responsible for providing a readiness check HTTP endpoint so that tests can wait until the worker
 * manager is ready before proceeding.
 */

let log = logger('worker-manager');

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
  distURL = process.env.HOST_URL ?? 'http://localhost:4200',
  fromUrl: fromUrls,
  toUrl: toUrls,
  migrateDB,
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
        'The number of workers that service high priority jobs (user initiated) to start (default 0)',
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
    distURL: {
      description:
        'the URL of a deployed host app. (This can be provided instead of the --distPath)',
      type: 'string',
    },
    matrixURL: {
      description: 'The matrix homeserver for the realm server',
      demandOption: true,
      type: 'string',
    },
  })
  .parseSync();

let isReady = false;
let isExiting = false;
process.on('SIGINT', () => (isExiting = true));
process.on('SIGTERM', () => (isExiting = true));

let webServerInstance: Server | undefined;
let autoMigrate = migrateDB || undefined;

if (port) {
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
  log.info(`worker manager HTTP listening on port ${port}`);
}

const shutdown = (onShutdown?: () => void) => {
  log.info(`Shutting down server for worker manager...`);
  webServerInstance?.closeAllConnections();
  webServerInstance?.close((err?: Error) => {
    if (err) {
      log.error(`Error while closing the server for worker manager HTTP:`, err);
      process.exit(1);
    }
    log.info(`worker manager HTTP on port ${port} has stopped.`);
    onShutdown?.();
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
process.on('uncaughtException', (err) => {
  log.error(`Uncaught exception in worker manager:`, err);
  shutdown();
});

process.on('message', (message) => {
  if (message === 'stop') {
    shutdown(() => {
      process.send?.('stopped');
    });
  } else if (message === 'kill') {
    log.info(`Ending worker manager process for ${port}...`);
    process.exit(0);
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
  let urlMappings = fromUrls.map((fromUrl, i) => [
    new URL(String(fromUrl)),
    new URL(String(toUrls[i])),
  ]);
  adapter = new PgAdapter({ autoMigrate });

  for (let i = 0; i < highPriorityCount; i++) {
    await startWorker(userInitiatedPriority, urlMappings);
  }
  for (let i = 0; i < allPriorityCount; i++) {
    await startWorker(systemInitiatedPriority, urlMappings);
  }
  isReady = true;
  log.info('All workers have been started');
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
    `SELECT id, job_id FROM job_reservations WHERE worker_id=`,
    param(workerId),
    `AND completed_at IS NULL AND locked_until < NOW()`,
  ])) as { id: string; job_id: string }[];

  if (stuckJobs.length > 0) {
    Sentry.captureMessage(
      `Detected stuck jobs for worker ${workerId}. job id(s): ${stuckJobs.map((j) => j.job_id).join()}. recycling worker`,
    );
    log.error(`detected stuck jobs for worker ${workerId}`);
    for (let { id, job_id: jobId } of stuckJobs) {
      log.info(`marking job ${jobId} as timed-out for worker ${workerId}`);
      await query([
        `UPDATE jobs SET `,
        ...separatedByCommas([
          [
            `result =`,
            param({
              status: 500,
              message: `Timed-out. Worker manager killed unresponsive worker ${workerId} for job reservation ${id}`,
            }),
          ],
          [`status = 'rejected'`],
          [`finished_at = NOW()`],
        ]),
        'WHERE id =',
        param(jobId),
      ] as Expression);
      await query([
        `UPDATE job_reservations SET completed_at = NOW() WHERE id =`,
        param(id),
      ]);
      await query([`NOTIFY jobs_finished`]);
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
  let batch = await indexWriter.createBatch(new URL(realm));
  let invalidations = await batch.invalidate([new URL(url)]);
  for (let file of [url, ...invalidations]) {
    await batch.updateEntry(new URL(file), {
      type: 'error',
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

async function markFailedJob(
  workerId: string | undefined,
  jobId: string,
  message: string,
) {
  log.info(`marking job ${jobId} as failed for worker ${workerId}`);
  let [{ id }] = (await query([
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
  await query([
    `UPDATE job_reservations SET completed_at = NOW() WHERE id =`,
    param(id),
  ]);
  await query([`NOTIFY jobs_finished`]);
}

async function startWorker(priority: number, urlMappings: URL[][]) {
  let worker = spawn(
    'ts-node',
    [
      '--transpileOnly',
      'worker',
      `--matrixURL='${matrixURL}'`,
      `--distURL='${distURL}'`,
      `--priority=${priority}`,
      ...flattenDeep(
        urlMappings.map(([from, to]) => [
          `--fromUrl='${from.href}'`,
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
  let currentState:
    | {
        jobId?: string;
        url?: string;
        realm?: string;
        deps?: string[];
      }
    | undefined;

  worker.on('exit', () => {
    clearInterval(watchdog);
    if (!isExiting) {
      log.info(`worker ${name} exited. spawning replacement worker`);
      startWorker(priority, urlMappings);
    }
  });

  if (worker.stdout) {
    worker.stdout.on('data', (data: Buffer) =>
      log.info(`[worker ${name} priority ${priority}]: ${data.toString()}`),
    );
  }
  if (worker.stderr) {
    worker.stderr.on('data', (data: Buffer) => {
      let message = data.toString();
      log.error(`[worker ${name} priority ${priority}]: ${message}`);
      if (message.includes('FATAL ERROR')) {
        (async () => {
          if (currentState?.url && currentState?.realm) {
            let { url, realm, deps } = currentState;
            message = `encountered fatal error indexing ${url}: ${message}`;
            await markFailedIndexEntry({ url, realm, deps, message });
          }
          if (workerId && currentState?.jobId) {
            await markFailedJob(workerId, currentState.jobId, message);
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
          } else {
            currentState = undefined;
          }
        }
      });
    }),
    new Promise<true>((r) => setTimeout(() => r(true), 30_000).unref()),
  ]);
  if (timeout) {
    console.error(
      `timed-out waiting for worker ${name} to start. Stopping worker manager`,
    );
    process.exit(-2);
  }
}

async function query(expression: Expression) {
  return await _query(adapter, expression);
}
