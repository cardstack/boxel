import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createPublicReferenceCache } from '../lib/public-reference-cache.ts';
import { parsePublicReferenceURLs } from '@cardstack/runtime-common/public-reference-fetch';

let port = Number(process.env.BOXEL_PUBLIC_REFERENCE_CACHE_PORT);
let directory = process.env.BOXEL_PUBLIC_REFERENCE_CACHE_DIR;
let savePublicSnapshots =
  process.env.BOXEL_PUBLIC_REFERENCE_SAVE_PUBLIC_SNAPSHOTS ?? 'false';
if (!['true', 'false'].includes(savePublicSnapshots)) {
  throw new Error('Public reference snapshot setting must be true or false');
}
if (!directory || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error('Configure the public reference cache directory and port');
}
let input: unknown = JSON.parse(
  process.env.BOXEL_PUBLIC_REFERENCE_REALMS ?? 'null',
);
let cache = await createPublicReferenceCache({
  directory,
  realmURLs: parsePublicReferenceURLs(input).map((url) => url.href),
  savePublicSnapshots: savePublicSnapshots === 'true',
});
let server = createServer(async (incoming, outgoing) => {
  try {
    let method = incoming.method ?? 'GET';
    let headers = new Headers();
    for (let [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined)
        headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    let init: RequestInit & { duplex: 'half' } = {
      method,
      headers,
      duplex: 'half',
      ...(method === 'GET' || method === 'HEAD'
        ? {}
        : {
            body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
          }),
    };
    let response = await cache.fetch(
      new Request(new URL(incoming.url ?? '/', 'http://127.0.0.1'), init),
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end('Public reference cache request failed');
  }
});
server.listen(port, '127.0.0.1');
for (let signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.closeAllConnections();
    server.close();
    void cache.close().finally(() => process.exit(0));
  });
}
