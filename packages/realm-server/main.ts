import { Realm } from "@cardstack/runtime-common";
import { Loader } from "@cardstack/runtime-common/loader";
import { NodeAdapter } from "./node-realm";
import yargs from "yargs";
import { createRealmServer } from "./server";
import { resolve, join } from "path";
import { makeFastBootIndexRunner } from "./fastboot";
import { RunnerOptionsManager } from "@cardstack/runtime-common/search-index";
import log, { LogLevelNames } from 'loglevel';

let {
  port,
  dist = join(__dirname, "..", "host", "dist"),
  path: paths,
  fromUrl: fromUrls,
  toUrl: toUrls,
  logLevel,
} = yargs(process.argv.slice(2))
  .usage("Start realm server")
  .options({
    port: {
      description: "port number",
      demandOption: true,
      type: "number",
    },
    fromUrl: {
      description: "the source of the realm URL proxy",
      demandOption: true,
      type: "array",
    },
    toUrl: {
      description: "the target of the realm URL proxy",
      demandOption: true,
      type: "array",
    },
    path: {
      description: "realm directory path",
      demandOption: true,
      type: "array",
    },
    dist: {
      description:
        "the dist/ folder of the host app. Defaults to '../host/dist'",
      type: "string",
    },
    logLevel: {
      description:
        "how detailed log output should be",
      choices: ['trace', 'debug', 'info', 'warn', 'error'],
      default: 'debug'
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
      { deferStartUp: true }
    )
  );
}

let server = createRealmServer(realms);
server.listen(port);
console.log(`Realm server listening on port ${port}:`);
let additionalMappings = hrefs.slice(paths.length);
for (let [index, { url }] of realms.entries()) {
  console.log(`    ${url} => ${hrefs[index][1]}, serving path ${paths[index]}`);
}
if (additionalMappings.length) {
  console.log("Additional URL mappings:");
  for (let [from, to] of additionalMappings) {
    console.log(`    ${from} => ${to}`);
  }
}
console.log(`Using host dist path: '${distPath}' for card pre-rendering`);

(async () => {
  for (let realm of realms) {
    console.log(`Starting realm ${realm.url}...`);
    await realm.start();
    console.log(
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
