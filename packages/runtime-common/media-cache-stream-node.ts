import { Readable } from 'node:stream';

// Adapts a MediaCacheAdapter stream to the one body shape the realm-server's
// Koa bridge streams verbatim: a node Readable riding
// `ResponseWithNodeStream.nodeStream`. Every other body shape is drained
// through text by the bridge, which corrupts binary — so serving code must
// route ALL media bytes through this, never through a Response body. An
// adapter stream that already is a Readable passes through untouched.
export function toNodeStream(
  stream: AsyncIterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  if (typeof (stream as Readable).pipe === 'function') {
    return stream;
  }
  return Readable.from(stream);
}
