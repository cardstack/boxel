// A sweep's walk over a realm directory. It finds where the files on disk
// differ from the path state realm-historian has recorded, and writes the
// objects a revision of the differences needs. The recorder decides what of
// that to record (`recorder.ts`): a sweep leaves out every path a later
// event changes.
//
// Each regular file is fingerprinted with `content-hash.ts` and compared with
// its path state:
//
// * A file at or under `CONTENT_HASH_WHOLE_LIMIT_BYTES` is read whole, once.
//   When it differs, the same bytes are written as its blob.
// * A larger file is fingerprinted from bounded reads of its head and tail,
//   and read whole only when it differs.
// * A file that differs becomes a size-only entry, without a whole read,
//   when HEAD holds it as one, or when it is larger than
//   `sizeOnlyAboveBytes`.
// * A path in the path state with no regular file on disk is a deletion.
//
// The walk skips what capture can't record: symlinks, which it doesn't
// follow, anything else that isn't a regular file or a directory, and paths
// history can't hold (`unrecordableReason`). It also skips the staging files
// of partial writes, which the realm treats as no part of itself.
//
// A file that changes size while it is fingerprinted is left as it is
// recorded, for the next sweep. A realm directory that can't be read fails
// the walk, rather than reading as a realm whose files were all deleted.
//
// `sweepKind` is the background work that sweeps each realm with a HEAD
// daily, and any realm a sweep is asked for by setting
// `realm_history_state.sweep_requested_at`. Its schedule is kept in the
// realm's state row, so it survives a restart: a sweep records when its walk
// started in `last_swept_at`, and a scan's sweep counts.

import { constants } from 'node:fs';
import { open, readdir, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CONTENT_HASH_WHOLE_LIMIT_BYTES,
  computeContentHash,
  computeContentHashFromRanges,
  DEFAULT_VIDEO_SIZE_LIMIT_BYTES,
  PARTIAL_WRITE_SUFFIX,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { BackgroundKind } from './background.ts';
import { BLOB_MODE, TREE_MODE, type ObjectStore } from './git-objects.ts';
import type { FileEntry } from './head-tree.ts';
import {
  runGit,
  unrecordableReason,
  writeSizeOnlyEntry,
} from './repo-format.ts';

// What realm-historian has recorded for a path: a row of
// `realm_history_path_state`.
export interface RecordedPath {
  contentHash: string;
  size: number;
  // A blob, or a size-only entry's tree.
  objectId: string;
}

// A path whose file differs from what is recorded: the blob or size-only
// entry written for it, or null when it has no regular file on disk.
export interface SweptChange {
  path: string;
  entry: FileEntry | null;
  // The `content-hash.ts` fingerprint and size of `entry`.
  fingerprint?: string;
  size?: number;
}

export interface WalkResult {
  changes: Map<string, SweptChange>;
  // How many regular files were fingerprinted, and how many bytes were read.
  files: number;
  bytesRead: number;
}

export interface WalkOptions {
  directory: string;
  store: ObjectStore;
  // The path state, by path.
  recorded: ReadonlyMap<string, RecordedPath>;
  // A file larger than this that differs becomes a size-only entry.
  sizeOnlyAboveBytes?: number;
  // A recorded path larger than this may be a size-only entry, which is
  // checked in the repo when its file differs: the recorder writes one only
  // for a file above this size.
  sizeOnlyThresholdBytes?: number;
  signal?: AbortSignal;
}

// How long after a realm's last sweep the next is due.
export const DEFAULT_SWEEP_EVERY_MS = 24 * 60 * 60_000;

// How long a sweep whose walk failed waits before it is tried again.
const SWEEP_RETRY_AFTER_MS = 10 * 60_000;

export interface SweepKindOptions {
  db: DBAdapter;
  everyMs?: number;
  // How often the realms' state rows are read for the sweeps due.
  pollEveryMs?: number;
}

// The daily sweep, and the sweeps asked for. It runs outside the realm's
// queue, so a busy realm is swept as readily as a quiet one: the walk is the
// job, and the revision commits in the queue once the clock has passed it.
export function sweepKind({
  db,
  everyMs = DEFAULT_SWEEP_EVERY_MS,
  pollEveryMs,
}: SweepKindOptions): BackgroundKind {
  return {
    name: 'sweep',
    outsideQueue: true,
    retryAfterMs: SWEEP_RETRY_AFTER_MS,
    pollEveryMs,
    poll: (realmIds) => sweepsDue(db, realmIds, everyMs),
    isDue: async (realm) =>
      (await sweepsDue(db, [realm.id], everyMs)).length > 0,
    run: (_realm, { sweep }) => sweep(),
  };
}

// The realms among `realmIds` due a sweep: a realm with a HEAD whose last
// sweep is `everyMs` old, or that has never been swept, and any realm a
// sweep has been asked for since its last. A realm with no HEAD is the
// backfill's (`backfill.ts`) unless a sweep is asked for.
async function sweepsDue(
  db: DBAdapter,
  realmIds: string[],
  everyMs: number,
): Promise<string[]> {
  let rows = await db.execute(
    `SELECT realm_id FROM realm_history_state
     WHERE realm_id = ANY($1::uuid[]) AND enabled AND status = 'ok'
       AND ((head IS NOT NULL
             AND (last_swept_at IS NULL
                  OR last_swept_at <= now() - $2::float8 * interval '1 millisecond'))
            OR sweep_requested_at > COALESCE(last_swept_at, '-infinity'))`,
    { bind: [realmIds, everyMs] },
  );
  return rows.map((row) => row.realm_id as string);
}

// A file whose size changed while it was fingerprinted.
class ShortReadError extends Error {
  constructor(path: string) {
    super(`${path} changed size while it was read`);
    this.name = 'ShortReadError';
  }
}

export async function walkRealm({
  directory,
  store,
  recorded,
  sizeOnlyAboveBytes = DEFAULT_VIDEO_SIZE_LIMIT_BYTES,
  sizeOnlyThresholdBytes = CONTENT_HASH_WHOLE_LIMIT_BYTES,
  signal,
}: WalkOptions): Promise<WalkResult> {
  let changes = new Map<string, SweptChange>();
  // The paths with a regular file on disk, or left as recorded.
  let present = new Set<string>();
  let files = 0;
  let bytesRead = 0;

  let sweepFile = async (path: string): Promise<void> => {
    let opened = await openRealmFile(join(directory, path));
    if (!opened) {
      return;
    }
    let { handle } = opened;
    let { size } = opened;
    try {
      let known = recorded.get(path);
      let fingerprint: string;
      let bytes: Uint8Array | undefined;
      files++;
      if (size <= CONTENT_HASH_WHOLE_LIMIT_BYTES) {
        bytes = await readAll(handle, size);
        bytesRead += bytes.byteLength;
        size = bytes.byteLength;
        fingerprint = computeContentHash(bytes);
      } else {
        fingerprint = await computeContentHashFromRanges(
          size,
          async (start, length) => {
            let range = await readRange(handle, start, length);
            bytesRead += range.byteLength;
            if (range.byteLength < length) {
              throw new ShortReadError(path);
            }
            return range;
          },
        );
      }
      present.add(path);
      if (known?.contentHash === fingerprint && known.size === size) {
        return;
      }
      if (
        size > sizeOnlyAboveBytes ||
        (known &&
          known.size > sizeOnlyThresholdBytes &&
          (await isTree(store, known.objectId)))
      ) {
        let id = await writeSizeOnlyEntry(store, { size, fingerprint });
        changes.set(path, {
          path,
          entry: { mode: TREE_MODE, id },
          fingerprint,
          size,
        });
        return;
      }
      if (!bytes) {
        bytes = await readAll(handle, size);
        bytesRead += bytes.byteLength;
        fingerprint = computeContentHash(bytes);
        size = bytes.byteLength;
      }
      let { id } = await store.writeBlob(bytes);
      changes.set(path, {
        path,
        entry: { mode: BLOB_MODE, id },
        fingerprint,
        size,
      });
    } catch (error) {
      if (error instanceof ShortReadError) {
        // The write that changed it is recorded by its own event, or by the
        // next sweep.
        present.add(path);
        return;
      }
      throw error;
    } finally {
      await handle.close();
    }
  };

  let directories = [''];
  while (directories.length > 0) {
    signal?.throwIfAborted();
    let relative = directories.pop()!;
    let entries;
    try {
      entries = await readdir(join(directory, relative), {
        withFileTypes: true,
      });
    } catch (error: any) {
      // A directory removed during the walk takes its files with it. The
      // realm directory itself has to be there.
      if (relative !== '' && ['ENOENT', 'ENOTDIR'].includes(error?.code)) {
        continue;
      }
      throw error;
    }
    for (let entry of entries) {
      let path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (!isSweptPath(path)) {
        continue;
      }
      if (entry.isDirectory()) {
        directories.push(path);
      } else if (entry.isFile()) {
        signal?.throwIfAborted();
        await sweepFile(path);
      }
    }
  }
  for (let path of recorded.keys()) {
    if (!present.has(path)) {
      changes.set(path, { path, entry: null });
    }
  }
  return { changes, files, bytesRead };
}

// Whether a walk looks at a path: one history can hold, and not a partial
// write's staging file.
function isSweptPath(path: string): boolean {
  return (
    unrecordableReason(path) === undefined &&
    !path.endsWith(PARTIAL_WRITE_SUFFIX)
  );
}

async function isTree(store: ObjectStore, id: string): Promise<boolean> {
  try {
    let type = await runGit(store.gitDir, ['cat-file', '-t', id]);
    return type.toString('utf8').trim() === 'tree';
  } catch {
    return false;
  }
}

// The open file at the path and its size, or undefined when no regular file
// is there: nothing, a directory, a symlink, which is not followed, or a
// special file, which is not read.
export async function openRealmFile(
  path: string,
): Promise<{ handle: FileHandle; size: number } | undefined> {
  let handle;
  try {
    // Non-blocking, so opening a FIFO doesn't wait for a writer.
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error: any) {
    if (['ENOENT', 'ENOTDIR', 'EISDIR', 'ELOOP'].includes(error?.code)) {
      return undefined;
    }
    throw error;
  }
  try {
    let stats = await handle.stat();
    if (stats.isFile()) {
      return { handle, size: stats.size };
    }
  } catch (error) {
    await handle.close();
    throw error;
  }
  await handle.close();
  return undefined;
}

// The file's bytes, or only its first `limit` bytes, or null when no regular
// file is at the path (`openRealmFile`).
export async function readRealmFile(
  path: string,
  limit?: number,
): Promise<Uint8Array | null> {
  let opened = await openRealmFile(path);
  if (!opened) {
    return null;
  }
  let { handle, size } = opened;
  try {
    return limit === undefined
      ? await readAll(handle, size)
      : await readRange(handle, 0, limit);
  } finally {
    await handle.close();
  }
}

// Every byte from the start of the file to its end, read at explicit
// positions, so earlier reads of the handle don't move where this starts.
// `size` is what the file's stat said: the first read asks for one byte
// more, so a file that hasn't grown is read in one call.
async function readAll(handle: FileHandle, size: number): Promise<Uint8Array> {
  let chunks: Uint8Array[] = [];
  let position = 0;
  let length = size + 1;
  for (;;) {
    let chunk = await readRange(handle, position, length);
    chunks.push(chunk);
    position += chunk.byteLength;
    if (chunk.byteLength < length) {
      break;
    }
    length = READ_CHUNK_BYTES;
  }
  return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
}

const READ_CHUNK_BYTES = 1024 * 1024;

// Up to `length` bytes from `start`: fewer only at the end of the file.
async function readRange(
  handle: FileHandle,
  start: number,
  length: number,
): Promise<Uint8Array> {
  let buffer = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    let { bytesRead } = await handle.read(
      buffer,
      filled,
      length - filled,
      start + filled,
    );
    if (bytesRead === 0) {
      break;
    }
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}
