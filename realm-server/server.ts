import http from "http";
import { NodeRealm } from "./node-realm";
import { Realm } from "@cardstack/runtime-common";
import { resolve } from "path";
import { streamToText as nodeStreamToText } from "./stream";
import { streamToText as webStreamToText } from "@cardstack/runtime-common/stream";
import { LocalPath, RealmPaths } from "@cardstack/runtime-common/paths";

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
        // since we are using native fetch Response in our Realm API, any
        // strings or buffers will be converted into web-streams automatically
        // in the fetch Response--this is not to be confused with actual file
        // streams that the Realm is creating. The node HTTP server does not
        // play nice with web-streams, so we will read these streams into
        // strings and then include in our node ServerResponse. Actual node file
        // streams will not be handled here--those will be taken care of above.
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
