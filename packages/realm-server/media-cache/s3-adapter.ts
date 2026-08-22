// S3-backed MediaCache object store. The bucket holds only content-addressed
// derived media (screenshots); the `media_cache_ledger` table is the sole
// catalog of what's in here, so nothing in this adapter ever lists the
// bucket. Region/credential resolution mirrors `prerender/artifact-sink.ts`:
// in ECS the write grant rides on the task role, which the SDK resolves from
// the container credentials endpoint — no keys are configured here.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type {
  MediaCacheAdapter,
  MediaObjectStat,
} from '@cardstack/runtime-common';
import type { Readable } from 'stream';

const DEFAULT_REGION = 'us-east-1';

export class S3MediaCacheAdapter implements MediaCacheAdapter {
  #client: S3Client;
  #bucket: string;
  #keyPrefix: string;

  constructor({
    bucket,
    region,
    keyPrefix = '',
    client,
  }: {
    bucket: string;
    region?: string;
    // Namespaces this store's objects within a shared bucket. Applied to
    // every operation, so it never leaks above the adapter.
    keyPrefix?: string;
    // Injectable for tests; production callers omit it.
    client?: S3Client;
  }) {
    this.#bucket = bucket;
    this.#keyPrefix = keyPrefix;
    this.#client =
      client ??
      new S3Client({
        region: region ?? process.env.AWS_REGION?.trim() ?? DEFAULT_REGION,
      });
  }

  private objectKey(key: string): string {
    return `${this.#keyPrefix}${key}`;
  }

  async put(
    key: string,
    bytes: Uint8Array,
    opts: { contentType: string },
  ): Promise<void> {
    // The key is a hash of the bytes, so an existing object under this key
    // already holds them — skip the upload (dedupe-on-write).
    if (await this.head(key)) {
      return;
    }
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: this.objectKey(key),
        Body: bytes,
        ContentType: opts.contentType,
      }),
    );
  }

  async head(key: string): Promise<MediaObjectStat | undefined> {
    try {
      let response = await this.#client.send(
        new HeadObjectCommand({
          Bucket: this.#bucket,
          Key: this.objectKey(key),
        }),
      );
      return {
        size: response.ContentLength ?? 0,
        contentType: response.ContentType,
      };
    } catch (error: any) {
      if (isMissingObjectError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async getStream(key: string): Promise<AsyncIterable<Uint8Array> | undefined> {
    try {
      let response = await this.#client.send(
        new GetObjectCommand({
          Bucket: this.#bucket,
          Key: this.objectKey(key),
        }),
      );
      // In node the SDK's Body is a Readable, which is an
      // AsyncIterable<Uint8Array> — exactly the interface's stream shape.
      return (response.Body as Readable | undefined) ?? undefined;
    } catch (error: any) {
      if (isMissingObjectError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    // S3 DeleteObject on a missing key succeeds, giving the interface's
    // idempotent-delete contract for free.
    await this.#client.send(
      new DeleteObjectCommand({
        Bucket: this.#bucket,
        Key: this.objectKey(key),
      }),
    );
  }
}

// HeadObject reports absence as `NotFound`, GetObject as `NoSuchKey`; some
// SDK paths surface only the bare 404 status.
function isMissingObjectError(error: any): boolean {
  return (
    error?.name === 'NotFound' ||
    error?.name === 'NoSuchKey' ||
    error?.$metadata?.httpStatusCode === 404
  );
}
