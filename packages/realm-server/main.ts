import './setup-logger'; // This should be first
import { Realm, logger } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { NodeAdapter } from './node-realm';
import yargs from 'yargs';
import { RealmServer } from './server';
import { resolve, join } from 'path';
import { makeFastBootIndexRunner } from './fastboot';
import { RunnerOptionsManager } from '@cardstack/runtime-common/search-index';
import { readFileSync } from 'fs-extra';
import { shimExternals } from './lib/externals';
import fs from 'fs';

let {
  port,
  distDir = join(__dirname, '..', 'host', 'dist'),
  distURL,
  path: paths,
  fromUrl: fromUrls,
  toUrl: toUrls,
  useTestingDomain,
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
    distDir: {
      description:
        "the dist/ folder of the host app. Defaults to '../host/dist'",
      type: 'string',
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
  })
  .parseSync();

if (!(fromUrls.length === toUrls.length)) {
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

let log = logger('main');

let loader = new Loader();
shimExternals(loader);

let urlMappings = fromUrls.map((fromUrl, i) => [
  new URL(String(fromUrl), `http://localhost:${port}`),
  new URL(String(toUrls[i]), `http://localhost:${port}`),
]);
for (let [from, to] of urlMappings) {
  loader.addURLMapping(from, to);
}
let hrefs = urlMappings.map(([from, to]) => [from.href, to.href]);
let dist: string | URL;
if (distURL) {
  dist = new URL(distURL);
} else {
  dist = resolve(distDir);
}

(async () => {
  let realms: Realm[] = [];
  for (let [i, path] of paths.entries()) {
    let manager = new RunnerOptionsManager();
    let { getRunner, distPath } = await makeFastBootIndexRunner(
      dist,
      manager.getOptions.bind(manager),
    );
    realms.push(
      new Realm(
        hrefs[i][0],
        new NodeAdapter(resolve(String(path))),
        loader,
        getRunner,
        manager,
        async () => readFileSync(join(distPath, 'index.html')).toString(),
        {
          deferStartUp: true,
          ...(useTestingDomain
            ? {
                useTestingDomain,
              }
            : {}),
        },
      ),
    );
  }

  let server = new RealmServer(realms, {
    ...(distURL ? { assetsURL: new URL(distURL) } : {}),
  });

  // RealmPermissions expects REALM_USER_PERMISSIONS env var to be set. This is temporary until we start using a database to store user permissions.
  // For ease of development we are reading it from a file otherwise it needs to be set in the environment.
  if (
    process.env.NODE_ENV === 'development' &&
    !process.env.REALM_USER_PERMISSIONS
  ) {
    process.env.REALM_USER_PERMISSIONS = fs.readFileSync(
      '.realms.json',
      'utf-8',
    );
  }

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
  log.info(`Using host dist path: '${distDir}' for card pre-rendering`);

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
  console.error(
    `Unexpected error encountered starting realm, stopping server`,
    e,
  );
  process.exit(1);
});
