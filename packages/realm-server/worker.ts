import './instrument';
import './setup-logger'; // This should be first
import {
  Worker,
  VirtualNetwork,
  logger,
  RunnerOptionsManager,
  IndexWriter,
} from '@cardstack/runtime-common';
import yargs from 'yargs';
import { makeFastBootIndexRunner } from './fastboot';
import { shimExternals } from './lib/externals';
import * as Sentry from '@sentry/node';
import { PgAdapter, PgQueueRunner } from '@cardstack/postgres';

let log = logger('worker');

const REALM_SECRET_SEED = process.env.REALM_SECRET_SEED;
if (!REALM_SECRET_SEED) {
  log.error(
    `The REALM_SECRET_SEED environment variable is not set. Please make sure this env var has a value`,
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
  })
  .parseSync();

log.info(`starting worker with pid ${process.pid} and priority ${priority}`);

if (fromUrls.length !== toUrls.length) {
  log.error(
    `Mismatched number of URLs, the --fromUrl params must be matched to the --toUrl params`,
  );
  process.exit(-1);
}

let virtualNetwork = new VirtualNetwork();

shimExternals(virtualNetwork);

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
  });

  await worker.run();
  log.info(`worker started`);
  if (process.send) {
    process.send(`ready:${workerId}`);
  }
})().catch((e: any) => {
  Sentry.captureException(e);
  log.error(
    `worker: Unexpected error encountered starting worker, stopping worker`,
    e,
  );
  process.exit(1);
});
