import { Readable } from 'node:stream';
import type { MediaCacheAdapter } from '@cardstack/runtime-common';

// Minimal in-memory store: real bytes behind the MediaCacheAdapter
// interface, with a switch between the two stream shapes the serving layer
// handles (a node Readable, which passes through `toNodeStream`, and a bare
// async iterable, which it wraps).
export class FakeMediaCacheAdapter implements MediaCacheAdapter {
  objects = new Map<string, Uint8Array>();
  streamShape: 'readable' | 'iterable' = 'readable';

  async put(key: string, bytes: Uint8Array, _opts: { contentType: string }) {
    this.objects.set(key, bytes);
  }
  async head(key: string) {
    let bytes = this.objects.get(key);
    return bytes ? { size: bytes.length } : undefined;
  }
  async getStream(key: string) {
    let bytes = this.objects.get(key);
    if (!bytes) {
      return undefined;
    }
    if (this.streamShape === 'readable') {
      return Readable.from(Buffer.from(bytes));
    }
    // Yield in two chunks: a single-chunk generator can't distinguish an
    // implementation that wraps the whole iterable from one that reads only
    // its head, which is the bug the bare-async-iterable serving test exists
    // to catch. Split at the midpoint (min 1) so a payload shorter than a
    // fixed offset still crosses a real chunk boundary.
    return (async function* () {
      let mid = Math.max(1, Math.floor(bytes.length / 2));
      yield bytes.slice(0, mid);
      yield bytes.slice(mid);
    })();
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}
