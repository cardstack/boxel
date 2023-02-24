import http, { IncomingMessage, ServerResponse } from "http";
import { Loader, Realm } from "@cardstack/runtime-common";
import { webStreamToText } from "@cardstack/runtime-common/stream";
import { Readable } from "stream";
import { setupCloseHandler } from "./node-realm";
import "@cardstack/runtime-common/externals-global";
import log from "loglevel";

let requestLog = log.getLogger("realm:requests");

export interface RealmConfig {
  realmURL: string;
  path: string;
}

export function createRealmServer(realms: Realm[]) {
  detectRealmCollision(realms);

  let server = http.createServer(async (req, res) => {
    if (process.env["ECS_CONTAINER_METADATA_URI_V4"]) {
      res.setHeader(
        "X-ECS-Container-Metadata-URI-v4",
        process.env["ECS_CONTAINER_METADATA_URI_V4"]
      );
    }

    res.on("finish", () => {
      requestLog.info(`${req.method} ${req.url}: ${res.statusCode}`);
      requestLog.debug(JSON.stringify(req.headers));
    });

    let isStreaming = false;
    try {
      if (handleCors(req, res)) {
        return;
      }
      if (!req.url) {
        throw new Error(`bug: missing URL in request`);
      }

      // Respond to AWS ELB health check
      if (requestIsHealthCheck(req)) {
        res.statusCode = 200;
        res.statusMessage = "OK";
        res.write("OK");
        res.end();
        return;
      }

      let protocol =
        req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
      let fullRequestUrl = new URL(
        `${protocol}://${req.headers.host}${req.url}`
      );
      let reversedResolution = Loader.reverseResolution(fullRequestUrl.href);

      requestLog.debug(
        `Looking for realm to handle request with full URL: ${fullRequestUrl.href} (reversed: ${reversedResolution.href})`
      );

      let realm = realms.find((r) => {
        let inRealm = r.paths.inRealm(reversedResolution);

        requestLog.debug(
          `In realm ${JSON.stringify({
            url: r.url,
            paths: r.paths,
          })}: ${inRealm}`
        );
        return inRealm;
      });

      if (!realm) {
        res.statusCode = 404;
        res.statusMessage = "Not Found";
        res.end();
        return;
      }

      let reqBody = await nodeStreamToText(req);

      let request = new Request(reversedResolution.href, {
        method: req.method,
        headers: req.headers as { [name: string]: string },
        ...(reqBody ? { body: reqBody } : {}),
      });

      setupCloseHandler(res, request);

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

async function nodeStreamToText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  // the types for Readable have not caught up to the fact these are async generators
  for await (const chunk of stream as any) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function detectRealmCollision(realms: Realm[]): void {
  let collisions: string[] = [];
  let realmsURLs = realms.map(({ url }) => ({
    url,
    path: new URL(url).pathname,
  }));
  for (let realmA of realmsURLs) {
    for (let realmB of realmsURLs) {
      if (realmA.path.length > realmB.path.length) {
        if (realmA.path.startsWith(realmB.path)) {
          collisions.push(`${realmA.url} collides with ${realmB.url}`);
        }
      }
    }
  }
  if (collisions.length > 0) {
    throw new Error(
      `Cannot start realm server--realm route collisions detected: ${JSON.stringify(
        collisions
      )}`
    );
  }
}

function requestIsHealthCheck(req: http.IncomingMessage) {
  return (
    req.url === "/" &&
    req.method === "GET" &&
    req.headers["user-agent"]?.startsWith("ELB-HealthChecker")
  );
}
