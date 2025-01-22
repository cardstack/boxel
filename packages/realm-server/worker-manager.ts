import './instrument';
import './setup-logger'; // This should be first
import {
  logger,
  userInitiatedPriority,
  systemInitiatedPriority,
} from '@cardstack/runtime-common';
import yargs from 'yargs';
import * as Sentry from '@sentry/node';
import flattenDeep from 'lodash/flattenDeep';
import { spawn } from 'child_process';
import pluralize from 'pluralize';
import Koa from 'koa';
import Router from '@koa/router';
import { ecsMetadata, fullRequestURL, livenessCheck } from './middleware';
import { Server } from 'http';

/* About the Worker Manager
 *
 * This process runs on each queue worker container and is responsible starting and monitoring the worker processes. It does this via IPC (inter-process communication).
 * In test and development environments, the worker manager is also responsible for providing a readiness check HTTP endpoint so that tests can wait until the worker
 * manager is ready before proceeding.
 */

let log = logger('worker-manager');

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
    if (onShutdown) {
      onShutdown();
    }
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
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

  worker.on('exit', () => {
    if (!isExiting) {
      log.info(`worker ${worker.pid} exited. spawning replacement worker`);
      startWorker(priority, urlMappings);
    }
  });

  if (worker.stdout) {
    worker.stdout.on('data', (data: Buffer) =>
      log.info(
        `[worker ${worker.pid} priority ${priority}]: ${data.toString()}`,
      ),
    );
  }
  if (worker.stderr) {
    worker.stderr.on('data', (data: Buffer) =>
      log.error(
        `[worker ${worker.pid} priority ${priority}]: ${data.toString()}`,
      ),
    );
  }

  let timeout = await Promise.race([
    new Promise<void>((r) => {
      worker.on('message', (message) => {
        if (message === 'ready') {
          log.info(`[worker ${worker.pid} priority ${priority}]: worker ready`);
          r();
        }
      });
    }),
    new Promise<true>((r) => setTimeout(() => r(true), 30_000)),
  ]);
  if (timeout) {
    console.error(
      `timed-out waiting for worker pid ${worker.pid} to start. Stopping worker manager`,
    );
    process.exit(-2);
  }
}
