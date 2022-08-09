import { Realm } from "@cardstack/runtime-common";
import { NodeAdapter } from "./node-realm";
import yargs from "yargs";
import { createRealmServer } from "./server";
import { resolve } from "path";

let {
  port,
  path: paths,
  url: urls,
  canonicalURL: canonicalURLs,
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
    canonicalURL: {
      description:
        "the canonical URL for the realm (which may be different than the URL the realm is hosted at). If this is set to an empty value then it will default to the 'url' parameter",
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

if (!(urls.length === paths.length && urls.length === canonicalURLs.length)) {
  console.error(
    `Mismatched number of paths, URLs, and canonicalURLs specified. Each --path argument must be paired with a --url argument and a --canonicalURL argument`
  );
  process.exit(-1);
}

let realms: Realm[] = paths.map((path, i) => {
  let url = new URL(String(urls[i]), `http://localhost:${port}`).href;
  let canonicalURL: string = new URL(
    String(canonicalURLs[i] || url),
    `http://localhost:${port}`
  ).href;
  return new Realm(canonicalURL, new NodeAdapter(resolve(String(path))), {
    baseRealmURL,
    hostedAtURL: url,
  });
});

let server = createRealmServer(realms);
server.listen(port);
console.log(
  `Realm server listening on port ${port} with base realm of ${baseRealmURL}:`
);
for (let [index, { url, hostedAtURL }] of realms.entries()) {
  console.log(`  ${paths[index]} => ${hostedAtURL} canonical url (${url})`);
}
