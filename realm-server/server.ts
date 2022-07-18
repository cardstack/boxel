import yargs from "yargs";
import Koa from "koa";
import { NodeRealm } from "./node-realm";
import { Realm } from "@cardstack/runtime-common";
import { resolve } from "path";
import fetch, { Request, Response } from "node-fetch";

// Polyfill fetch API
(globalThis.Request as any) = Request;
(globalThis.Response as any) = Response;
(globalThis.fetch as any) = fetch;

let { port, path, url } = yargs(process.argv.slice(2))
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
      type: "string",
    },
    path: {
      description: "realm directory path",
      demandOption: true,
      type: "string",
    },
  })
  .parseSync();

console.log(
  `realm server listening on port ${port} as url ${url} with realm dir ${path}`
);

let realmAdapter = new NodeRealm(resolve(path));
let realm = new Realm(url, realmAdapter);

const app = new Koa();
app.use(async (ctx) => {
  let { req } = ctx;
  if (!req.url) {
    throw new Error(`bug: missing URL in request`);
  }
  let request = new Request(new URL(req.url, ctx.request.origin).href, {
    method: req.method,
    headers: req.headers as { [name: string]: string },
  });
  let res = await realm.handle(request as any); // The node-fetch Request type doesn't seem to line up with the actual fetch Request type
  ctx.status = res.status;
  ctx.message = res.statusText;
  ctx.body = res.body;
  return;
});

app.listen(port);
