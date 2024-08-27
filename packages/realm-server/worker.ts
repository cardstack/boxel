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
import { setErrorReporter } from '@cardstack/runtime-common/realm';
import PgAdapter from './pg-adapter';
import PgQueue from './pg-queue';

let log = logger('worker');

if (process.env.REALM_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.REALM_SENTRY_DSN,
    environment: process.env.REALM_SENTRY_ENVIRONMENT || 'development',
  });

  setErrorReporter(Sentry.captureException);
} else {
  log.warn(
    `No REALM_SENTRY_DSN environment variable found, skipping Sentry setup.`,
  );
}

const REALM_SECRET_SEED = process.env.REALM_SECRET_SEED;
if (!REALM_SECRET_SEED) {
  console.error(
    `The REALM_SECRET_SEED environment variable is not set. Please make sure this env var has a value`,
  );
  process.exit(-1);
}

let {
  port,
  matrixURL,
  distURL = process.env.HOST_URL ?? 'http://localhost:4200',
  fromUrl: fromUrls,
  toUrl: toUrls,
} = yargs(process.argv.slice(2))
  .usage('Start worker')
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
  })
  .parseSync();

log.info(`starting worker for port ${port}`);

if (fromUrls.length !== toUrls.length) {
  console.error(
    `Mismatched number of URLs, the --fromUrl params must be matched to the --toUrl params`,
  );
  process.exit(-1);
}

let virtualNetwork = new VirtualNetwork();

shimExternals(virtualNetwork);

let urlMappings = fromUrls.map((fromUrl, i) => [
  new URL(String(fromUrl), `http://localhost:${port}`),
  new URL(String(toUrls[i]), `http://localhost:${port}`),
]);
for (let [from, to] of urlMappings) {
  virtualNetwork.addURLMapping(from, to);
}
let dist: URL = new URL(distURL);

(async () => {
  let dbAdapter = new PgAdapter();
  let queue = new PgQueue(dbAdapter);
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
  if (process.send) {
    log.info(`worker on port ${port} is ready`);
    process.send('ready');
  }
})().catch((e: any) => {
  Sentry.captureException(e);
  console.error(
    `Unexpected error encountered starting realm, stopping server`,
    e,
  );
  process.exit(1);
});
