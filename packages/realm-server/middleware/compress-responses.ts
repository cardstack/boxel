import { Readable, type Transform } from 'node:stream';
import zlib from 'node:zlib';
import type Koa from 'koa';

// Compresses text responses for clients that accept it. A search answers with
// a JSON document whose prerendered HTML repeats the same theme styles and
// stylesheet links for every card, so it shrinks 20-fold or more: a 12-card
// search of 404 KB goes out as 18 KB. Brotli at a low quality where the client
// accepts it (fast enough for live responses), gzip otherwise.
//
// Left alone: event streams (they must flush event by event), partial
// content, HEAD, anything already encoded, and bodies under 1 KB. The ETag is
// kept as it is, so revalidation (If-None-Match, 304) works unchanged.
// `RESPONSE_COMPRESSION=false` turns it off.

const MIN_BYTES = 1024;
const COMPRESSIBLE =
  /^(text\/(?!event-stream)|application\/(json|vnd\.[\w.+-]*json|javascript|xml|[\w.+-]*\+json|[\w.+-]*\+xml)|image\/svg\+xml)/i;

// The encoding to use for `Accept-Encoding`: br, else gzip, skipping any
// listed with q=0.
function encodingFor(accept: string | undefined): 'br' | 'gzip' | undefined {
  if (!accept) return undefined;
  let accepted = new Set<string>();
  for (let part of accept.split(',')) {
    let [name, ...params] = part.trim().toLowerCase().split(';');
    let q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    if (q !== undefined && Number(q.slice(2)) === 0) continue;
    accepted.add(name.trim());
  }
  if (accepted.has('br')) return 'br';
  if (accepted.has('gzip')) return 'gzip';
  return undefined;
}

function compressor(encoding: 'br' | 'gzip'): Transform {
  return encoding === 'br'
    ? zlib.createBrotliCompress({
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
      })
    : zlib.createGzip({ level: 6 });
}

export function compressResponses(
  enabled = process.env.RESPONSE_COMPRESSION !== 'false',
): Koa.Middleware {
  return async function compressResponsesMiddleware(ctxt, next) {
    await next();
    if (!enabled) return;
    let type = ctxt.response.get('Content-Type');
    // A 304 carries the same cache key as the 200 it revalidates, so it
    // varies on Accept-Encoding too, though it has no body to compress.
    if (ctxt.status === 304 || (type && COMPRESSIBLE.test(type))) {
      ctxt.vary('Accept-Encoding');
    }
    if (ctxt.method === 'HEAD') return;
    let body = ctxt.body as unknown;
    if (body == null || ctxt.status === 204 || ctxt.status === 206) return;
    if (ctxt.response.get('Content-Encoding')) return;
    if (!type || !COMPRESSIBLE.test(type)) return;
    let encoding = encodingFor(ctxt.get('Accept-Encoding'));
    if (!encoding) return;
    if (typeof body === 'string' || Buffer.isBuffer(body)) {
      let bytes = typeof body === 'string' ? Buffer.from(body) : body;
      if (bytes.length < MIN_BYTES) return;
      ctxt.body =
        encoding === 'br'
          ? zlib.brotliCompressSync(bytes, {
              params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
            })
          : zlib.gzipSync(bytes, { level: 6 });
    } else if (body instanceof Readable) {
      let length = Number(ctxt.response.get('Content-Length'));
      if (Number.isFinite(length) && length > 0 && length < MIN_BYTES) return;
      let out = compressor(encoding);
      body.on('error', (e) => out.destroy(e));
      ctxt.body = body.pipe(out);
      ctxt.remove('Content-Length');
    } else {
      // An object Koa serialises as JSON.
      let bytes = Buffer.from(JSON.stringify(body));
      if (bytes.length < MIN_BYTES) return;
      ctxt.type = type;
      ctxt.body =
        encoding === 'br'
          ? zlib.brotliCompressSync(bytes, {
              params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
            })
          : zlib.gzipSync(bytes, { level: 6 });
    }
    ctxt.set('Content-Encoding', encoding);
  };
}
