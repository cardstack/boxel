import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';

// A stand-in for an outside vendor, on a real socket, for tests of the
// outbound client and the proxies built on it. It records every request it
// receives and answers by path:
//
//   /echo                   200 with the request it received as JSON
//   /status/<code>          <code> with a small JSON body
//   /large?bytes=N          N bytes of JSON-string body, Content-Length declared
//   /gzip-bomb?bytes=N      N zero bytes gzip-compressed; the declared length is
//                           the compressed size
//   /redirect?to=<url>&status=<3xx>
//                           a redirect to <url> (default 302)
//   /slow?ms=N              200 after N milliseconds
//   /sse?cost=<usd>         an OpenRouter-shaped event stream ending in [DONE];
//                           cost=none leaves the cost out, as a cancelled
//                           stream does
//   /reflect-credential     200 whose body is the credential it received, bare
//                           and not JSON: the `key` query parameter, else the
//                           Authorization header without its scheme
//   /respond                answers exactly as the POSTed `StubVendorResponse`
//                           says: status, headers, and the body as separate
//                           writes, optionally gzipped, optionally cut off
//   /completion?bytes=N&cost=<usd>&hold=1&truncate=1
//                           an OpenRouter-shaped JSON completion whose message
//                           carries N bytes of base64, with the generation id
//                           first and the usage last. With `hold`, everything
//                           up to the usage is sent and the rest waits for
//                           `releaseHeld()`. With `truncate`, the connection
//                           is dropped where the usage would start
//   /not-json               502 with an HTML body
//   /google-token           a stand-in for Google's OAuth token endpoint: a
//                           JWT-bearer exchange answers the next of
//                           `googleTokenAnswers` (each used once), or, with
//                           none queued, 200 with a fresh access token
//                           `stub-access-<n>` that lives `googleTokenLifetime`
//                           seconds. A request that isn't a JWT-bearer grant
//                           answers 400 `invalid_request`

export interface StubVendorRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface StubVendor {
  url: string;
  // The same server under its other loopback name, a different origin.
  alternateUrl: string;
  requests: StubVendorRequest[];
  // Sends the rest of every response `hold` is keeping back.
  releaseHeld(): void;
  // How many responses the receiving side closed before they were finished.
  abandonedResponses(): number;
  // What `/google-token` answers next, in order, before it goes back to
  // minting tokens.
  googleTokenAnswers: { status: number; body: Record<string, unknown> }[];
  // The `expires_in` of each token `/google-token` mints.
  googleTokenLifetime: number;
  // The access tokens `/google-token` has minted, in order.
  googleTokensMinted: string[];
  close(): Promise<void>;
}

export interface StubVendorResponse {
  status?: number;
  headers?: Record<string, string>;
  // Each written on its own, a short pause apart, so each reaches the
  // client as a separate read. Strings are written as UTF-8; arrays of
  // numbers as raw bytes.
  chunks: (string | number[])[];
  // Gzip the whole body and send the compressed bytes split at the same
  // proportions as `chunks`.
  gzip?: boolean;
  // Destroy the connection after the last chunk instead of ending the body,
  // as a stream stopped partway would.
  cutOff?: boolean;
}

const CHUNK_PAUSE_MS = 20;

async function respondAsSpecified(
  res: http.ServerResponse,
  spec: StubVendorResponse,
) {
  let parts = spec.chunks.map((chunk) =>
    typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk),
  );
  let headers = { ...(spec.headers ?? {}) };
  if (spec.gzip) {
    let whole = zlib.gzipSync(Buffer.concat(parts));
    let total = parts.reduce((sum, part) => sum + part.length, 0) || 1;
    let offset = 0;
    parts = parts.map((part, index) => {
      let end =
        index === parts.length - 1
          ? whole.length
          : offset + Math.round((part.length / total) * whole.length);
      let slice = whole.subarray(offset, end);
      offset = end;
      return slice;
    });
    headers['content-encoding'] = 'gzip';
  }
  res.writeHead(spec.status ?? 200, headers);
  for (let part of parts) {
    res.write(part);
    await new Promise((resolve) => setTimeout(resolve, CHUNK_PAUSE_MS));
  }
  if (spec.cutOff) {
    res.destroy();
  } else {
    res.end();
  }
}

function numberParam(url: URL, name: string, fallback: number): number {
  let raw = url.searchParams.get(name);
  if (raw === null) {
    return fallback;
  }
  let value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// `port` fixes the port, for a test whose vendor URL is written into a card
// module before the vendor starts. Absent, any free one.
export async function startStubVendor({
  port = 0,
}: { port?: number } = {}): Promise<StubVendor> {
  let requests: StubVendorRequest[] = [];
  // Filled in once the server is listening; the request handler reads the
  // token endpoint's settings from it.
  let vendor = {
    googleTokenAnswers: [],
    googleTokenLifetime: 3600,
    googleTokensMinted: [],
  } as unknown as StubVendor;
  let held: (() => void)[] = [];
  let abandoned = 0;
  let server = http.createServer((req, res) => {
    let chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let url = new URL(req.url ?? '/', 'http://stub-vendor');
      let received: StubVendorRequest = {
        method: req.method ?? 'GET',
        path: url.pathname + url.search,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(received);

      let statusMatch = /^\/status\/(\d{3})$/.exec(url.pathname);
      if (url.pathname === '/respond') {
        void respondAsSpecified(res, JSON.parse(received.body));
      } else if (url.pathname === '/echo') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(received));
      } else if (statusMatch) {
        let status = Number(statusMatch[1]);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status }));
      } else if (url.pathname === '/large') {
        let bytes = numberParam(url, 'bytes', 1024);
        // A JSON string of `bytes` characters in total, quotes included.
        let body = Buffer.alloc(Math.max(bytes, 2), 'a');
        body[0] = 0x22;
        body[body.length - 1] = 0x22;
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-length': String(body.length),
        });
        res.end(body);
      } else if (url.pathname === '/gzip-bomb') {
        let bytes = numberParam(url, 'bytes', 1024 * 1024);
        let compressed = zlib.gzipSync(Buffer.alloc(bytes));
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-encoding': 'gzip',
          'content-length': String(compressed.length),
        });
        res.end(compressed);
      } else if (url.pathname === '/redirect') {
        res.writeHead(numberParam(url, 'status', 302), {
          location: url.searchParams.get('to') ?? '/echo',
        });
        res.end();
      } else if (url.pathname === '/slow') {
        let timer = setTimeout(
          () => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ slow: true }));
          },
          numberParam(url, 'ms', 1000),
        );
        res.on('close', () => clearTimeout(timer));
      } else if (url.pathname === '/reflect-credential') {
        let credential =
          url.searchParams.get('key') ??
          String(req.headers.authorization ?? '').replace(/^Bearer /, '');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(credential);
      } else if (url.pathname === '/sse') {
        let omitCost = url.searchParams.get('cost') === 'none';
        let cost = numberParam(url, 'cost', 0.002);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({ id: 'gen-stub', choices: [{ delta: { content: 'Hello' } }] })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: ' world' } }], ...(omitCost ? {} : { usage: { cost } }) })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
      } else if (url.pathname === '/completion') {
        let bytes = numberParam(url, 'bytes', 1024);
        let cost = numberParam(url, 'cost', 0.002);
        res.writeHead(200, { 'content-type': 'application/json' });
        let truncated = false;
        res.on('close', () => {
          if (!res.writableEnded && !truncated) {
            abandoned++;
          }
        });
        res.write('{"id":"gen-completion","choices":[{"message":{"content":"');
        // Truncation waits until the body so far has left, so the receiving
        // side gets the response started before the connection drops.
        let flushed = new Promise<void>((resolve) =>
          res.write(Buffer.alloc(bytes, 'A'), () => resolve()),
        );
        let finish = () => {
          if (url.searchParams.has('truncate')) {
            void flushed.then(() => {
              truncated = true;
              res.destroy();
            });
          } else {
            res.end(`"}}],"usage":{"cost":${JSON.stringify(cost)}}}`);
          }
        };
        if (url.searchParams.has('hold')) {
          held.push(finish);
        } else {
          finish();
        }
      } else if (url.pathname === '/google-token') {
        let form = new URLSearchParams(received.body);
        let queued = vendor.googleTokenAnswers.shift();
        let answer =
          form.get('grant_type') !==
            'urn:ietf:params:oauth:grant-type:jwt-bearer' ||
          !form.get('assertion')
            ? { status: 400, body: { error: 'invalid_request' } }
            : queued;
        if (!answer) {
          let token = `stub-access-${vendor.googleTokensMinted.length + 1}`;
          vendor.googleTokensMinted.push(token);
          answer = {
            status: 200,
            body: {
              access_token: token,
              expires_in: vendor.googleTokenLifetime,
              token_type: 'Bearer',
            },
          };
        }
        res.writeHead(answer.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(answer.body));
      } else if (url.pathname === '/not-json') {
        res.writeHead(502, { 'content-type': 'text/html' });
        res.end('<html><body>Bad gateway</body></html>');
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve()),
  );
  let { port: bound } = server.address() as AddressInfo;
  Object.assign(vendor, {
    url: `http://127.0.0.1:${bound}`,
    alternateUrl: `http://localhost:${bound}`,
    requests,
    abandonedResponses: () => abandoned,
    releaseHeld: () => {
      for (let finish of held.splice(0)) {
        finish();
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
  return vendor;
}
