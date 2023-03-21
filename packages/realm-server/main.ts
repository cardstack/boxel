import { Realm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { NodeAdapter } from './node-realm';
import yargs from 'yargs';
import { RealmServer } from './server';
import { resolve, join } from 'path';
import { makeFastBootIndexRunner } from './fastboot';
import { RunnerOptionsManager } from '@cardstack/runtime-common/search-index';
import { readFileSync } from 'fs-extra';
import log, { LogLevelNames } from 'loglevel';

let {
  port,
  dist = join(__dirname, '..', 'host', 'dist'),
  path: paths,
  fromUrl: fromUrls,
  toUrl: toUrls,
  logLevel,
  requestLogLevel,
  useTestingDomain,
  hostLocalRealm,
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
    dist: {
      description:
        "the dist/ folder of the host app. Defaults to '../host/dist'",
      type: 'string',
    },
    useTestingDomain: {
      description:
        'relaxes document domain rules so that cross origin scripting can be used for test assertions across iframe boundaries',
      type: 'boolean',
    },
    hostLocalRealm: {
      description: `Provide a local realm hosted at /local`,
      type: 'boolean',
      default: false,
    },
    logLevel: {
      description: 'how detailed log output should be',
      choices: ['trace', 'debug', 'info', 'warn', 'error'],
      default: 'debug',
    },
    requestLogLevel: {
      description: 'how detailed request log output should be',
      choices: ['trace', 'debug', 'info', 'warn', 'error'],
      default: 'info',
    },
  })
  .parseSync();

if (!(fromUrls.length === toUrls.length)) {
  console.error(
    `Mismatched number of URLs, the --fromUrl params must be matched to the --toUrl params`
  );
  process.exit(-1);
}
if (fromUrls.length < paths.length) {
  console.error(
    `not enough url pairs were provided to satisfy the paths provided. There must be at least one --fromUrl/--toUrl pair for each --path parameter`
  );
  process.exit(-1);
}

log.setLevel(logLevel as LogLevelNames);
log.info(`Set log level to ${logLevel}`);

let requestLog = log.getLogger('realm:requests');
requestLog.setLevel(requestLogLevel as LogLevelNames);
requestLog.info(`Set request log level to ${requestLogLevel}`);

let urlMappings = fromUrls.map((fromUrl, i) => [
  new URL(String(fromUrl), `http://localhost:${port}`),
  new URL(String(toUrls[i]), `http://localhost:${port}`),
]);
for (let [from, to] of urlMappings) {
  Loader.addURLMapping(from, to);
}
let hrefs = urlMappings.map(([from, to]) => [from.href, to.href]);
let distPath = resolve(dist);

let realms: Realm[] = [];
for (let [i, path] of paths.entries()) {
  let manager = new RunnerOptionsManager();
  let getRunner = makeFastBootIndexRunner(
    distPath,
    manager.getOptions.bind(manager)
  );
  realms.push(
    new Realm(
      hrefs[i][0],
      new NodeAdapter(resolve(String(path))),
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
      }
    )
  );
}

let server = new RealmServer(realms, { hostLocalRealm });
server.listen(port);
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
log.info(`Using host dist path: '${distPath}' for card pre-rendering`);

(async () => {
  for (let realm of realms) {
    log.info(`Starting realm ${realm.url}...`);
    await realm.start();
    log.info(
      `Realm ${realm.url} has started (${JSON.stringify(
        realm.searchIndex.stats,
        null,
        2
      )})`
    );
  }
})().catch((e: any) => {
  console.error(
    `Unexpected error encountered starting realm, stopping server`,
    e
  );
  process.exit(1);
});
