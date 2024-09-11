import './setup-logger'; // This should be first
import {
  Realm,
  VirtualNetwork,
  logger,
  RunnerOptionsManager,
  permissionsExist,
  insertPermissions,
} from '@cardstack/runtime-common';
import { NodeAdapter } from './node-realm';
import yargs from 'yargs';
import { RealmServer } from './server';
import { resolve } from 'path';
import { spawn } from 'child_process';
import { makeFastBootIndexRunner } from './fastboot';
import { shimExternals } from './lib/externals';
import * as Sentry from '@sentry/node';
import { setErrorReporter } from '@cardstack/runtime-common/realm';
import PgAdapter from './pg-adapter';
import PgQueue from './pg-queue';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import flattenDeep from 'lodash/flattenDeep';

let log = logger('main');

if (process.env.REALM_SENTRY_DSN) {
  log.info('Setting up Sentry.');
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
  matrixRegistrationSecretFile,
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
    matrixRegistrationSecretFile: {
      description:
        "The path to a file that contains the matrix registration secret (used for matrix tests where the registration secret changes during the realm server's lifespan)",
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

if (!matrixRegistrationSecretFile && !MATRIX_REGISTRATION_SHARED_SECRET) {
  console.error(
    `The MATRIX_REGISTRATION_SHARED_SECRET environment variable is not set. Please make sure this env var has a value (or specify --matrixRegistrationSecretFile)`,
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
let hrefs = urlMappings.map(([from, to]) => [from.href, to.href]);
let dist: URL = new URL(distURL);

(async () => {
  let realms: Realm[] = [];
  let dbAdapter = new PgAdapter();
  let queue = new PgQueue(dbAdapter);
  let manager = new RunnerOptionsManager();
  let { getIndexHTML } = await makeFastBootIndexRunner(
    dist,
    manager.getOptions.bind(manager),
  );

  await startWorker();

  for (let [i, path] of paths.entries()) {
    let url = hrefs[i][0];

    await seedRealmPermissions(dbAdapter, new URL(url));

    let username = String(usernames[i]);
    if (username.length === 0) {
      console.error(`missing username for realm ${url}`);
      process.exit(-1);
    }

    let realmAdapter = new NodeAdapter(resolve(String(path)));
    let realm = new Realm(
      {
        url,
        adapter: realmAdapter,
        getIndexHTML,
        matrix: { url: new URL(matrixURL), username },
        secretSeed: REALM_SECRET_SEED,
        virtualNetwork,
        dbAdapter,
        queue,
        assetsURL: dist,
      },
      {
        ...(process.env.DISABLE_MODULE_CACHING === 'true'
          ? { disableModuleCaching: true }
          : {}),
      },
    );
    realms.push(realm);
    virtualNetwork.mount(realm.handle);
  }

  let matrixClient = new MatrixClient({
    matrixURL: new URL(MATRIX_URL),
    username: REALM_SERVER_MATRIX_USERNAME,
    seed: REALM_SECRET_SEED,
  });
  let server = new RealmServer({
    realms,
    virtualNetwork,
    matrixClient,
    realmsRootPath,
    secretSeed: REALM_SECRET_SEED,
    dbAdapter,
    queue,
    assetsURL: dist,
    getIndexHTML,
    serverURL: new URL(serverURL),
    matrixRegistrationSecret: MATRIX_REGISTRATION_SHARED_SECRET,
    matrixRegistrationSecretFile,
  });

  server.listen(port);

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
})().catch((e: any) => {
  Sentry.captureException(e);
  console.error(
    `Unexpected error encountered starting realm, stopping server`,
    e,
  );
  process.exit(-3);
});

async function startWorker() {
  let worker = spawn(
    'ts-node',
    [
      '--transpileOnly',
      'worker',
      `--port=${port}`,
      `--matrixURL='${matrixURL}'`,
      `--distURL='${distURL}'`,
      ...flattenDeep(
        urlMappings.map(([from, to]) => [
          `--fromUrl='${from}'`,
          `--toUrl='${to}'`,
        ]),
      ),
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    },
  );

  if (worker.stdout) {
    worker.stdout.on('data', (data: Buffer) =>
      log.info(`worker: ${data.toString()}`),
    );
  }
  if (worker.stderr) {
    worker.stderr.on('data', (data: Buffer) =>
      console.error(`worker: ${data.toString()}`),
    );
  }

  let timeout = await Promise.race([
    new Promise<void>((r) => {
      worker.on('message', (message) => {
        if (message === 'ready') {
          r();
        }
      });
    }),
    new Promise<true>((r) => setTimeout(() => r(true), 30_000)),
  ]);
  if (timeout) {
    console.error(`timed-out waiting for worker to start. Stopping server`);
    process.exit(-2);
  }
}

// In case there are no permissions in the database, seed the realm with default permissions:
// Base realm: read permissions for everyone
// Other realms: read permissions for everyone, read/write permissions for signed up users
async function seedRealmPermissions(dbAdapter: PgAdapter, realmURL: URL) {
  if (!(await permissionsExist(dbAdapter, realmURL))) {
    if (realmURL.href === 'https://cardstack.com/base/') {
      await insertPermissions(dbAdapter, realmURL, { '*': ['read'] });
    } else {
      await insertPermissions(dbAdapter, realmURL, {
        '*': ['read'],
        users: ['read', 'write'],
      });
    }
  }
}
