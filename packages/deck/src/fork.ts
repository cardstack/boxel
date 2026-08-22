import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { unpack } from './pack.ts';
import { IMPORT_MAP_PATH } from './import-map.ts';
import type { ForkedFrom } from './offer.ts';
import { readStoreMeta, readStoredPack, resolveVersionSpec } from './store.ts';
import { readTreeFromDir } from './tree.ts';
import { treeHashFromDir } from './tree-hash.ts';

// Fork: take somebody else's deck and start changing it at byte speed,
// without asking, without planning to publish, without touching what they
// publish.
//
// Nothing new is needed to make that safe — the PUBLISHER SEGMENT already is
// the boundary. `acme/palette` and `you/palette` are different names, with
// different version lines, different dist-tags, different store entries, in
// the same depot. So a fork is: copy the tree into your own scope, point
// your app at it, and edit. Your saves auto-publish under YOUR name; acme's
// versions never move.
//
// Two cheap properties fall out of the rest of the design:
//   - a fork that has not diverged has the SAME treeHash as its source, so
//     the content-addressed store holds one copy of the bytes, not two
//   - the copy is an ordinary edit of the depot, so it is sealed like any
//     other — an experiment you can walk back from
//
// The source can be the live tree (what `ls` shows: the latest bytes) or any
// sealed version. Forking a version is the reproducible one; forking live is
// the one you want at 2am.

export interface ForkSource {
  publisher: string;
  package: string;
  // A version, range, or dist-tag. Omitted means the live tree.
  spec?: string;
}

export interface ForkTarget {
  publisher: string;
  package: string;
}

export interface ForkResult {
  from: string;
  to: string;
  // The exact version forked, when forking a sealed one.
  version?: string;
  // The tree the fork started from — the merge base for every later rebase.
  baseTreeHash: string;
  files: string[];
  dir: string;
}

export interface ForkOptions {
  depotDir: string;
  storeDir: string;
  from: ForkSource;
  to: ForkTarget;
  force?: boolean;
  // Who is making the offer. Recorded in the fork's own map, so it survives
  // copying — and is where a Matrix user id goes when this reaches the
  // realm server.
  actor?: string;
  // Exact upstream Checkpoint when forking a mutable package through Hub.
  baseCheckpointHash?: string;
}

// The map travels with the copy, so it has to say what the copy IS: the
// package key follows the new name, and the lineage is recorded rather than
// lost. Everything else the author wrote is left untouched.
function rewriteMap(
  mapText: string,
  from: ForkSource,
  to: ForkTarget,
  forkedFrom: ForkedFrom,
): string {
  let parsed = JSON.parse(mapText);
  parsed.deck ??= {};
  parsed.deck.packages ??= {};
  let vendor = parsed.deck;
  if (vendor.packages[from.package] && from.package !== to.package) {
    vendor.packages[to.package] = vendor.packages[from.package];
    delete vendor.packages[from.package];
  }
  vendor.packages[to.package] ??= {};
  vendor.packages[to.package].forkedFrom = forkedFrom;
  return JSON.stringify(parsed, null, 2) + '\n';
}

export async function forkDeck(options: ForkOptions): Promise<ForkResult> {
  let { depotDir, storeDir, from, to, force, actor, baseCheckpointHash } = options;
  let targetDir = join(depotDir, to.publisher, to.package);
  let exists = await stat(targetDir).then(
    () => true,
    () => false,
  );
  if (exists && !force) {
    throw new Error(
      `${to.publisher}/${to.package} already exists — pick another name, or pass force to overwrite`,
    );
  }

  let files: Map<string, Buffer>;
  let version: string | undefined;
  // The base treeHash is what makes this a proposal rather than a copy: it
  // is the third input every later three-way merge needs.
  let baseTreeHash: string;
  if (from.spec === undefined) {
    let sourceDir = join(depotDir, from.publisher, from.package);
    files = await readTreeFromDir(sourceDir);
    baseTreeHash = (await treeHashFromDir(sourceDir)).treeHash;
  } else {
    let name = `${from.publisher}/${from.package}`;
    let meta = await readStoreMeta(storeDir, name);
    if (!meta) {
      throw new Error(`no published versions for ${name}`);
    }
    let resolution = resolveVersionSpec(from.spec, meta);
    if (resolution.kind === 'not-found' || resolution.kind === 'invalid') {
      throw new Error(`${name}@${from.spec}: ${resolution.detail}`);
    }
    version = resolution.version;
    let bytes = await readStoredPack(storeDir, name, version);
    if (!bytes) {
      throw new Error(`${name}@${version} has no stored pack`);
    }
    let opened = unpack(bytes);
    files = opened.files;
    baseTreeHash = opened.treeHash;
  }
  if (files.size === 0) {
    throw new Error(`${from.publisher}/${from.package} has no files to fork`);
  }

  let forkedFrom: ForkedFrom = {
    package: `${from.publisher}/${from.package}`,
    ...(version ? { version } : {}),
    treeHash: baseTreeHash,
    ...(baseCheckpointHash ? { checkpointHash: baseCheckpointHash } : {}),
    ...(actor ? { actor } : {}),
  };
  let pkgText = files.get('package.json')?.toString('utf8');
  if (pkgText) {
    let pkg = JSON.parse(pkgText) as { name?: string };
    if (
      typeof pkg.name === 'string' &&
      (pkg.name === from.package || pkg.name.endsWith(`/${from.package}`))
    ) {
      pkg.name = to.package;
    }
    files.set(
      'package.json',
      Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`, 'utf8'),
    );
  }
  let mapText = files.get(IMPORT_MAP_PATH)?.toString('utf8') ?? '{"imports":{}}\n';
  files.set(
    IMPORT_MAP_PATH,
    Buffer.from(rewriteMap(mapText, from, to, forkedFrom), 'utf8'),
  );
  for (let [path, bytes] of files) {
    let destination = join(targetDir, ...path.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  return {
    from: `${from.publisher}/${from.package}${version ? `@${version}` : ''}`,
    to: `${to.publisher}/${to.package}`,
    version,
    baseTreeHash,
    files: [...files.keys()].sort(),
    dir: targetDir,
  };
}
