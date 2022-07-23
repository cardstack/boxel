import http, { IncomingMessage, ServerResponse } from "http";
import { NodeRealm } from "./node-realm";
import { Realm } from "@cardstack/runtime-common";
import { resolve } from "path";
import { streamToText as nodeStreamToText } from "./stream";
import { streamToText as webStreamToText } from "@cardstack/runtime-common/stream";
import { LocalPath, RealmPaths } from "@cardstack/runtime-common/paths";

export function createRealmServer(
  path: string,
  realmURL: string,
  baseRealmURL = "https://cardstack.com/base/"
) {
  path = resolve(path);
  let realm = new Realm(realmURL, new NodeRealm(path), baseRealmURL);
  let realmPath = new RealmPaths(realmURL);
  let server = http.createServer(async (req, res) => {
    let isStreaming = false;
    try {
      if (handleCors(req, res)) {
        return;
      }
      if (!req.url) {
        throw new Error(`bug: missing URL in request`);
      }
      // despite the name, req.url is actually the pathname for the request URL
      let local: LocalPath = req.url === "/" ? "" : req.url;
      let url =
        local.endsWith("/") || local === ""
          ? realmPath.directoryURL(local)
          : realmPath.fileURL(local);

      let reqBody = await nodeStreamToText(req);
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
      } else if (body instanceof ReadableStream) {
        // A quirk with native fetch Response in node is that it will be clever
        // and convert strings or buffers in the response.body into web-streams
        // automatically. This is not to be confused with actual file streams
        // that the Realm is creating. The node HTTP server does not play nice
        // with web-streams, so we will read these streams back into strings and
        // then include in our node ServerResponse. Actual node file streams
        // (i.e streams that we are intentionally creating in the Realm) will
        // not be handled here--those will be taken care of above.
        res.write(await webStreamToText(body));
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

function handleCors(req: IncomingMessage, res: ServerResponse): boolean {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (
    req.method === "OPTIONS" &&
    req.headers["access-control-request-method"]
  ) {
    // preflight request
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,DELETE,PATCH");
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}
