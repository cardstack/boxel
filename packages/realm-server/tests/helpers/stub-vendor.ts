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
//   /sse?cost=<usd>         an OpenRouter-shaped event stream ending in [DONE]
//   /reflect-credential     200 whose body is the credential it received, bare
//                           and not JSON: the `key` query parameter, else the
//                           Authorization header without its scheme
//   /respond                answers exactly as the POSTed `StubVendorResponse`
//                           says: status, headers, and the body as separate
//                           writes, optionally gzipped, optionally cut off

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

export async function startStubVendor(): Promise<StubVendor> {
  let requests: StubVendorRequest[] = [];
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
        let cost = numberParam(url, 'cost', 0.002);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({ id: 'gen-stub', choices: [{ delta: { content: 'Hello' } }] })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: ' world' } }], usage: { cost } })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  let { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    alternateUrl: `http://localhost:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
