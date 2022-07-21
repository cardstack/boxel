import http from "http";
import { NodeRealm } from "./node-realm";
import { Realm } from "@cardstack/runtime-common";
import { resolve } from "path";
import { Response } from "node-fetch";
import { Readable } from "stream";
import { LocalPath, RealmPaths } from "@cardstack/runtime-common/paths";

// Despite node 18's native support for fetch, the built-in node fetch Response
// does not seem to play nice with the Koa Response. The node-fetch Response
// seems to work nicely with the Koa Response, so continuing to polyfill the
// just the Response.
(globalThis.Response as any) = Response;

export function createRealmServer(path: string, realmURL: URL) {
  path = resolve(path);
  let realm = new Realm(realmURL.href, new NodeRealm(path));
  let realmPath = new RealmPaths(realmURL);
  let server = http.createServer(async (req, res) => {
    let isStreaming = false;
    try {
      if (!req.url) {
        throw new Error(`bug: missing URL in request`);
      }
      let local: LocalPath = req.url === "/" ? "" : req.url; // this is actually the pathname for the request URL
      let url =
        local.endsWith("/") || local === ""
          ? realmPath.directoryURL(local)
          : realmPath.fileURL(local);

      let reqBody = await readStreamAsString(req);
      let request = new Request(url.href, {
        method: req.method,
        headers: req.headers as { [name: string]: string },
        ...(reqBody ? { body: reqBody } : {}),
      });
      let { status, statusText, headers, body, nodeStream } =
        await realm.handle(request);
      res.statusCode = status;
      res.statusMessage = statusText;
      for (let [header, value] of headers.entries()) {
        res.setHeader(header, value);
      }

      if (nodeStream) {
        isStreaming = true;
        nodeStream.pipe(res);
      } else if (body != null) {
        res.write(body);
      }
    } catch (e) {
      console.error("Unexpected server error: ", e);
      res.statusCode = 500;
      res.statusMessage = e.message;
    } finally {
      // the node pipe takes care of ending the response for us, so we only have
      // to do this when we are not piping
      if (!isStreaming) {
        res.end();
      }
    }
  });
  return server;
}

async function readStreamAsString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as any) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}
