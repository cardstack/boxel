import Koa from "koa";
import bodyParser from "koa-bodyparser";
import { NodeRealm } from "./node-realm";
import { Realm } from "@cardstack/runtime-common";
import { resolve } from "path";
import { Response } from "node-fetch";

// Despite node 18's native support for fetch, the built-in node fetch Response
// does not seem to play nice with the Koa Response. The node-fetch Response
// seems to work nicely with the Koa Response, so continuing to polyfill the
// just the Response.
(globalThis.Response as any) = Response;

export class RealmServer {
  private path: string;

  constructor(path: string, private url: URL) {
    this.path = resolve(path);
  }

  start() {
    let realm = new Realm(this.url.href, new NodeRealm(this.path));
    let app = new Koa();
    app.use(bodyParser());
    app.use(async (ctx) => {
      let { req } = ctx;
      if (!req.url) {
        throw new Error(`bug: missing URL in request`);
      }
      let request = new Request(new URL(req.url, ctx.request.origin).href, {
        method: req.method,
        headers: req.headers as { [name: string]: string },
        ...(ctx.request.rawBody != null ? { body: ctx.request.rawBody } : {}),
      });
      let res = await realm.handle(request);
      ctx.response.status = res.status;
      ctx.response.message = res.statusText;
      ctx.response.set(Object.fromEntries([...res.headers.entries()]));

      if (res.body != null) {
        ctx.response.body = res.body;
      }
    });
    return app;
  }
}
