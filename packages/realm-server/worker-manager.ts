import './instrument';
import './setup-logger'; // This should be first
import { logger } from '@cardstack/runtime-common';
import yargs from 'yargs';
import * as Sentry from '@sentry/node';
import { createServer } from 'net';
import flattenDeep from 'lodash/flattenDeep';
import { spawn } from 'child_process';
import pluralize from 'pluralize';

let log = logger('worker');

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
  count = 1,
  distURL = process.env.HOST_URL ?? 'http://localhost:4200',
  fromUrl: fromUrls,
  toUrl: toUrls,
} = yargs(process.argv.slice(2))
  .usage('Start worker manager')
  .options({
    port: {
      description: 'TCP port for worker to communicate readiness (for tests)',
      type: 'number',
    },
    count: {
      description: 'The number of workers to start',
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
if (port != null) {
  // in tests we start a simple TCP server to communicate to the realm when
  // the worker is ready to start processing jobs
  let server = createServer((socket) => {
    log.info(`realm connected to worker manager`);
    socket.on('data', (data) => {
      if (data.toString() === 'ready?') {
        socket.write(isReady ? 'ready' : 'not-ready');
      }
    });
    socket.on('close', (hadError) => {
      log.info(`realm has disconnected${hadError ? ' due to an error' : ''}.`);
    });
    socket.on('error', (err: any) => {
      console.error(`realm disconnected from worker manager: ${err.message}`);
    });
  });
  server.unref();

  server.listen(port, () => {
    log.info(`worker manager listening for realm on port ${port}`);
  });

  const shutdown = () => {
    log.info(`Shutting down server for worker manager...`);
    server.close((err) => {
      if (err) {
        log.error(`Error while closing the server for worker manager:`, err);
        process.exit(1);
      }
      log.info(`Server closed for worker manager.`);
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
      console.log(`stopping realm server on port ${port}...`);
      server.close(() => {
        console.log(`worker manager on port ${port} has stopped`);
        if (process.send) {
          process.send('stopped');
        }
      });
    } else if (message === 'kill') {
      console.log(`Ending worker manager process for ${port}...`);
      process.exit(0);
    }
  });
}

(async () => {
  log.info(`starting ${count} ${pluralize('worker', count)}`);
  let urlMappings = fromUrls.map((fromUrl, i) => [
    new URL(String(fromUrl)),
    new URL(String(toUrls[i])),
  ]);

  for (let i = 0; i < count; i++) {
    await startWorker(urlMappings);
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

async function startWorker(urlMappings: URL[][]) {
  let worker = spawn(
    'ts-node',
    [
      '--transpileOnly',
      'worker',
      `--matrixURL='${matrixURL}'`,
      `--distURL='${distURL}'`,
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

  if (worker.stdout) {
    worker.stdout.on('data', (data: Buffer) =>
      log.info(`[worker ${worker.pid}]: ${data.toString()}`),
    );
  }
  if (worker.stderr) {
    worker.stderr.on('data', (data: Buffer) =>
      log.error(`[worker ${worker.pid}]: ${data.toString()}`),
    );
  }

  let timeout = await Promise.race([
    new Promise<void>((r) => {
      worker.on('message', (message) => {
        if (message === 'ready') {
          log.info(`[worker ${worker.pid}]: worker ready`);
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
