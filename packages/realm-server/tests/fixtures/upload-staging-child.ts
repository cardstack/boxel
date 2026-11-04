import Koa from 'koa';
import http from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { UploadStaging } from '../../lib/upload-staging.ts';
import { fetchRequestFromContext } from '../../middleware/index.ts';
import { buildRequest } from '@cardstack/runtime-common/virtual-network';

let size = 200 * 1024 ** 2;
let target = join(process.argv[2], 'large.bin');
let staging = new UploadStaging(size * 2);
// What the upload retains, not the garbage it leaves for the collector: each
// sample collects first, so the numbers don't depend on when V8 chooses to.
let gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error('run with --expose-gc');
let maxBuffers = 0;
let maxHeap = 0;
let sample = () => {
  gc!();
  let usage = process.memoryUsage();
  maxBuffers = Math.max(maxBuffers, usage.arrayBuffers);
  maxHeap = Math.max(maxHeap, usage.heapUsed);
};
let resultHash: string | undefined;
let app = new Koa();
app.use(async (context) => {
  let request = await fetchRequestFromContext(context);
  let mapped = await buildRequest(
    'http://example.invalid/mapped',
    request,
    true,
  );
  let content = await staging.stage(
    target,
    mapped.body!,
    size,
    Number(mapped.headers.get('content-length')),
  );
  sample();
  resultHash = content.sha256;
  try {
    await staging.commit(target, content);
  } finally {
    await staging.dispose(content);
  }
  context.status = 204;
});
let server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
// The realm-server modules imported above take most of the heap on their own,
// so what is measured is the heap's growth while the upload runs, from a
// collected baseline.
gc();
let baseHeap = process.memoryUsage().heapUsed;
maxHeap = baseHeap;
try {
  let address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No TCP address');
  let response = new Promise<number | undefined>((resolve, reject) => {
    let upload = http.request(
      {
        host: '127.0.0.1',
        port: address.port,
        method: 'POST',
        path: '/upload',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': size,
        },
      },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
      },
    );
    upload.once('error', reject);
    void (async () => {
      let chunk = Buffer.alloc(64 * 1024, 0xa5);
      let hash = createHash('sha256');
      for (let sent = 0; sent < size; sent += chunk.length) {
        hash.update(chunk);
        if (!upload.write(chunk)) await once(upload, 'drain');
        // Every 10 MB sent, while the server is part-way through the body.
        if (sent % (160 * chunk.length) === 0) sample();
      }
      upload.end();
      await once(upload, 'response');
      if (hash.digest('hex') !== resultHash)
        throw new Error('Upload bytes changed');
    })().catch(reject);
  });
  if ((await response) !== 204) throw new Error('Upload failed');
  sample();
  process.stdout.write(
    JSON.stringify({
      size: (await stat(target)).size,
      maxBuffers,
      heapGrowth: maxHeap - baseHeap,
    }),
  );
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
