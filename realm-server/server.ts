import Koa from "koa";
import { NodeRealm } from "./node-realm";
import { Realm } from "@cardstack/runtime-common";
import { resolve } from "path";
import fetch, { Request, Response } from "node-fetch";

// Polyfill fetch API
(globalThis.Request as any) = Request;
(globalThis.Response as any) = Response;
(globalThis.fetch as any) = fetch;

export class RealmServer {
  private path: string;

  constructor(path: string, private url: URL) {
    this.path = resolve(path);
  }

  start() {
    let realm = new Realm(this.url.href, new NodeRealm(this.path));
    let app = new Koa();
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
    });
    return app;
  }
}
