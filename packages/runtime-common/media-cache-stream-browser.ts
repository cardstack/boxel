// Browser stand-in for the node stream adapter. A browser-hosted realm never
// configures a MediaCacheAdapter, so media serving is unreachable there;
// throwing keeps that assumption loud instead of silently mis-serving.
export function toNodeStream(
  _stream: AsyncIterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  throw new Error('media cache streaming requires a node runtime');
}
