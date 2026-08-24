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
    return (async function* () {
      yield bytes.slice(0, 3);
      yield bytes.slice(3);
    })();
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}
