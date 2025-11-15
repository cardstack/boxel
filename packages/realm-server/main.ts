import './instrument';
import './setup-logger'; // This should be first
import {
  Realm,
  VirtualNetwork,
  logger,
  RunnerOptionsManager,
  Deferred,
} from '@cardstack/runtime-common';
import { NodeAdapter } from './node-realm';
import yargs from 'yargs';
import { RealmServer } from './server';
import { resolve } from 'path';
import { makeFastBootIndexRunner } from './fastboot';
import * as Sentry from '@sentry/node';
import { PgAdapter, PgQueuePublisher } from '@cardstack/postgres';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';

import 'decorator-transforms/globals';

let log = logger('main');
if (process.env.NODE_ENV === 'test') {
  (globalThis as any).__environment = 'test';
}

if (process.env.USE_HEADLESS_CHROME_INDEXING === 'true') {
  (globalThis as any).__useHeadlessChromePrerender = true;
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

if (process.env.DISABLE_MODULE_CACHING === 'true') {
  console.warn(
    `module caching has been disabled, module executables will be served directly from the filesystem`,
  );
}

const ENABLE_FILE_WATCHER = process.env.ENABLE_FILE_WATCHER === 'true';

let {
  port,
  matrixURL,
  realmsRootPath,
  serverURL = `http://localhost:${port}`,
  distURL = process.env.HOST_URL ?? 'http://localhost:4200',
  path: paths,
  fromUrl: fromUrls,
  toUrl: toUrls,
  username: usernames,
  useRegistrationSecretFunction,
  migrateDB,
  workerManagerPort,
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
let urlMappings = fromUrls.map((fromUrl, i) => [
  new URL(String(fromUrl)),
  new URL(String(toUrls[i])),
]);
for (let [from, to] of urlMappings) {
  virtualNetwork.addURLMapping(from, to);
}
let hrefs = urlMappings.map(([from, to]) => [from.href, to.href]);
let dist: URL = new URL(distURL);
let autoMigrate = migrateDB || undefined;

(async () => {
  let realms: Realm[] = [];
  let dbAdapter = new PgAdapter({ autoMigrate });
  let queue = new PgQueuePublisher(dbAdapter);
  let manager = new RunnerOptionsManager();
  let { getIndexHTML } = await makeFastBootIndexRunner(
    dist,
    manager.getOptions.bind(manager),
  );

  if (workerManagerPort != null) {
    await waitForWorkerManager(workerManagerPort);
  }

  let realmServerMatrixClient = new MatrixClient({
    matrixURL: new URL(MATRIX_URL),
    username: REALM_SERVER_MATRIX_USERNAME,
    seed: REALM_SECRET_SEED,
  });

  for (let [i, path] of paths.entries()) {
    let url = hrefs[i][0];

    let username = String(usernames[i]);
    if (username.length === 0) {
      console.error(`missing username for realm ${url}`);
      process.exit(-1);
    }

    let realmAdapter = new NodeAdapter(
      resolve(String(path)),
      ENABLE_FILE_WATCHER,
    );

    let realm = new Realm(
      {
        url,
        adapter: realmAdapter,
        matrix: { url: new URL(matrixURL), username },
        secretSeed: REALM_SECRET_SEED,
        virtualNetwork,
        dbAdapter,
        queue,
        realmServerMatrixClient,
      },
      {
        fullIndexOnStartup: true,
        ...(process.env.DISABLE_MODULE_CACHING === 'true'
          ? { disableModuleCaching: true }
          : {}),
      },
    );
    realms.push(realm);
    virtualNetwork.mount(realm.handle);
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
  let domainsForPublishedRealms = {
    boxelSpace:
      process.env.PUBLISHED_REALM_BOXEL_SPACE_DOMAIN || 'localhost:4201',
    boxelSite:
      process.env.PUBLISHED_REALM_BOXEL_SITE_DOMAIN || 'localhost:4201',
  };

  let server = new RealmServer({
    realms,
    virtualNetwork,
    matrixClient: realmServerMatrixClient,
    realmsRootPath,
    realmServerSecretSeed: REALM_SERVER_SECRET_SEED,
    realmSecretSeed: REALM_SECRET_SEED,
    grafanaSecret: GRAFANA_SECRET,
    dbAdapter,
    queue,
    assetsURL: process.env.ASSETS_URL_OVERRIDE
      ? new URL(process.env.ASSETS_URL_OVERRIDE)
      : dist,
    getIndexHTML,
    serverURL: new URL(serverURL),
    matrixRegistrationSecret: MATRIX_REGISTRATION_SHARED_SECRET,
    enableFileWatcher: ENABLE_FILE_WATCHER,
    domainsForPublishedRealms,
    getRegistrationSecret: useRegistrationSecretFunction
      ? getRegistrationSecret
      : undefined,
  });

  let httpServer = server.listen(port);
  process.on('message', (message) => {
    if (message === 'stop') {
      console.log(`stopping realm server on port ${port}...`);
      httpServer.closeAllConnections();
      httpServer.close(() => {
        queue.destroy(); // warning this is async
        dbAdapter.close(); // warning this is async
        console.log(`realm server on port ${port} has stopped`);
        if (process.send) {
          process.send('stopped');
        }
      });
    } else if (message === 'kill') {
      console.log(`Ending server process for ${port}...`);
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

  await server.start();

  log.info(`Realm server listening on port ${port} is serving realms:`);
  let additionalMappings = hrefs.slice(paths.length);
  for (let [index, { url }] of realms.entries()) {
    log.info(`    ${url} => ${hrefs[index][1]}, serving path ${paths[index]}`);
  }
  if (additionalMappings.length) {
    log.info('Additional URL mappings:');
    for (let [from, to] of additionalMappings) {
      log.info(`    ${from} => ${to}`);
    }
  }
  log.info(`Using host url: '${dist}' for card pre-rendering`);

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

async function waitForWorkerManager(port: number) {
  let isReady = false;
  let timeout = Date.now() + 30_000;
  do {
    let response = await fetch(`http://localhost:${port}/`);
    if (response.ok) {
      let json = await response.json();
      isReady = json.ready;
    }
  } while (!isReady && Date.now() < timeout);
  if (!isReady) {
    throw new Error(
      `timed out trying to waiting for worker manager to be ready on port ${port}`,
    );
  }
  log.info('workers are ready');
}
