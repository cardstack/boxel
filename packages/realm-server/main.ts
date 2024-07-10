import './setup-logger'; // This should be first
import {
  Realm,
  Worker,
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
import { makeFastBootIndexRunner } from './fastboot';
import { shimExternals } from './lib/externals';
import * as Sentry from '@sentry/node';
import { setErrorReporter } from '@cardstack/runtime-common/realm';
import PgAdapter from './pg-adapter';
import PgQueue from './pg-queue';

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

let {
  port,
  distURL = 'http://localhost:4200',
  path: paths,
  fromUrl: fromUrls,
  toUrl: toUrls,
  useTestingDomain,
  username: usernames,
  password: passwords,
  matrixURL: matrixURLs,
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
    useTestingDomain: {
      description:
        'relaxes document domain rules so that cross origin scripting can be used for test assertions across iframe boundaries',
      type: 'boolean',
    },
    matrixURL: {
      description: 'The matrix homeserver for the realm',
      demandOption: true,
      type: 'array',
    },
    username: {
      description: 'The matrix username for the realm user',
      demandOption: true,
      type: 'array',
    },
    password: {
      description: 'The matrix password for the realm user',
      demandOption: true,
      type: 'array',
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

if (
  paths.length !== usernames.length ||
  usernames.length !== passwords.length ||
  paths.length !== matrixURLs.length
) {
  console.error(
    `not enough username/password pairs were provided to satisfy the paths provided. There must be at least one --username/--password/--matrixURL set for each --path parameter`,
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
  await dbAdapter.startClient();

  for (let [i, path] of paths.entries()) {
    let url = hrefs[i][0];

    await seedRealmPermissions(dbAdapter, new URL(url));

    let manager = new RunnerOptionsManager();
    let matrixURL = String(matrixURLs[i]);
    if (matrixURL.length === 0) {
      console.error(`missing matrix URL for realm ${url}`);
      process.exit(-1);
    }
    let username = String(usernames[i]);
    if (username.length === 0) {
      console.error(`missing username for realm ${url}`);
      process.exit(-1);
    }
    let password = String(passwords[i]);
    if (password.length === 0) {
      console.error(`missing password for realm ${url}`);
      process.exit(-1);
    }
    let { getRunner, getIndexHTML } = await makeFastBootIndexRunner(
      dist,
      manager.getOptions.bind(manager),
    );

    let realmAdapter = new NodeAdapter(resolve(String(path)));
    let realm = new Realm(
      {
        url,
        adapter: realmAdapter,
        getIndexHTML,
        matrix: { url: new URL(matrixURL), username, password },
        realmSecretSeed: REALM_SECRET_SEED,
        virtualNetwork,
        dbAdapter,
        queue,
        onIndexUpdaterReady: async (indexUpdater) => {
          // Note for future: we are taking advantage of the fact that the realm
          // does not need to auth with itself and are passing in the realm's
          // loader which includes a url handler for internal requests that
          // bypasses auth. when workers are moved outside of the realm server
          // they will need to provide realm authentication credentials when
          // indexing.
          let worker = new Worker({
            realmURL: new URL(url),
            indexUpdater,
            queue,
            realmAdapter,
            runnerOptsManager: manager,
            loader: realm.loaderTemplate,
            indexRunner: getRunner,
          });
          await worker.run();
        },
        assetsURL: dist,
      },
      {
        deferStartUp: true,
        ...(useTestingDomain
          ? {
              useTestingDomain,
            }
          : {}),
      },
    );
    realms.push(realm);
    virtualNetwork.mount(realm.handle);
  }

  let server = new RealmServer(realms, virtualNetwork);

  server.listen(port);
  log.info(`Realm server listening on port ${port}:`);
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

  for (let realm of realms) {
    log.info(`Starting realm ${realm.url}...`);
    await realm.start();
    log.info(
      `Realm ${realm.url} has started (${JSON.stringify(
        realm.searchIndex.stats,
        null,
        2,
      )})`,
    );
  }
})().catch((e: any) => {
  Sentry.captureException(e);
  console.error(
    `Unexpected error encountered starting realm, stopping server`,
    e,
  );
  process.exit(1);
});

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
