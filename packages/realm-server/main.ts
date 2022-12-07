import { Realm, type FastBootInstance } from "@cardstack/runtime-common";
import { Loader } from "@cardstack/runtime-common/loader";
import { NodeAdapter } from "./node-realm";
import yargs from "yargs";
import { createRealmServer } from "./server";
import { resolve } from "path";
//@ts-expect-error no types for fastboot
import FastBoot from "fastboot";

let {
  port,
  path: paths,
  fromUrl: fromUrls,
  toUrl: toUrls,
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

let urlMappings = fromUrls.map((fromUrl, i) => [
  new URL(String(fromUrl), `http://localhost:${port}`),
  new URL(String(toUrls[i]), `http://localhost:${port}`),
]);
for (let [from, to] of urlMappings) {
  Loader.addURLMapping(from, to);
}
let hrefs = urlMappings.map(([from, to]) => [from.href, to.href]);
let realms: Realm[] = paths.map((path, i) => {
  return new Realm(
    hrefs[i][0],
    new NodeAdapter(resolve(String(path))),
    visit,
    makeFastBoot
  );
});

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

function makeFastBoot(loader: Loader) {
  // TODO this should be a CLI argument (perhaps ../host/dist can be the default value)
  let distPath = resolve(__dirname, "..", "host", "dist");
  return new FastBoot({
    distPath,
    resilient: false,
    buildSandboxGlobals(defaultGlobals: any) {
      return Object.assign({}, defaultGlobals, {
        URL: globalThis.URL,
        Request: globalThis.Request,
        fetch: loader.fetch.bind(loader),
        btoa,
      });
    },
  }) as FastBootInstance;
}

async function visit(url: string, fastboot: FastBootInstance) {
  let page = await fastboot.visit(url, {
    request: { headers: { host: "localhost:4200" } },
  });
  let html = page.html();
  return html;
}

function btoa(str: string | Buffer) {
  let buffer;
  if (str instanceof Buffer) {
    buffer = str;
  } else {
    buffer = Buffer.from(str.toString(), "binary");
  }
  return buffer.toString("base64");
}
