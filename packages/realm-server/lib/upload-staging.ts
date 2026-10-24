import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
  utimes,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CardError } from '@cardstack/runtime-common/error';
import { computeContentHashFromRanges } from '@cardstack/runtime-common/content-hash';
import { StagedFile } from '@cardstack/runtime-common/staged-file';
import { partialWritePath } from '@cardstack/runtime-common/paths';

const registry = join(tmpdir(), 'boxel-upload-staging');

// Each process owns its directory and a manifest for every sibling staging
// file. A restart may reclaim dead owners, but never another live process.
export async function sweepAbandonedUploads(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (let name of await readdir(root)) {
    if (!/^\d+-/.test(name)) continue;
    let pid = Number(name.split('-')[0]);
    try {
      process.kill(pid, 0);
      continue;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') continue;
    }
    let directory = join(root, name);
    // Manifests are written before creating a sibling file. A crash during
    // either step therefore leaves enough information to remove its bytes.
    let entries = await readdir(directory).catch(
      (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return [];
        throw err;
      },
    );
    for (let entry of entries) {
      if (!entry.endsWith('.json')) continue;
      let paths: string[];
      try {
        paths = JSON.parse(await readFile(join(directory, entry), 'utf8'));
      } catch {
        continue;
      }
      let id = entry.slice(0, -5);
      for (let path of paths) {
        if (basename(path).endsWith(`.${id}.boxel-partial`)) {
          await rm(path, { force: true });
        }
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
}

// The local manifest disappears when a container is replaced. Sibling files
// on a shared realm filesystem therefore also carry a lease via their mtime.
// Active uploads refresh it. Expired siblings are reclaimed one directory at a
// time, the first time this process stages into that directory, so the cost
// follows uploads rather than the size of every realm tree at boot.
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
export async function sweepUploadDirectory(directory: string): Promise<void> {
  let entries = await readdir(directory, { withFileTypes: true }).catch(
    (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return [];
      throw err;
    },
  );
  for (let entry of entries) {
    if (
      !entry.isFile() ||
      !/^\.boxel-upload\.[0-9a-f-]+\.boxel-partial$/.test(entry.name)
    ) {
      continue;
    }
    let path = join(directory, entry.name);
    try {
      let info = await stat(path);
      if (Date.now() - info.mtimeMs > STALE_UPLOAD_MS)
        await rm(path, { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}

export class UploadStaging {
  #used = 0;
  #directory?: Promise<string>;
  #handles = new Map<
    StagedFile,
    {
      manifest: string;
      reserved: number;
      heartbeat: ReturnType<typeof setInterval>;
    }
  >();
  #directorySweeps = new Map<string, Promise<void>>();

  #sweepDirectory(directory: string): Promise<void> {
    let sweep = this.#directorySweeps.get(directory);
    if (!sweep) {
      sweep = sweepUploadDirectory(directory).catch(() => {});
      this.#directorySweeps.set(directory, sweep);
    }
    return sweep;
  }

  private limit: number;

  constructor(
    limit = Number(process.env.UPLOAD_STAGING_LIMIT_BYTES ?? 1024 ** 3),
  ) {
    this.limit = limit;
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error(
        'UPLOAD_STAGING_LIMIT_BYTES must be a positive safe integer',
      );
    }
  }

  initialize(): Promise<string> {
    return (this.#directory ??= (async () => {
      await sweepAbandonedUploads(registry);
      return mkdtemp(join(registry, `${process.pid}-`));
    })());
  }

  #reserve(bytes: number): void {
    if (this.#used + bytes > this.limit) {
      throw new CardError('Upload staging capacity exhausted', {
        status: 503,
        title: 'Service Unavailable',
      });
    }
    this.#used += bytes;
  }

  async stage(
    target: string,
    body: ReadableStream<Uint8Array>,
    limit: number,
    contentLength?: number,
  ): Promise<StagedFile> {
    if (contentLength !== undefined && contentLength > limit) {
      throw new CardError(
        `File size (${contentLength} bytes) exceeds maximum allowed size (${limit} bytes)`,
        { status: 413, title: 'Payload Too Large' },
      );
    }
    let directory = await this.initialize();
    let id = randomUUID();
    // A sibling of the target makes publication a rename, but only an
    // existing directory gets one: staging must not create directories for a
    // write the realm has not validated yet. Otherwise, and when the length
    // is unknown, the bytes stage locally and are copied over at commit.
    let targetDirectory = dirname(target);
    let sibling =
      contentLength !== undefined && (await isDirectory(targetDirectory));
    if (sibling) await this.#sweepDirectory(targetDirectory);
    let path = sibling
      ? partialWritePath(join(targetDirectory, `.boxel-upload.${id}`))
      : join(directory, `${id}.boxel-partial`);
    let manifest = join(directory, `${id}.json`);
    let reserved = 0;
    let size = 0;
    let hash = createHash('sha256');
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      this.#reserve(contentLength ?? 0);
      reserved = contentLength ?? 0;
      await writeFile(manifest, JSON.stringify([path]), {
        flag: 'wx',
        mode: 0o600,
      });
      heartbeat = setInterval(() => {
        let now = new Date();
        void utimes(path, now, now).catch(() => {});
      }, 60_000);
      heartbeat.unref();
      let counter = new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
          try {
            size += chunk.byteLength;
            if (size > limit) {
              throw new CardError(
                `File exceeds maximum allowed size (${limit} bytes)`,
                {
                  status: 413,
                  title: 'Payload Too Large',
                },
              );
            }
            if (size > reserved) {
              this.#reserve(size - reserved);
              reserved = size;
            }
            hash.update(chunk);
            callback(null, chunk);
          } catch (err) {
            callback(err as Error);
          }
        },
      });
      await pipeline(
        Readable.fromWeb(
          body as import('node:stream/web').ReadableStream<Uint8Array>,
        ),
        counter,
        createWriteStream(path, { flags: 'wx', mode: 0o600 }),
      );
      if (contentLength !== undefined && size !== contentLength) {
        throw new CardError('Body length differs from Content-Length', {
          status: 400,
        });
      }
      let contentHash = await computeContentHashFromRanges(
        size,
        async (start, length) => {
          let chunks: Buffer[] = [];
          for await (let chunk of createReadStream(path, {
            start,
            end: start + length - 1,
          }))
            chunks.push(chunk);
          let bytes = Buffer.concat(chunks);
          if (bytes.byteLength !== length)
            throw new Error('Staged file changed while hashing');
          return bytes;
        },
      );
      let content = new StagedFile(path, size, hash.digest('hex'), contentHash);
      this.#handles.set(content, { manifest, reserved, heartbeat });
      return content;
    } catch (err) {
      clearInterval(heartbeat);
      await rm(path, { force: true });
      this.#used -= reserved;
      await rm(manifest, { force: true });
      throw err;
    }
  }

  async dispose(content: StagedFile): Promise<void> {
    let handle = this.#handles.get(content);
    if (!handle) return;
    await rm(content.stagedPath, { force: true });
    clearInterval(handle.heartbeat);
    this.#used -= handle.reserved;
    this.#handles.delete(content);
    await rm(handle.manifest, { force: true });
  }

  async equals(target: string, content: StagedFile): Promise<boolean> {
    this.#handle(content);
    let hash = createHash('sha256');
    for await (let chunk of createReadStream(target)) hash.update(chunk);
    return hash.digest('hex') === content.sha256;
  }

  #handle(content: StagedFile) {
    let handle = this.#handles.get(content);
    if (!handle) throw new Error('Unknown or disposed staged upload');
    return handle;
  }

  async commit(target: string, content: StagedFile): Promise<void> {
    let handle = this.#handle(content);
    await mkdir(dirname(target), { recursive: true });
    try {
      await rename(content.stagedPath, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      // A local-disk upload needs a sibling on the destination filesystem
      // before publication, so no reader can observe a partly copied file.
      let id = basename(handle.manifest, '.json');
      let sibling = partialWritePath(
        join(dirname(target), `.boxel-upload.${id}`),
      );
      this.#reserve(content.size);
      try {
        await writeFile(
          handle.manifest,
          JSON.stringify([content.stagedPath, sibling]),
        );
        await pipeline(
          createReadStream(content.stagedPath),
          createWriteStream(sibling, { flags: 'wx', mode: 0o600 }),
        );
        await rename(sibling, target);
      } finally {
        await rm(sibling, { force: true });
        this.#used -= content.size;
      }
    }
    if ((await stat(target)).size !== content.size)
      throw new Error('Committed upload size changed');
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

export const uploadStaging = new UploadStaging();
