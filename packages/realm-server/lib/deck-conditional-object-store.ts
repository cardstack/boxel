import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  ConditionalWriteConflictError,
  hashBytes,
  type ConditionalObject,
  type ConditionalObjectStore,
} from '@cardstack/deck/node';

export interface S3CommandClient {
  send(command: GetObjectCommand | PutObjectCommand): Promise<unknown>;
}

function keyParts(key: string): string[] {
  let parts = key.split('/');
  if (
    key === '' ||
    key.startsWith('/') ||
    key.endsWith('/') ||
    key.includes('\\') ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`invalid realm object key: ${JSON.stringify(key)}`);
  }
  return parts;
}

function localETag(bytes: Buffer): string {
  return `"${hashBytes(bytes)}"`;
}

async function acquireLocalLock(path: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await mkdir(path);
      return () => rm(path, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error(`timed out waiting for realm object lock: ${path}`);
}

export class RealmFileConditionalObjectStore implements ConditionalObjectStore {
  readonly realmDir: string;

  constructor(realmDir: string) {
    this.realmDir = realmDir;
  }

  #path(key: string): string {
    return join(this.realmDir, ...keyParts(key));
  }

  async get(key: string): Promise<ConditionalObject | undefined> {
    try {
      let bytes = await readFile(this.#path(key));
      return { bytes, etag: localETag(bytes) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async put(
    key: string,
    bytes: Buffer,
    condition: { ifMatch?: string; ifNoneMatch?: '*' },
  ): Promise<{ etag: string }> {
    let path = this.#path(key);
    await mkdir(dirname(path), { recursive: true });
    let release = await acquireLocalLock(`${path}.lock`);
    try {
      let current = await this.get(key);
      if (
        (condition.ifNoneMatch === '*' && current) ||
        (condition.ifMatch !== undefined && current?.etag !== condition.ifMatch)
      ) {
        throw new ConditionalWriteConflictError(
          `realm object changed before conditional write: ${key}`,
        );
      }
      let tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, path);
      return { etag: localETag(bytes) };
    } finally {
      await release();
    }
  }
}

function s3Key(prefix: string, key: string): string {
  let normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
  let relative = keyParts(key).join('/');
  return normalizedPrefix ? `${normalizedPrefix}/${relative}` : relative;
}

function isMissingS3Object(error: unknown): boolean {
  let value = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    value.name === 'NoSuchKey' ||
    value.name === 'NotFound' ||
    value.$metadata?.httpStatusCode === 404
  );
}

function isS3PreconditionFailure(error: unknown): boolean {
  let value = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    value.name === 'PreconditionFailed' ||
    value.$metadata?.httpStatusCode === 412
  );
}

async function bodyBytes(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (body instanceof Uint8Array) return Buffer.from(body);
  let sdkBody = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (sdkBody.transformToByteArray) {
    return Buffer.from(await sdkBody.transformToByteArray());
  }
  let chunks: Buffer[] = [];
  for await (let chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class S3ConditionalObjectStore implements ConditionalObjectStore {
  readonly client: S3CommandClient;
  readonly bucket: string;
  readonly prefix: string;

  constructor(
    bucket: string,
    prefix: string,
    options: { client?: S3CommandClient; region?: string } = {},
  ) {
    if (bucket.trim() === '') throw new Error('S3 bucket must not be empty');
    this.bucket = bucket;
    this.prefix = prefix;
    this.client =
      options.client ?? new S3Client({ region: options.region ?? 'us-east-1' });
  }

  async get(key: string): Promise<ConditionalObject | undefined> {
    try {
      let output = (await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: s3Key(this.prefix, key),
        }),
      )) as { Body?: unknown; ETag?: string };
      let bytes = await bodyBytes(output.Body);
      return { bytes, etag: output.ETag ?? localETag(bytes) };
    } catch (error) {
      if (isMissingS3Object(error)) return undefined;
      throw error;
    }
  }

  async put(
    key: string,
    bytes: Buffer,
    condition: { ifMatch?: string; ifNoneMatch?: '*' },
  ): Promise<{ etag: string }> {
    try {
      let output = (await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key(this.prefix, key),
          Body: bytes,
          ContentType: 'application/json',
          IfMatch: condition.ifMatch,
          IfNoneMatch: condition.ifNoneMatch,
        }),
      )) as { ETag?: string };
      return { etag: output.ETag ?? localETag(bytes) };
    } catch (error) {
      if (isS3PreconditionFailure(error)) {
        throw new ConditionalWriteConflictError(
          `S3 object changed before conditional write: ${key}`,
        );
      }
      throw error;
    }
  }
}
