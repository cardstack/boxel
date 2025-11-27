import './instrument';
import './setup-logger'; // This should be first
import {
  Worker,
  VirtualNetwork,
  logger,
  RunnerOptionsManager,
  IndexWriter,
  type StatusArgs,
  type Prerenderer,
} from '@cardstack/runtime-common';
import yargs from 'yargs';
import { makeFastBootIndexRunner } from './fastboot';
import * as Sentry from '@sentry/node';
import {
  PgAdapter,
  PgQueuePublisher,
  PgQueueRunner,
} from '@cardstack/postgres';
import { createRemotePrerenderer } from './prerender/remote-prerenderer';

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
  distURL = process.env.HOST_URL ?? 'http://localhost:4200',
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
    distURL: {
      description:
        'the URL of a deployed host app. (This can be provided instead of the --distPath)',
      type: 'string',
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
let useHeadlessChromePrerender =
  process.env.USE_HEADLESS_CHROME_INDEXING === 'true' &&
  Boolean(prerendererUrl);
let prerenderer: Prerenderer;
if (useHeadlessChromePrerender && prerendererUrl) {
  (globalThis as any).__useHeadlessChromePrerender = true;
  log.info(`Using prerender server ${prerendererUrl}`);
  prerenderer = createRemotePrerenderer(prerendererUrl);
} else {
  prerenderer = {
    async prerenderCard() {
      throw new Error(`Prerenderer server has not been configured/enabled`);
    },
    async prerenderModule() {
      throw new Error(`Prerenderer server has not been configured/enabled`);
    },
  };
}

if (fromUrls.length !== toUrls.length) {
  log.error(
    `Mismatched number of URLs, the --fromUrl params must be matched to the --toUrl params`,
  );
  process.exit(-1);
}

let virtualNetwork = new VirtualNetwork();
let urlMappings = fromUrls.map((fromUrl, i) => [
  new URL(String(fromUrl)),
  new URL(String(toUrls[i])),
]);
for (let [from, to] of urlMappings) {
  virtualNetwork.addURLMapping(from, to);
}
let dist: URL = new URL(distURL);
let autoMigrate = migrateDB || undefined;

(async () => {
  function reportStatus({ jobId, status, realm, url, deps }: StatusArgs) {
    if (process.send) {
      process.send(
        `status|${JSON.stringify({ jobId, status, realm, url, deps })}`,
      );
    }
  }

  let dbAdapter = new PgAdapter({ autoMigrate });
  let queue = new PgQueueRunner({ adapter: dbAdapter, workerId, priority });
  let manager = new RunnerOptionsManager();
  let { getRunner } = await makeFastBootIndexRunner(
    dist,
    manager.getOptions.bind(manager),
  );
  let worker = new Worker({
    indexWriter: new IndexWriter(dbAdapter),
    queue,
    runnerOptsManager: manager,
    virtualNetwork,
    matrixURL: new URL(matrixURL),
    secretSeed: REALM_SECRET_SEED,
    indexRunner: getRunner,
    reportStatus,
    realmServerMatrixUsername: REALM_SERVER_MATRIX_USERNAME,
    dbAdapter,
    queuePublisher: new PgQueuePublisher(dbAdapter),
    prerenderer,
    useHeadlessChromePrerender,
  });

  await worker.run();
  log.info(`worker started`);
  if (process.send) {
    process.send(`ready:${workerId}`);
  }

  // Handle graceful shutdown
  const shutdown = async () => {
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
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('message', (message) => {
    if (message === 'stop') {
      shutdown(); // warning this is async
    }
  });
})().catch((e: any) => {
  Sentry.captureException(e);
  log.error(
    `worker: Unexpected error encountered starting worker, stopping worker`,
    e,
  );
  process.exit(1);
});
