import { Readable } from 'node:stream';
import type { MediaCacheAdapter } from '@cardstack/runtime-common';

// In-memory MediaCacheAdapter for tests: real bytes behind the interface,
// observable deletes, scriptable per-key delete failures, and a switch
// between the two stream shapes the serving layer handles (a node Readable,
// which streams via `nodeStream`, and a bare async iterable, which is
// buffered).
export class FakeMediaCacheAdapter implements MediaCacheAdapter {
  objects = new Map<string, Uint8Array>();
  deleted: string[] = [];
  failDeletesFor = new Set<string>();
  streamShape: 'readable' | 'iterable' = 'readable';

  async put(key: string, bytes: Uint8Array, _opts: { contentType: string }) {
    if (!this.objects.has(key)) {
      this.objects.set(key, bytes);
    }
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
      yield bytes;
    })();
  }
  async delete(key: string) {
    if (this.failDeletesFor.has(key)) {
      throw new Error(`simulated delete failure for ${key}`);
    }
    this.deleted.push(key);
    this.objects.delete(key);
  }
}
