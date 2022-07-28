import yargs from "yargs";
import { createRealmServer, RealmConfig } from "./server";

let {
  port,
  path: paths,
  url: urls,
  baseRealmURL,
} = yargs(process.argv.slice(2))
  .usage("Start realm server")
  .options({
    port: {
      description: "port number",
      demandOption: true,
      type: "number",
    },
    url: {
      description: "realm URL",
      demandOption: true,
      type: "array",
    },
    path: {
      description: "realm directory path",
      demandOption: true,
      type: "array",
    },
    baseRealmURL: {
      description: "the URL the base realm is served from (optional)",
      demandOption: true,
      type: "string",
    },
  })
  .parseSync();

if (urls.length !== paths.length) {
  console.error(
    `Mismatched number of paths and URLs specified. Each --path argument must be paired with a --url argument`
  );
  process.exit(-1);
}

let configs: RealmConfig[] = paths.map((path, i) => ({
  realmURL: String(urls[i]),
  path: String(path),
}));

let server = createRealmServer(configs, baseRealmURL);
server.listen(port);
console.log(
  `Realm server listening on port ${port} with base realm of ${baseRealmURL}:`
);
for (let { realmURL, path } of configs) {
  console.log(`  ${path} => ${realmURL}`);
}
