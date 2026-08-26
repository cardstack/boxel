import type { MediaCacheAdapter } from '@cardstack/runtime-common';
import { logger } from '@cardstack/runtime-common';
import { S3MediaCacheAdapter } from './s3-adapter.ts';
import { LocalDiskMediaCacheAdapter } from './local-disk-adapter.ts';

export { S3MediaCacheAdapter } from './s3-adapter.ts';
export { LocalDiskMediaCacheAdapter } from './local-disk-adapter.ts';

const log = logger('media-cache');

// The process-level choice of MediaCache object store:
//   MEDIA_CACHE_BUCKET  → S3 (deployed environments; optional
//                         MEDIA_CACHE_KEY_PREFIX / MEDIA_CACHE_REGION)
//   MEDIA_CACHE_DIR     → local disk (dev / tests)
//   neither             → no store; media-cache tasks no-op.
// Bucket wins if both are set, so a deployed env var can't be shadowed by a
// stray local one.
export function createMediaCacheAdapterFromEnv():
  | MediaCacheAdapter
  | undefined {
  let bucket = process.env.MEDIA_CACHE_BUCKET?.trim();
  if (bucket) {
    return new S3MediaCacheAdapter({
      bucket,
      keyPrefix: process.env.MEDIA_CACHE_KEY_PREFIX?.trim() || '',
      region: process.env.MEDIA_CACHE_REGION?.trim() || undefined,
    });
  }
  let dir = process.env.MEDIA_CACHE_DIR?.trim();
  if (dir) {
    return new LocalDiskMediaCacheAdapter({ dir });
  }
  log.info(
    'neither MEDIA_CACHE_BUCKET nor MEDIA_CACHE_DIR is set; media cache is disabled for this process',
  );
  return undefined;
}
