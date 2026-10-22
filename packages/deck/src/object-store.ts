import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { hashBytes } from './tree-hash.ts';
import { writeCanonicalZip, type ZipEntryInput } from './canonical-zip.ts';
import {
  parsePacklist,
  PACKLIST_PATH,
  serializePacklist,
  type Packlist,
} from './packlist.ts';
import { unpack } from './pack.ts';

// Per-FILE content addressing.
//
// The store used to keep one zip per tree, which made a two-character edit
// inside a 374-module vendored package cost a whole new 438 KB pack — and
// made an undiverged fork cost a full second copy, because each package had
// its own packs/ directory. Both were measured, and both are the same
// mistake: addressing at the wrong granularity.
//
//   <store>/_objects/<aa>/<sha256>     one file's bytes, once per depot
//   <store>/_trees/<aa>/<treeHash>.json  the packlist, once per tree
//
// Both live at the STORE root, not under a package, so bytes are shared
// across publishers as well as across versions. `acme/three` and a fork of
// it that changed one file now hold 375 objects between them, not 750.
//
// The pack is not stored; it is REBUILT. That is safe because
// canonical-zip-v1 is deterministic and the packlist fixes both the entry
// order and every hash — so `pack(unpack(P)) === P` still holds, byte for
// byte, and `?format=pack` keeps returning exactly what was sealed.
//
// `_`-prefixed names cannot collide with a publisher or package segment,
// which must start alphanumeric — the same reservation the URL space uses.
//
// Objects are stored deflate-raw and named for the sha256 of their
// UNCOMPRESSED content, because that is the identity the packlist uses.
// Without compression, per-file addressing would trade a 438 KB archive for
// 1.36 MB of loose files and only pay off after several edits; with it, the
// first copy costs about what the archive did and every edit after that
// costs one file.

export const OBJECTS_DIR = '_objects';
export const TREES_DIR = '_trees';

const SHA256 = /^[0-9a-f]{64}$/;

export function objectPath(storeDir: string, sha256: string): string {
  return join(storeDir, OBJECTS_DIR, sha256.slice(0, 2), sha256);
}

export function treePath(storeDir: string, treeHash: string): string {
  return join(storeDir, TREES_DIR, treeHash.slice(0, 2), `${treeHash}.json`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// Writes are content-addressed, so a concurrent writer producing the same
// bytes is not a race worth locking against — but a half-written object
// would be, hence tmp+rename.
async function writeOnce(path: string, bytes: Buffer): Promise<boolean> {
  if (await exists(path)) {
    return false;
  }
  await mkdir(join(path, '..'), { recursive: true });
  let tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
  return true;
}

export interface StoreObjectsResult {
  treeHash: string;
  files: number;
  objectsWritten: number;
  bytesWritten: number;
  // Bytes this tree would have cost as its own pack but did not, because
  // the objects were already here.
  bytesShared: number;
}

// Explode a verified pack into objects plus a tree manifest. The pack bytes
// themselves are never kept.
export async function storePack(
  storeDir: string,
  packBytes: Buffer,
): Promise<StoreObjectsResult> {
  let { packlist, files, treeHash } = unpack(packBytes);
  let objectsWritten = 0;
  let bytesWritten = 0;
  let bytesShared = 0;
  for (let [, bytes] of files) {
    let sha256 = hashBytes(bytes);
    let stored = deflateRawSync(bytes, { level: 9 });
    if (await writeOnce(objectPath(storeDir, sha256), stored)) {
      objectsWritten++;
      bytesWritten += stored.length;
    } else {
      bytesShared += stored.length;
    }
  }
  await writeOnce(treePath(storeDir, treeHash), serializePacklist(packlist));
  return {
    treeHash,
    files: files.size,
    objectsWritten,
    bytesWritten,
    bytesShared,
  };
}

export async function readTree(
  storeDir: string,
  treeHash: string,
): Promise<Packlist | undefined> {
  try {
    return parsePacklist(await readFile(treePath(storeDir, treeHash)));
  } catch {
    return undefined;
  }
}

export async function readObject(
  storeDir: string,
  sha256: string,
): Promise<Buffer | undefined> {
  if (!SHA256.test(sha256)) {
    return undefined;
  }
  let stored: Buffer;
  try {
    stored = await readFile(objectPath(storeDir, sha256));
  } catch {
    return undefined;
  }
  return inflateRawSync(stored);
}

// ONE file out of a tree, without touching the other 373. This is the path
// the server takes for every module request, so a deep import costs a
// single blob read rather than a whole-archive decode.
export async function readTreeFile(
  storeDir: string,
  treeHash: string,
  path: string,
): Promise<Buffer | undefined> {
  let packlist = await readTree(storeDir, treeHash);
  let entry = packlist?.entries.find((candidate) => candidate.path === path);
  if (!entry) {
    return undefined;
  }
  let bytes = await readObject(storeDir, entry.sha256);
  // An object that does not hash to its name is corruption, not a miss.
  if (bytes && hashBytes(bytes) !== entry.sha256) {
    throw new Error(
      `store: object ${entry.sha256} does not match its own hash (${path})`,
    );
  }
  return bytes;
}

// Rebuild the sealed pack, byte for byte. The packlist fixes the order and
// every hash, and canonical-zip-v1 is deterministic, so this reproduces
// exactly the archive that was published.
export async function rebuildPack(
  storeDir: string,
  treeHash: string,
): Promise<Buffer | undefined> {
  let packlist = await readTree(storeDir, treeHash);
  if (!packlist) {
    return undefined;
  }
  let entries: ZipEntryInput[] = [
    { path: PACKLIST_PATH, bytes: serializePacklist(packlist) },
  ];
  for (let entry of packlist.entries) {
    let bytes = await readObject(storeDir, entry.sha256);
    if (!bytes) {
      return undefined; // an incomplete tree is a miss, not a broken pack
    }
    entries.push({ path: entry.path, bytes });
  }
  return writeCanonicalZip(entries);
}

export interface GcResult {
  treesDeleted: number;
  objectsDeleted: number;
  bytesFreed: number;
}

// Objects are shared across every package in the store, so collection has
// to be store-wide: a blob is only garbage when NO live tree names it, and
// a tree is only garbage when NO version record points at it.
export async function collectGarbage(
  storeDir: string,
  liveTreeHashes: Set<string>,
): Promise<GcResult> {
  let result: GcResult = { treesDeleted: 0, objectsDeleted: 0, bytesFreed: 0 };
  let liveObjects = new Set<string>();
  for (let treeHash of liveTreeHashes) {
    let packlist = await readTree(storeDir, treeHash);
    for (let entry of packlist?.entries ?? []) {
      liveObjects.add(entry.sha256);
    }
  }
  for (let treeHash of await listTrees(storeDir)) {
    if (liveTreeHashes.has(treeHash)) {
      continue;
    }
    await rm(treePath(storeDir, treeHash), { force: true });
    result.treesDeleted++;
  }
  for (let sha256 of await listObjects(storeDir)) {
    if (liveObjects.has(sha256)) {
      continue;
    }
    let path = objectPath(storeDir, sha256);
    let size = await stat(path).then(
      (info) => info.size,
      () => 0,
    );
    await rm(path, { force: true });
    result.objectsDeleted++;
    result.bytesFreed += size;
  }
  return result;
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

export async function listObjects(storeDir: string): Promise<string[]> {
  let found: string[] = [];
  for (let shard of await readdirSafe(join(storeDir, OBJECTS_DIR))) {
    for (let name of await readdirSafe(join(storeDir, OBJECTS_DIR, shard))) {
      if (SHA256.test(name)) {
        found.push(name);
      }
    }
  }
  return found;
}

export async function listTrees(storeDir: string): Promise<string[]> {
  let found: string[] = [];
  for (let shard of await readdirSafe(join(storeDir, TREES_DIR))) {
    for (let name of await readdirSafe(join(storeDir, TREES_DIR, shard))) {
      let hash = name.replace(/\.json$/, '');
      if (name.endsWith('.json') && SHA256.test(hash)) {
        found.push(hash);
      }
    }
  }
  return found;
}

export interface StoreUsage {
  objects: number;
  trees: number;
  bytes: number;
}

export async function storeUsage(storeDir: string): Promise<StoreUsage> {
  let objects = await listObjects(storeDir);
  let bytes = 0;
  for (let sha256 of objects) {
    bytes += await stat(objectPath(storeDir, sha256)).then(
      (info) => info.size,
      () => 0,
    );
  }
  return {
    objects: objects.length,
    trees: (await listTrees(storeDir)).length,
    bytes,
  };
}
