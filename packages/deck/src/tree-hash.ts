import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// tree-hash-v1: the canonical identity of a deck, independent of its
// container (depot tree at a seal, .pack.zip artifact, or a pack mounted
// inside a deck). Every implementation — CLI, minimal server, and later the
// realm server — must produce byte-identical results from the same logical
// tree. The zip's own bytes are NEVER an identity: two byte-different zips
// (timestamps, entry order) can carry the same deck.
//
// The manifest text is deliberately `shasum -a 256`-compatible
// (`<hex><space><space><path>`, one line per file, sorted by path in UTF-8
// byte order), so a tree can be checked with stock coreutils:
//
//   find . -type f | sort | xargs shasum -a 256
//
// treeHash = sha256 of that manifest text. The spec name (below) is part of
// every packlist and every derived-artifact build key, so a change to these
// rules is a new spec version, never silent drift.

export const TREE_HASH_SPEC = 'tree-hash-v1';

export interface TreeHashEntry {
  // Relative path from the tree root: forward slashes, no leading slash,
  // no '.'/'..' segments, no empty segments, no NUL, and no '!' (reserved
  // by the pack-mount separator `!/`).
  path: string;
  // Lowercase sha256 hex of the file's bytes.
  sha256: string;
}

export interface TreeHashResult {
  spec: typeof TREE_HASH_SPEC;
  treeHash: string; // lowercase sha256 hex of manifestText
  manifestText: string;
  entries: TreeHashEntry[]; // sorted, as hashed
  // Logical (NFC) path -> the relative path as the filesystem spells it.
  // Only `treeHashFromDir` can know this, and only it needs to: a caller
  // that re-opens a file must ask the OS for the name the OS gave, which on
  // a byte-transparent filesystem is not the normalised one.
  onDiskPaths?: ReadonlyMap<string, string>;
}

export function hashBytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// UNICODE NORMALISATION — part of the algorithm, not a nicety.
//
// Paths are hashed as UTF-8 bytes, so `ä` as U+00E4 (NFC, 2 bytes) and as
// U+0061 U+0308 (NFD, 3 bytes) are different paths and produce different
// tree hashes for the same logical tree. Filesystems disagree about which
// they hand back: APFS preserves whatever it was given, HFS+ normalised to
// NFD, Linux filesystems are byte-transparent and will hold either, and
// archive tools vary. Without a rule, L1's promise — two trees with the
// same files have the same hash on every implementation — is true only for
// trees that happen to be NFC, which is luck rather than a protocol.
//
// The ruling is split, deliberately:
//
//   A non-NFC path is NOT a valid tree path.  Refused, not silently
//   rewritten — an author who wrote a path chose those bytes, and quietly
//   changing them is the kind of guess L11 exists to forbid.
//
//   `treeHashFromDir` normalises as it reads.  That is the one place where
//   the OS, not the author, chose the encoding, and an HFS+ user should not
//   be locked out of sealing by their filesystem's convention.
export function normalizeTreePath(path: string): string {
  return path.normalize('NFC');
}

export function isNormalizedTreePath(path: string): boolean {
  return normalizeTreePath(path) === path;
}

// The `!` exclusion is a protocol ruling: `!/` marks the archive boundary
// for packs mounted inside decks, so it can never appear in a tree path.
export function isValidTreePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.endsWith('/')) {
    return false;
  }
  if (path.includes('\0') || path.includes('\\') || path.includes('!')) {
    return false;
  }
  if (!isNormalizedTreePath(path)) {
    return false;
  }
  return path
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

const HEX_64 = /^[0-9a-f]{64}$/;

// Sort key: UTF-8 byte order (NOT locale or UTF-16 code-unit order), so
// every language and libc agrees on the ordering.
function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function treeHashFromEntries(
  entries: readonly TreeHashEntry[],
): TreeHashResult {
  let seen = new Set<string>();
  for (let { path, sha256 } of entries) {
    if (!isValidTreePath(path)) {
      // Say which rule was broken when it is the invisible one. "invalid
      // tree path" for two strings that look identical on screen is the
      // least actionable error a hash function can produce.
      if (!isNormalizedTreePath(path)) {
        throw new Error(
          `tree path is not Unicode NFC: ${JSON.stringify(path)} — the same ` +
            `name in NFC is ${JSON.stringify(normalizeTreePath(path))}. Paths ` +
            `are hashed as UTF-8 bytes, so the two forms would be different trees.`,
        );
      }
      throw new Error(`invalid tree path: ${JSON.stringify(path)}`);
    }
    if (!HEX_64.test(sha256)) {
      throw new Error(`invalid sha256 for ${path}: ${JSON.stringify(sha256)}`);
    }
    if (seen.has(path)) {
      throw new Error(`duplicate tree path: ${path}`);
    }
    seen.add(path);
  }
  let sorted = [...entries].sort((a, b) => compareUtf8(a.path, b.path));
  let manifestText = sorted
    .map(({ path, sha256 }) => `${sha256}  ${path}\n`)
    .join('');
  return {
    spec: TREE_HASH_SPEC,
    treeHash: hashBytes(manifestText),
    manifestText,
    entries: sorted,
  };
}

// Default names never part of a deck's logical tree, whichever container
// it sits in. Callers can extend but not shrink protocol-reserved names.
// A depot carries its own machinery in dot-directories: `.deck` holds the
// store and durable History, while `.jj` is deckd's thin workspace stub.
// They live INSIDE the depot so a depot directory is self-contained
// and movable, and they are ignored here so a depot's own bookkeeping can
// never change the hash of the tree it is keeping.
export const DEFAULT_IGNORE = new Set([
  '.git',
  '.jj',
  '.deck',
  '.DS_Store',
  'node_modules',
]);

/**
 * A directory/file name that is never part of a deck's logical tree.
 * Exact names in {@link DEFAULT_IGNORE}, plus jj workspace leftovers such as
 * `.jj.main-orphan` (left beside `.jj` when the store is relocated).
 */
export function isIgnoredTreeSegment(name: string): boolean {
  return DEFAULT_IGNORE.has(name) || name.startsWith('.jj.');
}

export async function treeHashFromDir(
  dir: string,
  options: { ignore?: ReadonlySet<string> } = {},
): Promise<TreeHashResult> {
  // Union, never replacement. L1 names DEFAULT_IGNORE as part of the
  // algorithm, so a caller that could shrink it could make two
  // implementations disagree about the same directory — which is precisely
  // the drift the law exists to forbid. `??` would have allowed exactly
  // that, quietly, from any caller.
  let ignore = options.ignore
    ? new Set([...DEFAULT_IGNORE, ...options.ignore])
    : DEFAULT_IGNORE;
  let entries: TreeHashEntry[] = [];
  // Normalised path -> the on-disk name it came from, so a directory that
  // holds both encodings of one name reports something a human can act on
  // instead of "duplicate tree path" for two identical-looking strings.
  let seenOnDisk = new Map<string, string>();
  async function walk(current: string, prefix: string): Promise<void> {
    for (let dirent of await readdir(current, { withFileTypes: true })) {
      if (ignore.has(dirent.name) || dirent.name.startsWith('.jj.')) {
        continue;
      }
      let raw = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`;
      // The filesystem chose this encoding, not the author — HFS+ hands
      // back NFD for a name that was written as NFC. Normalising here is
      // what makes the same logical tree hash the same on every platform.
      let path = normalizeTreePath(raw);
      let clash = seenOnDisk.get(path);
      if (clash !== undefined && clash !== raw) {
        throw new Error(
          `${JSON.stringify(clash)} and ${JSON.stringify(raw)} are different ` +
            `byte sequences for the same Unicode NFC path ${JSON.stringify(path)}. ` +
            `A deck cannot contain both; rename one.`,
        );
      }
      seenOnDisk.set(path, raw);
      if (dirent.isDirectory()) {
        await walk(join(current, dirent.name), path);
      } else if (dirent.isFile()) {
        entries.push({
          path,
          sha256: hashBytes(await readFile(join(current, dirent.name))),
        });
      }
      // Symlinks and other non-regular entries are deliberately not part
      // of a logical tree; a deck is files only.
    }
  }
  await walk(dir, '');
  return { ...treeHashFromEntries(entries), onDiskPaths: seenOnDisk };
}

// The name to hand the filesystem for a logical path. Identity is always
// the NFC form; only the reopen is spelled the OS's way.
export function onDiskPathFor(
  result: Pick<TreeHashResult, 'onDiskPaths'>,
  path: string,
): string {
  return result.onDiskPaths?.get(path) ?? path;
}

export function formatTreeHash(result: Pick<TreeHashResult, 'treeHash'>) {
  return `${TREE_HASH_SPEC}:${result.treeHash}`;
}
