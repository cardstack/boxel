import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import { unpack } from './pack.ts';
import { packagesFromPack } from './import-map-pack.ts';
import {
  collectGarbage,
  readTreeFile,
  rebuildPack,
  storePack,
  storeUsage,
  type GcResult,
  type StoreUsage,
} from './object-store.ts';

// A Deck store is pure at-rest state on disk — the standalone counterpart
// of the depot's bookmarks. The server only READS it; all writes go through
// the CLI/watcher (an agent arranges state; distribution follows).
//
//   <store>/_objects/<aa>/<sha256>             — one FILE's bytes, once
//   <store>/_trees/<aa>/<treeHash>.json        — one tree's packlist, once
//   <store>/<publisher>/<package>/meta.json    — versions + dist-tags
//
// The store path mirrors the URL path: a package addressed as
// `/<depot>/<publisher>/<package>@<version>/<file>` is stored under
// `<depot>/.deck/store/<publisher>/<package>/`. Same shape on disk and on
// the wire, so neither has to be translated into the other.
//
// The store is CONTENT-ADDRESSED PER FILE, and the objects are store-wide
// rather than per package. A version is a POINTER (version → treeHash) in
// meta.json; the tree names its files; the files are shared by everyone.
// Three consequences, all deliberate:
//   - publishing a tree whose bytes are already stored writes no new bytes
//   - editing ONE file in a 374-module package costs one object, not a
//     second copy of the package
//   - an undiverged fork costs nothing at all, across publishers
// RELEASING a new version from an existing sealed state (a dev prerelease,
// a tag, another version) remains a metadata edit — never a copy.
// "Publish never seals new content" holds as "release never writes bytes."
//
// The pack is rebuilt from objects on demand rather than stored, which
// keeps `pack(unpack(P)) === P` byte-exact because canonical-zip-v1 is
// deterministic and the packlist fixes the order and the hashes.
//
// Invariants:
//   - published versions are immutable: re-publishing refuses; meta updates
//     are atomic (tmp+rename)
//   - only verified packs enter the store (full unpack verification)
//   - manifest agreement: when the pack's import map declares a version for
//     the package, a published stable must EQUAL it, and a prerelease must
//     extend it (`<declared>-…`) — so bumping the map version in the live
//     tree is the ONLY edit a new line needs
//   - dist-tags are movable; names never semver-shaped; `latest` never
//     points at a prerelease

export type StorageKind = 'blobs-v1' | 'pack-v1';

export interface StoreVersionRecord {
  treeHash: string;
  // How this version's bytes are materialised. Self-describing rather than
  // inferred, so a reader never has to guess from which other fields happen
  // to be present — and so a future third form is an added value here
  // instead of a new inference rule everywhere.
  storage?: StorageKind;
  // Legacy one-zip-per-tree stores wrote a path here, relative to
  // <store>/<name>/. New records carry only the treeHash: the bytes live in
  // the store-wide object and tree directories, and the pack is rebuilt on
  // demand. Both shapes are read; only the second is written.
  file?: string;
  // WHEN, so a list of versions can be a timeline.
  //
  // Two different instants, and conflating them would be the bug. `publishedAt`
  // is when this version entered THIS store — the local event, true of every
  // version however it got here. `upstreamPublishedAt` is when the registry
  // published the thing we vendored, which is the only one of the two that
  // says anything about the software itself: three.js r150 was published by
  // npm long before anyone here vendored it, and a list sorted by our clock
  // would put a two-year-old library above one released last week purely
  // because of the order someone happened to run the commands in.
  //
  // Both are recorded because both get asked for. "What did we take on, and
  // when" is upstream; "what changed on this machine" is local.
  //
  // Absent means unknown, and stays absent: a record written before this
  // field existed has no honest time to backfill, and inventing one — the
  // file's mtime, the moment it was first read — would make an at-rest store
  // report a different history depending on when you asked it.
  publishedAt?: string;
  upstreamPublishedAt?: string;
}

export interface StoreMeta {
  name: string;
  versions: Record<string, StoreVersionRecord>;
  tags: Record<string, string>;
  // The upstream coordinate every version in this deck claims to come from,
  // as `<registry>:<name>`. Recorded from the first vendored version and
  // then enforced. Absent for decks nobody vendored.
  upstream?: string;
}

// One path segment: kebab, alnum-led, no dots (a dot would let a name
// masquerade as a file path or a version segment).
const SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

// A store name is `<publisher>/<package>` — the same two segments that
// address it in a URL, so the store path and the URL path are the same
// shape. A bare `<package>` stays legal for an unscoped store.
export function isValidPackageName(name: string): boolean {
  let segments = name.split('/');
  return segments.length <= 2 && segments.every((s) => SEGMENT.test(s));
}

export function packageDir(storeDir: string, name: string): string {
  return join(storeDir, ...name.split('/'));
}

// The map inside a pack is keyed by the PACKAGE, not the scope: identity
// comes from where the deck sits on disk, and the map only says which
// version it is. Nothing has to be rewritten when a deck moves publishers.
function mapKeyFor(name: string): string {
  return name.split('/').at(-1)!;
}

const DIST_TAG = /^[a-z][a-z0-9-]{0,31}$/;
export function isValidDistTag(tag: string): boolean {
  return (
    DIST_TAG.test(tag) &&
    semver.valid(tag) === null &&
    semver.validRange(tag) === null
  );
}

function metaPath(storeDir: string, name: string): string {
  return join(packageDir(storeDir, name), 'meta.json');
}

export async function readStoreMeta(
  storeDir: string,
  name: string,
): Promise<StoreMeta | undefined> {
  if (!isValidPackageName(name)) {
    return undefined;
  }
  try {
    let parsed = JSON.parse(await readFile(metaPath(storeDir, name), 'utf8'));
    // Records written before the discriminator existed are pack-v1 exactly
    // when they name an archive. Normalising on read means nothing else in
    // the codebase has to know that.
    let versions = (parsed.versions ?? {}) as Record<string, StoreVersionRecord>;
    for (let record of Object.values(versions)) {
      record.storage ??= record.file ? 'pack-v1' : 'blobs-v1';
    }
    return {
      name,
      versions,
      tags: parsed.tags ?? {},
      // Carried through explicitly. A field that is written but not read
      // back is worse than one that was never added: the enforcement it
      // exists for compares against undefined every time and always passes.
      ...(typeof parsed.upstream === 'string'
        ? { upstream: parsed.upstream }
        : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Every package that has a meta.json in the store, sorted by name. Scoped
 * (`<publisher>/<package>`) and unscoped (`<package>`) both appear, found by
 * looking for the meta.json rather than by assuming a depth.
 */
export async function listStorePackages(
  storeDir: string,
): Promise<StoreMeta[]> {
  let packages: StoreMeta[] = [];
  for (let first of await readdirSafe(storeDir)) {
    if (!SEGMENT.test(first)) continue;
    let meta = await readStoreMeta(storeDir, first);
    if (meta && Object.keys(meta.versions).length > 0) {
      packages.push(meta);
      continue;
    }
    for (let second of await readdirSafe(join(storeDir, first))) {
      if (!SEGMENT.test(second)) continue;
      let scoped = await readStoreMeta(storeDir, `${first}/${second}`);
      if (scoped && Object.keys(scoped.versions).length > 0) {
        packages.push(scoped);
      }
    }
  }
  return packages.sort((a, b) => (a.name < b.name ? -1 : 1));
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

async function writeStoreMeta(
  storeDir: string,
  meta: StoreMeta,
): Promise<void> {
  let path = metaPath(storeDir, meta.name);
  let tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(meta, null, 2) + '\n');
  await rename(tmp, path);
}

function assertTagRules(tag: string, version: string): void {
  if (!isValidDistTag(tag)) {
    throw new Error(
      `"${tag}" is not a valid dist-tag (lowercase, not semver-shaped)`,
    );
  }
  if (tag === 'latest' && semver.prerelease(version) !== null) {
    throw new Error(`latest may only point at a stable release`);
  }
}

// Manifest agreement: the pack's own import map is the manifest. When it
// declares a version for this package, the published version must be that
// version (stable) or extend it as a prerelease (`<declared>-…`). Undeclared
// packages (plain libraries without a map entry) publish unconstrained.
function assertManifestAgreement(
  name: string,
  version: string,
  packBytes: Buffer,
): void {
  let declared = packagesFromPack(packBytes)?.[mapKeyFor(name)]?.version;
  if (declared === undefined) {
    return;
  }
  if (version === declared || version.startsWith(`${declared}-`)) {
    return;
  }
  throw new Error(
    `importmap.json declares ${name}@${declared}, but the request is publishing ${name}@${version}`,
  );
}

// One deck, one upstream.
//
// A deck name is a RESOLUTION KEY: a range picks a version out of this list,
// so every version in the list has to be the same library. Nothing else
// enforces that. `deckNameForNpm` folds npm's namespace into one lowercase
// segment, which is not injective — `@babel/runtime` and `babel-runtime` are
// both real packages and both land here as `babel-runtime` — and a hand-
// passed `--name` can collide however careful the automatic mapping gets.
//
// Per-version provenance stays honest either way; L8 is not what breaks. L7
// is: `^7.0.0` would be choosing between versions of two different libraries.
//
// This is a backstop, deliberately. It is the last line rather than the
// answer, because it can only refuse at the moment of collision — the name
// derivation is where the information was lost.
//
// The pack is also where the upstream's own publish time is, recorded at
// vendor time by the cooldown check. Reading it here rather than passing it
// down means it cannot drift from the provenance it came with: one pack, one
// answer, and a re-publish of the same bytes reports the same instant.
function upstreamOf(
  packBytes: Buffer,
  name: string,
): { coordinate: string; publishedAt?: string } | undefined {
  let entry = packagesFromPack(packBytes)?.[mapKeyFor(name)] as
    | {
        vendoredFrom?: {
          registry?: string;
          name?: string;
          publishedAt?: string;
        };
      }
    | undefined;
  let from = entry?.vendoredFrom;
  if (!from?.name) {
    return undefined;
  }
  return {
    coordinate: `${from.registry ?? 'npm'}:${from.name}`,
    ...(typeof from.publishedAt === 'string'
      ? { publishedAt: from.publishedAt }
      : {}),
  };
}

function assertUpstreamAgreement(
  meta: StoreMeta,
  name: string,
  version: string,
  incoming: string | undefined,
): void {
  if (!incoming || !meta.upstream || meta.upstream === incoming) {
    return;
  }
  throw new Error(
    `${name} already holds versions vendored from ${meta.upstream}, but ` +
      `${version} comes from ${incoming}. One deck name is one library — a ` +
      `range resolving across both would be choosing between two. Vendor it ` +
      `under a different name (--name).`,
  );
}

export async function publishToStore(
  storeDir: string,
  name: string,
  version: string,
  packBytes: Buffer,
  // `now` is injectable so a test can publish a known history rather than
  // whatever the clock said while it ran.
  options: { tag?: string; now?: Date } = {},
): Promise<StoreVersionRecord> {
  if (!isValidPackageName(name)) {
    throw new Error(`invalid package name: ${JSON.stringify(name)}`);
  }
  if (semver.valid(version) !== version) {
    throw new Error(`not an exact canonical semver version: ${version}`);
  }
  let { tag } = options;
  if (tag !== undefined) {
    assertTagRules(tag, version);
  }
  // Only verified packs enter the store.
  let { treeHash } = unpack(packBytes);
  assertManifestAgreement(name, version, packBytes);
  let meta = (await readStoreMeta(storeDir, name)) ?? {
    name,
    versions: {},
    tags: {},
  };
  if (meta.versions[version]) {
    throw new Error(`version already published: ${name}@${version}`);
  }
  let upstream = upstreamOf(packBytes, name);
  assertUpstreamAgreement(meta, name, version, upstream?.coordinate);
  // Content-addressed per file, store-wide: only the objects this tree
  // introduces are written, so a one-file edit costs one object and a
  // re-publish of already-stored content costs nothing.
  await mkdir(packageDir(storeDir, name), { recursive: true });
  await storePack(storeDir, packBytes);
  let record: StoreVersionRecord = {
    treeHash,
    storage: 'blobs-v1',
    publishedAt: (options.now ?? new Date()).toISOString(),
    ...(upstream?.publishedAt
      ? { upstreamPublishedAt: upstream.publishedAt }
      : {}),
  };
  meta.versions[version] = record;
  if (upstream) {
    meta.upstream = upstream.coordinate;
  }
  if (tag) {
    meta.tags[tag] = version;
  }
  await writeStoreMeta(storeDir, meta);
  return record;
}

// THE no-copies version update: name an EXISTING sealed state (found via a
// dist-tag or a published version) as a new version. No pack is read into
// memory beyond the manifest check, no bytes are written, nothing is
// copied — the new version is a pointer to the same sealed content.
export async function releaseVersion(
  storeDir: string,
  name: string,
  version: string,
  from: { tag?: string; version?: string },
  options: { tag?: string; now?: Date } = {},
): Promise<StoreVersionRecord> {
  if (semver.valid(version) !== version) {
    throw new Error(`not an exact canonical semver version: ${version}`);
  }
  let meta = await readStoreMeta(storeDir, name);
  if (!meta) {
    throw new Error(`no published versions for package ${name}`);
  }
  let sourceVersion =
    from.version ?? (from.tag ? meta.tags[from.tag] : undefined);
  if (!sourceVersion) {
    throw new Error(
      from.tag
        ? `no dist-tag "${from.tag}" for ${name}`
        : `release requires a source: { tag } or { version }`,
    );
  }
  let record = meta.versions[sourceVersion];
  if (!record) {
    throw new Error(`${name}@${sourceVersion} is not a published version`);
  }
  if (meta.versions[version]) {
    throw new Error(`version already published: ${name}@${version}`);
  }
  let { tag } = options;
  if (tag !== undefined) {
    assertTagRules(tag, version);
  }
  // The sealed content must AGREE it is this version: the map inside the
  // seal declares it. Bumping the map version in the live tree — one edit,
  // part of the seal — is what makes a state releasable as that version.
  let packBytes = await readRecordPack(storeDir, name, record);
  if (!packBytes) {
    throw new Error(
      `${name}@${sourceVersion} has no stored content (treeHash ${record.treeHash})`,
    );
  }
  assertManifestAgreement(name, version, packBytes);
  // The content is the source's; the RELEASE is a new event. `publishedAt` is
  // now — someone decided, today, that these bytes are 1.2.0 — while
  // `upstreamPublishedAt` is carried across unchanged, because the upstream
  // did not publish anything and saying it did would be a fabrication.
  let released: StoreVersionRecord = {
    ...record,
    publishedAt: (options.now ?? new Date()).toISOString(),
  };
  meta.versions[version] = released;
  if (tag) {
    meta.tags[tag] = version;
  }
  await writeStoreMeta(storeDir, meta);
  return { ...released };
}

export async function setDistTag(
  storeDir: string,
  name: string,
  tag: string,
  version: string,
): Promise<void> {
  let meta = await readStoreMeta(storeDir, name);
  if (!meta || !meta.versions[version]) {
    throw new Error(`${name}@${version} is not a published version`);
  }
  assertTagRules(tag, version);
  meta.tags[tag] = version;
  await writeStoreMeta(storeDir, meta);
}

export type SpecResolution =
  | { kind: 'exact'; version: string }
  | { kind: 'redirect'; version: string }
  | { kind: 'not-found'; detail: string }
  | { kind: 'invalid'; detail: string };

// Identical semantics to the realm-server implementation: exact before
// range (so an exact prerelease matches directly), tags before ranges,
// npm prerelease exclusion, and the invalid-vs-not-found permanence split.
export function resolveVersionSpec(
  spec: string,
  meta: StoreMeta,
): SpecResolution {
  let versions = Object.keys(meta.versions);
  if (semver.valid(spec) === spec) {
    return versions.includes(spec)
      ? { kind: 'exact', version: spec }
      : { kind: 'not-found', detail: `${spec} is not a published version` };
  }
  let tagged = meta.tags[spec];
  if (tagged) {
    return { kind: 'redirect', version: tagged };
  }
  if (semver.validRange(spec)) {
    let best = semver.maxSatisfying(versions, spec);
    return best
      ? { kind: 'redirect', version: best }
      : { kind: 'not-found', detail: `no published version satisfies ${spec}` };
  }
  if (isValidDistTag(spec)) {
    return {
      kind: 'not-found',
      detail: `no dist-tag "${spec}" for this package`,
    };
  }
  return {
    kind: 'invalid',
    detail: `"${spec}" is not a version, dist-tag, or semver range`,
  };
}

async function readRecordPack(
  storeDir: string,
  name: string,
  record: StoreVersionRecord,
): Promise<Buffer | undefined> {
  if (record.storage === 'pack-v1' && record.file) {
    // A store written before per-file addressing. Still readable, so
    // nobody has to migrate to keep serving.
    try {
      return await readFile(join(packageDir(storeDir, name), record.file));
    } catch {
      return undefined;
    }
  }
  return rebuildPack(storeDir, record.treeHash);
}

export async function readStoredPack(
  storeDir: string,
  name: string,
  version: string,
): Promise<Buffer | undefined> {
  let meta = await readStoreMeta(storeDir, name);
  let record = meta?.versions[version];
  return record ? readRecordPack(storeDir, name, record) : undefined;
}

// ONE file out of a published version. The server's hot path: serving
// `src/math/Vector3.js` out of a 374-module deck reads one object instead
// of decoding a 438 KB archive. Legacy records fall back to the archive.
export async function readStoredFile(
  storeDir: string,
  name: string,
  version: string,
  path: string,
): Promise<Buffer | undefined> {
  let meta = await readStoreMeta(storeDir, name);
  let record = meta?.versions[version];
  if (!record) {
    return undefined;
  }
  if (record.storage !== 'pack-v1') {
    return readTreeFile(storeDir, record.treeHash, path);
  }
  let packBytes = await readRecordPack(storeDir, name, record);
  return packBytes ? unpack(packBytes).files.get(path) : undefined;
}

export interface PruneResult {
  removedVersions: string[];
  // Legacy per-package archives removed. Empty on a per-file store.
  deletedFiles: string[];
  gc: GcResult;
}

// Auto-publishing accumulates dev prereleases, so the store needs a policy.
// Only `-dev.N` prereleases are prunable — stables and anything a dist-tag
// points at are never touched, so the public surface stays immutable.
//
// The content-addressed subtlety is now store-wide. Several versions can
// share one tree (a release names a dev state without copying it), and every
// package in the store shares the same objects, so dropping a version record
// is not permission to delete anything. Collection asks the whole store what
// is still referenced, then deletes only what nothing names.
export async function pruneDevVersions(
  storeDir: string,
  name: string,
  options: { keep?: number } = {},
): Promise<PruneResult> {
  let keep = options.keep ?? 10;
  let meta = await readStoreMeta(storeDir, name);
  if (!meta) {
    return { removedVersions: [], deletedFiles: [], gc: emptyGc() };
  }
  let tagged = new Set(Object.values(meta.tags));
  let devVersions = Object.keys(meta.versions)
    .filter((version) => /-dev\.\d+$/.test(version) && !tagged.has(version))
    .sort((a, b) => semver.compare(a, b));
  let removedVersions = devVersions.slice(
    0,
    Math.max(0, devVersions.length - keep),
  );
  if (removedVersions.length === 0) {
    return { removedVersions: [], deletedFiles: [], gc: emptyGc() };
  }
  let condemnedLegacy = new Set<string>();
  for (let version of removedVersions) {
    let record = meta.versions[version];
    if (record.file) {
      condemnedLegacy.add(record.file);
    }
    delete meta.versions[version];
  }
  await writeStoreMeta(storeDir, meta);

  // Legacy zips are per package, so they are collected the old way.
  let stillReferenced = new Set(
    Object.values(meta.versions)
      .map((record) => record.file)
      .filter((file): file is string => file !== undefined),
  );
  let deletedFiles: string[] = [];
  for (let file of condemnedLegacy) {
    if (stillReferenced.has(file)) {
      continue;
    }
    await rm(join(packageDir(storeDir, name), file), { force: true });
    deletedFiles.push(file);
  }
  return {
    removedVersions,
    deletedFiles,
    gc: await collectStoreGarbage(storeDir),
  };
}

function emptyGc(): GcResult {
  return { treesDeleted: 0, objectsDeleted: 0, bytesFreed: 0 };
}

// Every treeHash any published version still points at, across every
// package. Objects are shared, so nothing narrower is safe.
export async function liveTreeHashes(storeDir: string): Promise<Set<string>> {
  let live = new Set<string>();
  for (let meta of await listStorePackages(storeDir)) {
    for (let record of Object.values(meta.versions)) {
      live.add(record.treeHash);
    }
  }
  return live;
}

export async function collectStoreGarbage(
  storeDir: string,
): Promise<GcResult> {
  return collectGarbage(storeDir, await liveTreeHashes(storeDir));
}

export interface StoreReport extends StoreUsage {
  packages: number;
  versions: number;
  liveTrees: number;
  // Trees and objects nothing points at any more, without deleting them.
  reclaimableTrees: number;
  legacyArchives: number;
}

export async function inspectStore(storeDir: string): Promise<StoreReport> {
  let usage = await storeUsage(storeDir);
  let packages = await listStorePackages(storeDir);
  let live = await liveTreeHashes(storeDir);
  let versions = 0;
  let legacyArchives = 0;
  for (let meta of packages) {
    for (let record of Object.values(meta.versions)) {
      versions++;
      if (record.storage === 'pack-v1') {
        legacyArchives++;
      }
    }
  }
  return {
    ...usage,
    packages: packages.length,
    versions,
    liveTrees: live.size,
    reclaimableTrees: Math.max(0, usage.trees - live.size),
    legacyArchives,
  };
}

// The next auto-publish number for a dev line: `<base>-dev.<n>`.
export function nextDevVersion(
  meta: StoreMeta | undefined,
  base: string,
): string {
  let max = 0;
  for (let version of Object.keys(meta?.versions ?? {})) {
    let match = version.match(
      new RegExp(`^${base.replace(/[.+]/g, '\\$&')}-dev\\.(\\d+)$`),
    );
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `${base}-dev.${max + 1}`;
}

export interface MigrateResult {
  migrated: { name: string; version: string; treeHash: string }[];
  alreadyBlobs: number;
  archivesRemoved: string[];
  bytesReclaimed: number;
  failures: { name: string; version: string; detail: string }[];
}

// Convert a legacy one-zip-per-tree store into objects and trees.
//
// Nothing forces this: pack-v1 records keep serving (there is a conformance
// check for it). Migrating is worth doing because the old layout charged a
// full archive for every revision AND for every publisher — the two costs
// per-file addressing removes.
//
// The archives are only deleted once the tree they held reads back
// byte-identically from objects. A migration that cannot prove that leaves
// the original exactly where it was.
export async function migrateStore(
  storeDir: string,
  options: { removeArchives?: boolean; dryRun?: boolean } = {},
): Promise<MigrateResult> {
  let { removeArchives = true, dryRun = false } = options;
  let result: MigrateResult = {
    migrated: [],
    alreadyBlobs: 0,
    archivesRemoved: [],
    bytesReclaimed: 0,
    failures: [],
  };
  for (let meta of await listStorePackages(storeDir)) {
    let changed = false;
    for (let [version, record] of Object.entries(meta.versions)) {
      if (record.storage !== 'pack-v1' || !record.file) {
        result.alreadyBlobs++;
        continue;
      }
      let archive = join(packageDir(storeDir, meta.name), record.file);
      let bytes: Buffer;
      try {
        bytes = await readFile(archive);
      } catch (error) {
        result.failures.push({
          name: meta.name,
          version,
          detail: `cannot read ${record.file}: ${error}`,
        });
        continue;
      }
      if (dryRun) {
        result.migrated.push({ name: meta.name, version, treeHash: record.treeHash });
        continue;
      }
      try {
        let stored = await storePack(storeDir, bytes);
        if (stored.treeHash !== record.treeHash) {
          throw new Error(
            `archive hashes to ${stored.treeHash}, meta claims ${record.treeHash}`,
          );
        }
        // Prove the rebuild before trusting it: L2 or nothing.
        let rebuilt = await rebuildPack(storeDir, record.treeHash);
        if (!rebuilt || !rebuilt.equals(bytes)) {
          throw new Error('the rebuilt pack is not byte-identical');
        }
      } catch (error) {
        result.failures.push({
          name: meta.name,
          version,
          detail: String(error instanceof Error ? error.message : error),
        });
        continue;
      }
      // Rebuild the record rather than spreading, so a legacy `file` is
      // genuinely dropped — but carry the times, which are facts about the
      // release and not about how its bytes happen to be stored.
      meta.versions[version] = {
        treeHash: record.treeHash,
        storage: 'blobs-v1',
        ...(record.publishedAt ? { publishedAt: record.publishedAt } : {}),
        ...(record.upstreamPublishedAt
          ? { upstreamPublishedAt: record.upstreamPublishedAt }
          : {}),
      };
      changed = true;
      result.migrated.push({ name: meta.name, version, treeHash: record.treeHash });
      if (removeArchives) {
        // Several versions can share one archive; only the last one out
        // turns off the light.
        let stillUsed = Object.values(meta.versions).some(
          (other) => other.file === record.file,
        );
        if (!stillUsed) {
          let size = await readFile(archive).then(
            (data) => data.length,
            () => 0,
          );
          await rm(archive, { force: true });
          result.archivesRemoved.push(join(meta.name, record.file));
          result.bytesReclaimed += size;
        }
      }
    }
    if (changed && !dryRun) {
      await writeStoreMeta(storeDir, meta);
    }
  }
  return result;
}
