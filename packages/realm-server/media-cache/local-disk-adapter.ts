// Local-disk MediaCache object store for dev and tests. Objects live at
// `<dir>/<key[0..2]>/<key>` — the two-character fan-out keeps any one
// directory from accumulating every object. No metadata is stored beside the
// bytes: the ledger's `content_type` column is the serving-path source of
// truth, so `head` reports size only.

import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  MediaCacheAdapter,
  MediaObjectStat,
} from '@cardstack/runtime-common';

export class LocalDiskMediaCacheAdapter implements MediaCacheAdapter {
  #dir: string;

  constructor({ dir }: { dir: string }) {
    this.#dir = dir;
  }

  private pathFor(key: string): string {
    return join(this.#dir, key.slice(0, 2), key);
  }

  async put(
    key: string,
    bytes: Uint8Array,
    _opts: { contentType: string },
  ): Promise<void> {
    let path = this.pathFor(key);
    // The key is a hash of the bytes, so an existing file under this key
    // already holds them — skip the write (dedupe-on-write).
    if (await this.head(key)) {
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    // Write-then-rename so a reader never sees a half-written object and a
    // crashed write leaves only a stray temp file, not a corrupt object. The
    // temp name carries the pid so two processes writing the same key (both
    // saw it absent) don't collide; rename is atomic, and last-writer-wins is
    // harmless because both hold the same bytes.
    let tempPath = `${path}.${process.pid}.tmp`;
    await writeFile(tempPath, bytes);
    await rename(tempPath, path);
  }

  async head(key: string): Promise<MediaObjectStat | undefined> {
    try {
      let stats = await stat(this.pathFor(key));
      return { size: stats.size };
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async getStream(key: string): Promise<AsyncIterable<Uint8Array> | undefined> {
    // Existence-check first: createReadStream reports a missing file only as
    // an async 'error' event, which would escape as an unhandled stream
    // error rather than this interface's `undefined`.
    if (!(await this.head(key))) {
      return undefined;
    }
    return createReadStream(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
