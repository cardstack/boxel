import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  hashBytes,
  isValidTreePath,
  onDiskPathFor,
  treeHashFromDir,
  treeHashFromEntries,
} from './tree-hash.ts';
import {
  listZipPaths,
  readZip,
  writeCanonicalZip,
  type ZipEntryInput,
} from './canonical-zip.ts';
import {
  createPacklist,
  parsePacklist,
  serializePacklist,
  PACKLIST_PATH,
  type Packlist,
  type PackProvenance,
} from './packlist.ts';

// pack() / unpack(): the H1 ⇄ H2 transformations, under the round-trip
// laws:
//   1. treeHash(unpack(pack(T))) === treeHash(T)   (faithful)
//   2. pack(unpack(P)) === P byte-identically      (canonical form)
// The server's `?format=pack` and the CLI both call exactly this code.

export interface PackInputFile {
  path: string;
  bytes: Buffer;
}

export interface UnpackedPack {
  packlist: Packlist;
  files: Map<string, Buffer>;
  treeHash: string;
}

export function pack(
  files: readonly PackInputFile[],
  provenance?: PackProvenance,
): Buffer {
  for (let { path } of files) {
    if (!isValidTreePath(path)) {
      throw new Error(`invalid tree path: ${JSON.stringify(path)}`);
    }
    if (path === PACKLIST_PATH) {
      throw new Error(
        `the tree may not contain a root-level ${PACKLIST_PATH} (reserved for the pack manifest)`,
      );
    }
  }
  let packlist = createPacklist(
    files.map(({ path, bytes }) => ({
      path,
      size: bytes.length,
      sha256: hashBytes(bytes),
    })),
    provenance,
  );
  let byPath = new Map(files.map((f) => [f.path, f.bytes]));
  // Canonical order: packlist first, then tree paths in UTF-8 byte order
  // (the packlist's entries are already sorted that way).
  let zipEntries: ZipEntryInput[] = [
    { path: PACKLIST_PATH, bytes: serializePacklist(packlist) },
    ...packlist.entries.map(({ path }) => ({
      path,
      bytes: byPath.get(path)!,
    })),
  ];
  return writeCanonicalZip(zipEntries);
}

export async function packFromDir(
  dir: string,
  provenance?: PackProvenance,
): Promise<Buffer> {
  let result = await treeHashFromDir(dir);
  let files: PackInputFile[] = [];
  for (let { path } of result.entries) {
    // Sealed under the NFC path; reopened under whatever the filesystem
    // actually calls it. On a byte-transparent filesystem holding an NFD
    // name those differ, and asking for the normalised one would ENOENT.
    let onDisk = onDiskPathFor(result, path);
    files.push({
      path,
      bytes: await readFile(join(dir, ...onDisk.split('/'))),
    });
  }
  return pack(files, provenance);
}

// Full verification on every unpack: packlist present and first-ish, every
// file's hash and size match, no extras, no missing, recomputed treeHash
// equals the declared one. A pack that does not verify does not open.
export function unpack(zip: Buffer): UnpackedPack {
  let entries = readZip(zip);
  let packlistEntry = entries.find((e) => e.path === PACKLIST_PATH);
  if (!packlistEntry) {
    throw new Error(`no ${PACKLIST_PATH} in archive`);
  }
  if (entries[0]?.path !== PACKLIST_PATH) {
    throw new Error(`${PACKLIST_PATH} must be the first archive entry`);
  }
  let packlist = parsePacklist(packlistEntry.bytes);
  let files = new Map<string, Buffer>();
  for (let { path, bytes } of entries) {
    if (path === PACKLIST_PATH) {
      continue;
    }
    if (!isValidTreePath(path)) {
      throw new Error(`invalid tree path in archive: ${JSON.stringify(path)}`);
    }
    if (files.has(path)) {
      throw new Error(`duplicate archive entry: ${path}`);
    }
    files.set(path, bytes);
  }
  let declared = new Map(packlist.entries.map((e) => [e.path, e]));
  for (let [path, bytes] of files) {
    let entry = declared.get(path);
    if (!entry) {
      throw new Error(`archive file not in packlist: ${path}`);
    }
    if (entry.size !== bytes.length) {
      throw new Error(`size mismatch for ${path}`);
    }
    if (entry.sha256 !== hashBytes(bytes)) {
      throw new Error(`hash mismatch for ${path}`);
    }
  }
  for (let path of declared.keys()) {
    if (!files.has(path)) {
      throw new Error(`packlist entry missing from archive: ${path}`);
    }
  }
  // A carried record names a file the pack claims to have brought along. If
  // it names one the pack does not contain, the claim is the only evidence
  // for a dependency that is not there — worse than saying nothing, because
  // a recipient checking provenance would conclude it was covered.
  for (let record of packlist.provenance?.carried ?? []) {
    if (!files.has(record.entry)) {
      throw new Error(
        `provenance.carried says ${record.specifier} rides at ${record.entry}, which the pack does not contain`,
      );
    }
  }
  let recomputed = treeHashFromEntries(
    [...files.entries()].map(([path, bytes]) => ({
      path,
      sha256: hashBytes(bytes),
    })),
  );
  if (recomputed.treeHash !== packlist.treeHash.hash) {
    throw new Error(
      `treeHash mismatch: packlist declares ${packlist.treeHash.hash}, content is ${recomputed.treeHash}`,
    );
  }
  return { packlist, files, treeHash: recomputed.treeHash };
}

// Cheap peek without full verification (list command, server metadata).
export function peekPacklist(zip: Buffer): Packlist {
  let paths = listZipPaths(zip);
  if (paths[0] !== PACKLIST_PATH) {
    throw new Error(`${PACKLIST_PATH} must be the first archive entry`);
  }
  let entries = readZip(zip);
  return parsePacklist(entries[0].bytes);
}
