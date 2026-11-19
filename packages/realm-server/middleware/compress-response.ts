import type Koa from 'koa';
import { Readable } from 'stream';
import { promisify } from 'util';
import zlib from 'zlib';

import { X_BOXEL_UNCOMPRESSED_LENGTH_HEADER } from '@cardstack/runtime-common';

import { servesStoredBytes } from './index.ts';

const brotliCompress = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

// Below this a compressed body saves too little to be worth the CPU, and
// small JSON can come out larger than it went in.
export const MIN_COMPRESSIBLE_BYTES = 1024;

// Brotli's default quality, 11, is meant for compressing static assets ahead
// of time: a 265 KB search document takes about 300 ms at quality 11, and
// about 2 ms at quality 4. Quality 4 also comes out smaller than gzip level 6
// on card and search documents (12× against 9× on that search document), in
// less time.
const BROTLI_QUALITY = 4;
const GZIP_LEVEL = 6;

// Server endpoints are path segments that start with `_`. They are left
// uncompressed unless they are named here. The ones named return large
// documents (search results, realm info and index listings) and never a
// credential. Every other one, including each that mints or returns a token
// (`_session`, `_server-session`, `_realm-auth`, `_delegate-session`, the
// OAuth provider), is sent as it is. A compressed body's length depends on
// what it repeats, which is the leak a BREACH-style attack measures when a
// response carries both a secret and input an attacker chose.
const COMPRESSED_ENDPOINTS = new Set([
  '_search',
  '_federated-search',
  '_federated-info',
  '_federated-types',
  '_federated-index-counts',
  '_info',
  '_mtimes',
  '_types',
  '_dependencies',
  '_card-dependencies',
  '_indexing-errors',
  '_catalog-realms',
  '_public-realms',
]);

function isCompressibleType(type: string): boolean {
  return (
    type.startsWith('text/') ||
    type === 'application/json' ||
    type.endsWith('+json') ||
    type === 'application/javascript' ||
    type === 'application/xml' ||
    type.endsWith('+xml')
  );
}

function isCompressiblePath(path: string): boolean {
  for (let segment of path.split('/')) {
    if (segment.startsWith('_') && !COMPRESSED_ENDPOINTS.has(segment)) {
      return false;
    }
  }
  return true;
}

// The body as the bytes Koa would send, or undefined for a body this
// middleware leaves alone. A stream is always left alone: it may be an event
// stream whose events must reach the client as they happen, or a file that
// streams so it is never held in memory whole.
function bodyBytes(body: unknown): Buffer | undefined {
  if (typeof body === 'string') {
    return Buffer.from(body);
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (
    body != null &&
    typeof body === 'object' &&
    !(body instanceof Readable) &&
    !(body instanceof ReadableStream) &&
    !ArrayBuffer.isView(body)
  ) {
    // Koa sends any other object as JSON.
    return Buffer.from(JSON.stringify(body));
  }
  return undefined;
}

// Compresses a response body with brotli, or gzip for a client that does not
// accept brotli, when the client accepts either and the body is text the
// server already holds in memory: card and search documents, modules, HTML.
//
// Compressed bodies replace the response body whole, so `Content-Length` is
// the compressed length. A response's ETag is unchanged: it names the
// document, and `Vary: Accept-Encoding` tells a cache which encoding it
// stored. A validator still matches when the client sends it back, since it
// does not change with the encoding. Ranges are never compressed, so a byte
// range always counts bytes of the identity body.
//
// Placed outside the host URL translation, so it compresses the body that
// translation produced.
export async function compressResponse(ctxt: Koa.Context, next: Koa.Next) {
  await next();

  // A HEAD is compressed like its GET when it has a body, so it reports the
  // same Content-Encoding and Content-Length; Koa never sends the body.
  if (
    ctxt.respond === false ||
    ctxt.status === 206 ||
    ctxt.get('Range') ||
    servesStoredBytes(ctxt) ||
    !isCompressibleType(ctxt.response.type) ||
    !isCompressiblePath(ctxt.path) ||
    // Koa reads an absent header as ''.
    !['', 'identity'].includes(ctxt.response.get('Content-Encoding')) ||
    /\bno-transform\b/i.test(ctxt.response.get('Cache-Control'))
  ) {
    return;
  }
  let bytes = bodyBytes(ctxt.body);
  if (!bytes || bytes.length < MIN_COMPRESSIBLE_BYTES) {
    return;
  }

  // The same URL is sent compressed or not depending on this header, so a
  // cache must key on it whichever this client gets.
  ctxt.vary('Accept-Encoding');

  let encoding = ctxt.acceptsEncodings('br', 'gzip', 'identity');
  if (encoding !== 'br' && encoding !== 'gzip') {
    return;
  }

  let compressed: Buffer;
  try {
    compressed =
      encoding === 'br'
        ? await brotliCompress(bytes, {
            params: {
              [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
              [zlib.constants.BROTLI_PARAM_MODE]:
                zlib.constants.BROTLI_MODE_TEXT,
              [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
            },
          })
        : await gzip(bytes, { level: GZIP_LEVEL });
  } catch {
    // The identity body is still a correct response.
    return;
  }

  // Assigning the body sets Content-Length; Content-Type is already set and
  // Koa keeps it.
  ctxt.body = compressed;
  ctxt.set('Content-Encoding', encoding);
  ctxt.set(X_BOXEL_UNCOMPRESSED_LENGTH_HEADER, String(bytes.length));
}
