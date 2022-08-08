import { Realm } from "@cardstack/runtime-common";
import { NodeAdapter } from "./node-realm";
import yargs from "yargs";
import { createRealmServer } from "./server";
import { resolve } from "path";

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

let realms: Realm[] = paths.map(
  (path, i) =>
    new Realm(
      String(urls[i]),
      new NodeAdapter(resolve(String(path))),
      baseRealmURL
    )
);

let server = createRealmServer(realms);
server.listen(port);
console.log(
  `Realm server listening on port ${port} with base realm of ${baseRealmURL}:`
);
for (let [index, { url }] of realms.entries()) {
  console.log(`  ${paths[index]} => ${url}`);
}
