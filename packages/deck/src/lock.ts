import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import { treePathFromMapValue, IMPORT_MAP_PATH } from './import-map.ts';
import { dependenciesFromPack, packagesFromPack } from './import-map-pack.ts';
import {
  PACKAGE_JSON_PATH,
  isLiveSpec,
  parseNpmAlias,
  parsePackageJson,
  suggestedDependencies,
  entryFromPackageJson,
} from './package-json.ts';
import { discoverDecks } from './deck-scan.ts';
import {
  isValidDistTag,
  listStorePackages,
  readStoreMeta,
  readStoredFile,
  readStoredPack,
} from './store.ts';
import { readZipEntry } from './canonical-zip.ts';
import { canonicalRRIImportMap, parseRRI } from './rri.ts';

// The decklist lock.
//
// package.json holds RANGES — suggestions. The depot-root importmap.json is
// the only authority (docs/deck-package-json-and-depot-lock.md). `deck lock`
// writes that file; `deck lock --update` refreshes it. Nothing upstream
// changes what this depot runs until the owner asks.
//
// The file has the import-map shape, but values and importer scopes are RRIs.
// Logical identity never includes a transport origin or depot mount. A host
// projects this canonical lock into a browser import map at runtime.
//
// pnpm lockfile v9 is the *policy* we emulate when filling those members
// (importers → scopes only when they disagree with `imports`, packages/
// snapshots → pins, overrides, install vs update). An importer scope that
// merely copies top-level pins is omitted: the browser already falls back
// to `imports`. The browser never sees YAML; it sees this map.
//
// Three levels of volatility, all expressible as RRIs
// (docs/deck-unfrozen-mode.md):
//
//   workspace:* / you/pkg@live  → @<pub>/<pkg>/…        every save
//   "latest" / "dev"            → @<pub>/<pkg>@<resolved>/… exact selection
//   "^1.0.0"                    → @<pub>/<pkg>@1.2.0/…   exact pin
//
// Dist-tags and ranges both resolve to exact Versions in the canonical lock.
// Prereleases are excluded from range matching (the npm rule), so a `^1.0.0`
// dependency never silently picks up somebody's auto-published dev line.

export const LIVE_SPEC = 'live';
export const DEPOT_LOCK_PATH = IMPORT_MAP_PATH;

export interface DependencyResolution {
  // The declared key: `<publisher>/<package>` or `<depot>/<publisher>/<package>`.
  key: string;
  depot: string;
  publisher: string;
  package: string;
  spec: string;
  // Set when the key is answered by a DIFFERENT deck than the key names —
  // a fork standing in for its base under the base's own specifier.
  alias?: string;
  // The exact version the range resolved to; undefined when pinned to live.
  version?: string;
  entry?: string;
  treeHash?: string;
  // The import-map entries this resolution contributes.
  imports: Record<string, string>;
  // What the map pointed at before, when it is changing.
  previous?: string;
}

export interface PackageLocation {
  publisher: string;
  package: string;
  npmName?: string;
}

// Read a path relative to a tree root (live depot or a History Step).
// Returns undefined when the path is absent — same contract as history
// `fileAt`.
export type TreeFileReader = (
  path: string,
) => Promise<Buffer | string | undefined>;

export interface ResolveOptions {
  depotDir: string;
  depotName: string;
  storeDir: string;
  dependencies: Record<string, string>;
  // The map being locked, so the report can say what moved.
  currentImports?: Record<string, string>;
  // npm name → layout. Built automatically when omitted.
  locate?: Map<string, PackageLocation>;
  // When set, live (versionless) entry resolution reads package.json from
  // this tree instead of `depotDir` — how a History Step binds siblings
  // to that Step's own bytes.
  readTreeFile?: TreeFileReader;
}

const SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

function parseKey(
  key: string,
  defaultDepot: string,
): { depot: string; publisher: string; package: string } | undefined {
  let segments = key.split('/');
  if (segments.length === 2 && segments.every((s) => SEGMENT.test(s))) {
    return {
      depot: defaultDepot,
      publisher: segments[0],
      package: segments[1],
    };
  }
  if (segments.length === 3 && segments.every((s) => SEGMENT.test(s))) {
    return { depot: segments[0], publisher: segments[1], package: segments[2] };
  }
  return undefined;
}

// A dependency value is normally a range: `"acme/three": "^0.160.0"`, and
// the key is both the deck and the import specifier.
//
// It may instead ALIAS another deck: `"acme/three": "you/three@live"`. Then
// the key stays the specifier and the value says which deck answers to it.
// That is what lets a fork stand in for its base without every consumer
// rewriting its own `import` statements — the same substitution `?with=`
// performs at serve time, made durable in the lock.
export interface DependencyValue {
  target?: string;
  spec: string;
}

export function parseDependencyValue(value: string): DependencyValue {
  if (isLiveSpec(value)) {
    return { spec: LIVE_SPEC };
  }
  let aliased = parseNpmAlias(value);
  if (aliased) {
    return { target: aliased.name, spec: aliased.range };
  }
  if (!value.includes('/')) {
    return { spec: value };
  }
  let at = value.lastIndexOf('@');
  // A bare `you/three` is omitted-spec, defaulting to live — convenience,
  // not a fourth word for live. Canonical write is `you/three@live`.
  if (at <= 0) {
    return { target: value, spec: LIVE_SPEC };
  }
  return { target: value.slice(0, at), spec: value.slice(at + 1) || LIVE_SPEC };
}

// The `@` segment written into the lock RRI. Live has none; every other
// selector resolves to an exact Version before it enters the lock.
function pinSegment(
  spec: string,
  version: string | undefined,
): string | undefined {
  if (spec === LIVE_SPEC) {
    return undefined;
  }
  return version;
}

function versionedBase(
  base: string,
  spec: string,
  version: string | undefined,
): string {
  let segment = pinSegment(spec, version);
  return segment === undefined ? base : `${base}@${segment}`;
}

// npm's rule: a range never matches a prerelease. An exact prerelease pin or
// a dist-tag is how you opt in on purpose.
function resolveSpec(
  spec: string,
  meta: { versions: Record<string, unknown>; tags: Record<string, string> },
): string | undefined {
  let versions = Object.keys(meta.versions);
  if (semver.valid(spec) === spec) {
    return versions.includes(spec) ? spec : undefined;
  }
  if (meta.tags[spec]) {
    return meta.tags[spec];
  }
  if (semver.validRange(spec)) {
    return (
      semver.maxSatisfying(
        versions.filter((version) => semver.prerelease(version) === null),
        spec,
      ) ?? undefined
    );
  }
  return undefined;
}

async function readTreeText(
  readTreeFile: TreeFileReader | undefined,
  path: string,
): Promise<string | undefined> {
  if (!readTreeFile) {
    return undefined;
  }
  let raw = await readTreeFile(path);
  if (raw === undefined) {
    return undefined;
  }
  return typeof raw === 'string' ? raw : raw.toString('utf8');
}

function entryOf(
  options: ResolveOptions,
  target: { depot: string; publisher: string; package: string },
  version: string | undefined,
): Promise<string | undefined> {
  if (version === undefined) {
    let pkgPath = `${target.publisher}/${target.package}/${PACKAGE_JSON_PATH}`;
    return readTreeText(options.readTreeFile, pkgPath).then(
      async (fromTree) => {
        if (fromTree !== undefined) {
          return entryFromPackageJson(parsePackageJson(fromTree) ?? {});
        }
        let dir = join(options.depotDir, target.publisher, target.package);
        try {
          let pkgText = await readFile(join(dir, PACKAGE_JSON_PATH), 'utf8');
          return entryFromPackageJson(parsePackageJson(pkgText) ?? {});
        } catch {
          return undefined;
        }
      },
    );
  }
  return readStoredPack(
    options.storeDir,
    `${target.publisher}/${target.package}`,
    version,
  ).then((bytes) => {
    if (!bytes) return undefined;
    let fromPack = packagesFromPack(bytes);
    let value =
      fromPack?.[target.package]?.entry ??
      fromPack?.[Object.keys(fromPack ?? {})[0] ?? '']?.entry;
    return value ? treePathFromMapValue(value) : undefined;
  });
}

function remember(
  index: Map<string, PackageLocation>,
  key: string,
  location: PackageLocation,
): void {
  if (!index.has(key)) {
    index.set(key, location);
  }
}

export async function inventoryLocations(options: {
  depotDir: string;
  storeDir: string;
}): Promise<Map<string, PackageLocation>> {
  let index = new Map<string, PackageLocation>();
  if (options.depotDir) {
    for (let deck of await discoverDecks(options.depotDir)) {
      let location: PackageLocation = {
        publisher: deck.publisher,
        package: deck.package,
      };
      remember(index, deck.name, location);
      remember(index, deck.package, location);
      try {
        let pkg = parsePackageJson(
          await readFile(join(deck.dir, PACKAGE_JSON_PATH), 'utf8'),
        );
        if (pkg?.name) {
          location.npmName = pkg.name;
          remember(index, pkg.name, location);
          remember(index, pkg.name.replace(/^@[^/]+\//, ''), location);
        }
      } catch {
        // live tree without package.json — layout name is enough
      }
    }
  }
  await rememberStorePackages(index, options.storeDir);
  return index;
}

async function rememberStorePackages(
  index: Map<string, PackageLocation>,
  storeDir: string,
): Promise<void> {
  for (let meta of await listStorePackages(storeDir)) {
    let [publisher, pkg] = meta.name.includes('/')
      ? meta.name.split('/')
      : ['', meta.name];
    if (!publisher || !pkg) {
      continue;
    }
    let location: PackageLocation = { publisher, package: pkg };
    remember(index, meta.name, location);
    remember(index, pkg, location);
    let latest =
      meta.tags.latest ??
      semver.maxSatisfying(
        Object.keys(meta.versions).filter(
          (version) => semver.prerelease(version) === null,
        ),
        '*',
      ) ??
      Object.values(meta.tags)[0] ??
      Object.keys(meta.versions)[0];
    if (!latest) {
      continue;
    }
    let bytes = await readStoredPack(storeDir, meta.name, latest);
    if (!bytes) {
      continue;
    }
    let fromPack = packagesFromPack(bytes);
    let npmName =
      fromPack?.[pkg]?.vendoredFrom &&
      typeof fromPack[pkg].vendoredFrom === 'object'
        ? (fromPack[pkg].vendoredFrom as { name?: string }).name
        : undefined;
    // package.json name is the specifier of record when present.
    let pkgJson = (() => {
      let raw = readZipEntry(bytes, PACKAGE_JSON_PATH);
      return raw ? parsePackageJson(raw.toString('utf8')) : undefined;
    })();
    let name = pkgJson?.name ?? npmName;
    if (name) {
      location.npmName = name;
      remember(index, name, location);
      remember(index, name.replace(/^@[^/]+\//, ''), location);
    }
  }
}

function locateTarget(
  key: string,
  alias: string | undefined,
  depotName: string,
  index: Map<string, PackageLocation> | undefined,
): { depot: string; publisher: string; package: string } | undefined {
  if (alias) {
    let fromAlias = parseKey(alias, depotName);
    if (fromAlias) {
      return fromAlias;
    }
    let found = index?.get(alias);
    if (found) {
      return {
        depot: depotName,
        publisher: found.publisher,
        package: found.package,
      };
    }
    return undefined;
  }
  let fromKey = parseKey(key, depotName);
  if (fromKey) {
    return fromKey;
  }
  let found = index?.get(key);
  if (found) {
    return {
      depot: depotName,
      publisher: found.publisher,
      package: found.package,
    };
  }
  return undefined;
}

export async function resolveDependencies(
  options: ResolveOptions,
): Promise<DependencyResolution[]> {
  let locate =
    options.locate ??
    (await inventoryLocations({
      depotDir: options.depotDir,
      storeDir: options.storeDir,
    }));
  let resolutions: DependencyResolution[] = [];
  for (let [key, declared] of Object.entries(options.dependencies)) {
    let { target: alias, spec } = parseDependencyValue(declared);
    let target = locateTarget(key, alias, options.depotName, locate);
    if (!target) {
      if (alias) {
        throw new Error(
          `dependency "${key}" aliases "${alias}", which is not <publisher>/<package> or <depot>/<publisher>/<package>`,
        );
      }
      throw new Error(
        `dependency "${key}" is not an npm name, <publisher>/<package>, or <depot>/<publisher>/<package>`,
      );
    }
    if (target.depot !== options.depotName) {
      throw new Error(
        `dependency "${key}" is in depot ${target.depot}; only ${options.depotName} can be locked from here`,
      );
    }
    let resolvedAlias =
      alias && `${target.publisher}/${target.package}` !== key
        ? `${target.publisher}/${target.package}`
        : `${target.publisher}/${target.package}` !== key
          ? `${target.publisher}/${target.package}`
          : alias;
    let base = `@${target.publisher}/${target.package}`;
    let version: string | undefined;
    if (spec !== LIVE_SPEC) {
      let meta = await readStoreMeta(
        options.storeDir,
        `${target.publisher}/${target.package}`,
      );
      if (!meta || Object.keys(meta.versions).length === 0) {
        throw new Error(`dependency "${key}" has no published versions`);
      }
      version = resolveSpec(spec, meta);
      if (!version) {
        throw new Error(
          `dependency "${key}": no published version satisfies "${spec}"`,
        );
      }
    }
    let versioned = versionedBase(base, spec, version);
    let entry = await entryOf(options, target, version);
    let imports: Record<string, string> = { [`${key}/`]: `${versioned}/` };
    if (entry) {
      imports[key] = `${versioned}/${entry}`;
    }
    resolutions.push({
      key,
      depot: target.depot,
      publisher: target.publisher,
      package: target.package,
      spec,
      ...(resolvedAlias && resolvedAlias !== key
        ? { alias: resolvedAlias }
        : {}),
      version,
      entry,
      imports,
      previous: options.currentImports?.[key],
    });
  }
  return resolutions;
}

export interface LockResult {
  text: string;
  changed: boolean;
}

// A vendored deck's own bare specifiers — tone's `standardized-audio-context`,
// three-bvh-csg's `three` — have to resolve too, and an import map is global
// to the document. Hoisting them all flat would work only while no two decks
// disagree about a version; `scopes` is the shape the platform already has
// for exactly this, so each deck's dependencies resolve inside its own URL
// prefix and two decks may legitimately use different versions of the same
// library.
export interface ScopedResolution {
  // The RRI prefix the scope applies to: "@lib/tone@14.7.77/".
  scope: string;
  imports: Record<string, string>;
}

async function sealedDependencies(
  storeDir: string,
  deck: string,
  version: string,
): Promise<Record<string, string>> {
  let bytes = await readStoredPack(storeDir, deck, version);
  if (!bytes) {
    return {};
  }
  return dependenciesFromPack(bytes);
}

// Walk what the resolved decks themselves depend on, breadth-first, and emit
// one scope per deck. Cycles terminate on the visited set.
export async function resolveScopes(options: {
  depotName: string;
  storeDir: string;
  roots: readonly DependencyResolution[];
  maxDepth?: number;
  locate?: Map<string, PackageLocation>;
  depotDir?: string;
}): Promise<ScopedResolution[]> {
  let { depotName, storeDir, roots, maxDepth = 8 } = options;
  let locate =
    options.locate ??
    (options.depotDir
      ? await inventoryLocations({ depotDir: options.depotDir, storeDir })
      : undefined);
  let scopes = new Map<string, Record<string, string>>();
  let visited = new Set<string>();
  let queue = roots
    .filter((resolution) => resolution.version !== undefined)
    .map((resolution) => ({
      deck: `${resolution.publisher}/${resolution.package}`,
      version: resolution.version!,
      depth: 0,
    }));

  while (queue.length > 0) {
    let job = queue.shift()!;
    let key = `${job.deck}@${job.version}`;
    if (visited.has(key) || job.depth > maxDepth) {
      continue;
    }
    visited.add(key);
    let dependencies = await sealedDependencies(
      storeDir,
      job.deck,
      job.version,
    );
    let scope = `@${job.deck}@${job.version}/`;
    for (let [specifier, declared] of Object.entries(dependencies)) {
      let { target, spec } = parseDependencyValue(declared);
      let child = locateTarget(specifier, target, depotName, locate);
      if (!child) {
        continue;
      }
      let childDeck = `${child.publisher}/${child.package}`;
      // A live edge has no sealed state to put under a Version prefix.
      // Unfrozen live binds are injected at serve time from package.json.
      if (spec === LIVE_SPEC) {
        continue;
      }
      let version: string | undefined;
      if (semver.valid(spec) === spec) {
        version = spec;
      } else {
        let meta = await readStoreMeta(storeDir, childDeck);
        version = meta ? resolveSpec(spec, meta) : undefined;
      }
      if (!version) {
        continue;
      }
      let base = versionedBase(`@${childDeck}`, spec, version);
      let { entry, exports } = await entryAndExportsOf(
        storeDir,
        childDeck,
        version,
      );
      let record = scopes.get(scope) ?? {};
      record[`${specifier}/`] = `${base}/`;
      if (entry) {
        record[specifier] = `${base}/${entry}`;
      }
      for (let [alias, targetPath] of Object.entries(exports)) {
        let sub = alias.replace(/^\.\//, '');
        if (sub === 'package.json' || sub.endsWith('/package.json')) continue;
        record[`${specifier}/${sub}`] = `${base}/${targetPath}`;
      }
      scopes.set(scope, record);
      queue.push({ deck: childDeck, version, depth: job.depth + 1 });
    }
  }
  return [...scopes.entries()]
    .map(([scope, imports]) => ({ scope, imports }))
    .sort((a, b) => a.scope.localeCompare(b.scope));
}

async function entryAndExportsOf(
  storeDir: string,
  deck: string,
  version: string,
): Promise<{ entry?: string; exports: Record<string, string> }> {
  let bytes = await readStoredPack(storeDir, deck, version);
  if (!bytes) {
    return { exports: {} };
  }
  // packagesFromPack is keyed by npm name (`@tanstack/store`, `store`), not
  // the depot layout segment (`tanstack-store`). Fall back to the sole
  // merged entry when the layout name is not one of those keys.
  let fromPack = packagesFromPack(bytes);
  let layoutName = deck.split('/').at(-1)!;
  let mapEntry =
    fromPack?.[layoutName] ??
    (fromPack ? Object.values(fromPack)[0] : undefined);
  let exports: Record<string, string> = {};
  for (let [alias, value] of Object.entries(mapEntry?.exports ?? {})) {
    let sub = alias.replace(/^\.\//, '');
    if (sub === 'package.json' || sub.endsWith('/package.json')) continue;
    let treePath = treePathFromMapValue(value);
    if (
      treePath &&
      !treePath.endsWith('/package.json') &&
      treePath !== 'package.json'
    ) {
      exports[alias] = treePath;
    }
  }
  return {
    entry: mapEntry?.entry ? treePathFromMapValue(mapEntry.entry) : undefined,
    exports,
  };
}

// Writes the pins into the map, leaving everything else — including the
// ranges under `deck.dependencies` — exactly as the author wrote it. The
// ranges are the intent; the pins are what that intent resolved to today.
export function applyLock(
  mapText: string,
  resolutions: readonly DependencyResolution[],
  scoped: readonly ScopedResolution[] = [],
  depotName?: string,
): LockResult {
  let parsed = JSON.parse(mapText);
  let imports: Record<string, string> = { ...(parsed.imports ?? {}) };
  let changed = false;
  let desired = new Set<string>();
  for (let resolution of resolutions) {
    for (let [specifier, target] of Object.entries(resolution.imports)) {
      desired.add(specifier);
      if (imports[specifier] !== target) {
        changed = true;
      }
      imports[specifier] = target;
    }
  }
  // The lock OWNS the pins it writes: drop a dependency from the decklist
  // (or fork away from it) and its pins go too. Anything else in `imports`
  // is the author's and is never touched — a pin is recognised by pointing
  // at the very package its specifier names.
  for (let [specifier, target] of Object.entries(imports)) {
    if (desired.has(specifier) || !isPin(specifier, target, depotName)) {
      continue;
    }
    delete imports[specifier];
    changed = true;
  }
  parsed.imports = imports;

  // Scopes are wholly owned by the lock: they are derived from the sealed
  // decks, never hand-written, so rewriting them entirely is correct and
  // keeps a dropped dependency from leaving a scope behind.
  let nextScopes: Record<string, Record<string, string>> = {};
  for (let { scope, imports: scopeImports } of scoped) {
    nextScopes[scope] = Object.fromEntries(
      Object.entries(scopeImports).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  if (JSON.stringify(parsed.scopes ?? {}) !== JSON.stringify(nextScopes)) {
    changed = true;
  }
  if (Object.keys(nextScopes).length > 0) {
    parsed.scopes = nextScopes;
  } else {
    delete parsed.scopes;
  }
  return { text: JSON.stringify(parsed, null, 2) + '\n', changed };
}

// Which imports does the lock OWN, and may therefore delete?
//
// It used to be "the specifier names the package it points at", which was
// true while every key was a deck name. Aliases broke that: `"hljs":
// "/site/lib/highlight-js@11.9.0/es/index.js"` is a pin the lock wrote, and
// under the old rule the lock could not recognise its own work — so dropping
// the dependency left the pin behind, still resolving, until the day the
// deck it names is pruned. L11 caught exactly this on a real depot.
//
// The rule now: a pin is anything pointing INTO this depot's deck space.
// Given the depot name it is exact; without one it falls back to the old
// name-matching test, which is conservative and never deletes a stranger.
function isPin(
  _specifier: string,
  target: string,
  _depotName?: string,
): boolean {
  try {
    parseRRI(target);
    return true;
  } catch {
    return false;
  }
}

async function dependenciesFromDir(
  deckDir: string,
): Promise<Record<string, string>> {
  try {
    let pkg = parsePackageJson(
      await readFile(join(deckDir, PACKAGE_JSON_PATH), 'utf8'),
    );
    return pkg ? suggestedDependencies(pkg) : {};
  } catch {
    return {};
  }
}

const LINEAGE_KEYS = [
  'forkedFrom',
  'vendoredFrom',
  'derivedFrom',
  'derivation',
  'sourceOnly',
  'recoveredFrom',
  'baseApi',
] as const;

/**
 * A per-pack import map may carry lineage. Pins, identity, and ranges do
 * not belong here — those live on the depot lock and package.json.
 * Empty string means the file should be deleted.
 */
export function lineageOnlyImportMap(mapText: string): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(mapText) as Record<string, unknown>;
  } catch {
    return '';
  }
  if (!parsed || typeof parsed !== 'object') return '';
  let vendorKey = 'deck' in parsed ? 'deck' : 'boxel' in parsed ? 'boxel' : '';
  if (!vendorKey) return '';
  let vendor = parsed[vendorKey] as
    { packages?: Record<string, Record<string, unknown>> } | undefined;
  let packages = vendor?.packages;
  if (!packages || typeof packages !== 'object') return '';
  let kept: Record<string, Record<string, unknown>> = {};
  for (let [name, entry] of Object.entries(packages)) {
    if (!entry || typeof entry !== 'object') continue;
    let slim: Record<string, unknown> = {};
    for (let key of LINEAGE_KEYS) {
      if (entry[key] !== undefined) slim[key] = entry[key];
    }
    if (Object.keys(slim).length > 0) kept[name] = slim;
  }
  if (Object.keys(kept).length === 0) return '';
  return JSON.stringify({ [vendorKey]: { packages: kept } }, null, 2) + '\n';
}

export async function lockDeck(options: {
  depotDir: string;
  depotName: string;
  storeDir: string;
  deckDir: string;
}): Promise<{
  resolutions: DependencyResolution[];
  text: string;
  changed: boolean;
}> {
  let mapPath = join(options.deckDir, IMPORT_MAP_PATH);
  let existing = await readFile(mapPath, 'utf8').catch(() => '');
  let text = existing ? lineageOnlyImportMap(existing) : '';
  let changed = text !== existing && `${text}` !== `${existing}\n`;
  if (!existing && !text) changed = false;
  let dependencies = await dependenciesFromDir(options.deckDir);
  let currentImports = (
    existing
      ? ((JSON.parse(existing).imports ?? {}) as Record<string, string>)
      : {}
  ) as Record<string, string>;
  let locate = await inventoryLocations({
    depotDir: options.depotDir,
    storeDir: options.storeDir,
  });
  let resolutions = await resolveDependencies({
    depotDir: options.depotDir,
    depotName: options.depotName,
    storeDir: options.storeDir,
    dependencies,
    currentImports,
    locate,
  });
  return { resolutions, text, changed };
}

export interface DepotLockOptions {
  depotDir: string;
  depotName: string;
  storeDir: string;
  // Refresh every pin to the newest version still in range.
  update?: boolean;
  // Opt-in continuous refresh; written into the lock's `deck.continuous`.
  continuous?: boolean;
  // Specifier → exact version or range the owner wants, beating suggestion.
  overrides?: Record<string, string>;
}

export interface DepotLockResult {
  resolutions: DependencyResolution[];
  scoped: ScopedResolution[];
  text: string;
  changed: boolean;
  integrity: Record<string, string>;
}

function sriSha256(bytes: Buffer): string {
  return `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
}

function pinVersion(target: string): string | undefined {
  try {
    return parseRRI(target).version;
  } catch {
    return undefined;
  }
}

function stillSatisfies(target: string | undefined, spec: string): boolean {
  if (!target || spec === LIVE_SPEC) {
    return false;
  }
  let version = pinVersion(target.endsWith('/') ? target : `${target}/`);
  if (!version) {
    return false;
  }
  if (isValidDistTag(spec)) {
    return version === spec;
  }
  if (semver.valid(spec) === spec) {
    return version === spec;
  }
  if (semver.validRange(spec)) {
    return semver.satisfies(version, spec, { includePrerelease: false });
  }
  return false;
}

async function integrityFor(
  storeDir: string,
  _depotName: string,
  imports: Record<string, string>,
): Promise<Record<string, string>> {
  let integrity: Record<string, string> = {};
  for (let [specifier, target] of Object.entries(imports)) {
    if (specifier.endsWith('/')) {
      continue;
    }
    if (
      target.endsWith('/package.json') ||
      specifier.endsWith('package.json')
    ) {
      continue;
    }
    let parsed;
    try {
      parsed = parseRRI(target);
    } catch {
      continue;
    }
    // Sealed pins only. Mutable RRIs go stale on every save
    // and do not belong in the lock — the server rehashes those at serve time.
    if (!parsed.version) {
      continue;
    }
    let bytes = await readStoredFile(
      storeDir,
      `${parsed.scope}/${parsed.name}`,
      parsed.version,
      parsed.path,
    );
    if (!bytes) {
      let packageName = `${parsed.scope}/${parsed.name}`;
      let meta = await readStoreMeta(storeDir, packageName);
      let exact = meta?.tags[parsed.version];
      if (exact) {
        bytes = await readStoredFile(storeDir, packageName, exact, parsed.path);
      }
    }
    if (bytes) {
      integrity[target] = sriSha256(bytes);
    }
  }
  return integrity;
}

/** Drop scope rows that copy `imports` — the browser already falls back. */
function dropEchoedScopes(
  imports: Record<string, string>,
  scoped: readonly ScopedResolution[],
): ScopedResolution[] {
  let out: ScopedResolution[] = [];
  for (let { scope, imports: table } of scoped) {
    let needed: Record<string, string> = {};
    for (let [spec, url] of Object.entries(table)) {
      if (imports[spec] !== url) needed[spec] = url;
    }
    if (Object.keys(needed).length > 0) {
      out.push({ scope, imports: needed });
    }
  }
  return out;
}

export async function lockDepot(
  options: DepotLockOptions,
): Promise<DepotLockResult> {
  let lockPath = join(options.depotDir, DEPOT_LOCK_PATH);
  let existingText = await readFile(lockPath, 'utf8').catch(() => '');
  let existing: {
    imports?: Record<string, string>;
    scopes?: Record<string, Record<string, string>>;
    integrity?: Record<string, string>;
    deck?: { continuous?: boolean; overrides?: Record<string, string> };
  } = {};
  if (existingText) {
    try {
      existing = JSON.parse(existingText);
    } catch {
      existing = {};
    }
  }
  let overrides = {
    ...(existing.deck?.overrides ?? {}),
    ...(options.overrides ?? {}),
  };
  let locate = await inventoryLocations({
    depotDir: options.depotDir,
    storeDir: options.storeDir,
  });
  let decks = await discoverDecks(options.depotDir);
  let allResolutions: DependencyResolution[] = [];
  let importerScopes: ScopedResolution[] = [];

  for (let deck of decks) {
    let dependencies = await dependenciesFromDir(deck.dir);
    for (let [key, value] of Object.entries(overrides)) {
      if (key in dependencies || Object.keys(dependencies).length === 0) {
        dependencies[key] = value;
      }
    }
    if (Object.keys(dependencies).length === 0) {
      continue;
    }
    if (!options.update && existing.imports) {
      for (let [key, spec] of Object.entries(dependencies)) {
        let { spec: range, target } = parseDependencyValue(spec);
        let current = existing.imports[key];
        let version = current
          ? pinVersion(current.endsWith('/') ? current : `${current}/`)
          : undefined;
        if (version && stillSatisfies(current, range)) {
          dependencies[key] = target ? `${target}@${version}` : version;
        }
      }
    }
    let resolutions = await resolveDependencies({
      depotDir: options.depotDir,
      depotName: options.depotName,
      storeDir: options.storeDir,
      dependencies,
      currentImports: existing.imports,
      locate,
    });
    allResolutions.push(...resolutions);
    let liveScope = `@${deck.name}/`;
    let liveImports: Record<string, string> = {};
    for (let resolution of resolutions) {
      Object.assign(liveImports, resolution.imports);
    }
    if (Object.keys(liveImports).length > 0) {
      importerScopes.push({ scope: liveScope, imports: liveImports });
    }
  }

  let sealedScopes = await resolveScopes({
    depotName: options.depotName,
    storeDir: options.storeDir,
    roots: allResolutions,
    locate,
    depotDir: options.depotDir,
  });
  let scoped = [...importerScopes, ...sealedScopes].sort((a, b) =>
    a.scope.localeCompare(b.scope),
  );

  let imports: Record<string, string> = {};
  for (let resolution of allResolutions) {
    Object.assign(imports, resolution.imports);
  }
  scoped = dropEchoedScopes(imports, scoped);
  let integrity = await integrityFor(options.storeDir, options.depotName, {
    ...imports,
    ...Object.assign({}, ...scoped.map((entry) => entry.imports)),
  });

  let continuous = options.continuous ?? existing.deck?.continuous ?? false;
  let parsed: Record<string, unknown> = {
    imports: Object.fromEntries(
      Object.entries(imports).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  if (scoped.length > 0) {
    parsed.scopes = Object.fromEntries(
      scoped.map((entry) => [
        entry.scope,
        Object.fromEntries(
          Object.entries(entry.imports).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ]),
    );
  }
  if (Object.keys(integrity).length > 0) {
    parsed.integrity = Object.fromEntries(
      Object.entries(integrity).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  let deckMeta: Record<string, unknown> = {};
  if (continuous) {
    deckMeta.continuous = true;
  }
  if (Object.keys(overrides).length > 0) {
    deckMeta.overrides = overrides;
  }
  if (Object.keys(deckMeta).length > 0) {
    parsed.deck = deckMeta;
  }
  let text = JSON.stringify(parsed, null, 2) + '\n';
  let changed =
    text !==
      (existingText.endsWith('\n') ? existingText : existingText + '\n') &&
    text !== existingText;
  return {
    resolutions: allResolutions,
    scoped,
    text,
    changed,
    integrity,
  };
}

export function parseDepotLock(jsonText: string): {
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
  integrity: Record<string, string>;
  continuous: boolean;
  overrides: Record<string, string>;
} {
  let parsed = JSON.parse(jsonText);
  let canonical = canonicalRRIImportMap(parsed);
  return {
    imports: canonical.imports,
    scopes: canonical.scopes,
    integrity: canonical.integrity ?? {},
    continuous: parsed.deck?.continuous === true,
    overrides: (parsed.deck?.overrides ?? {}) as Record<string, string>,
  };
}

function isUnfrozenSpec(spec: string): boolean {
  return spec === LIVE_SPEC || isValidDistTag(spec);
}

function mergeScopeTables(
  into: Record<string, Record<string, string>>,
  prefix: string,
  table: Record<string, string>,
): void {
  into[prefix] = { ...(into[prefix] ?? {}), ...table };
}

// A deck in a tree listing: `publisher/package/package.json` at depth two.
// The depot-root lock is never a deck.
export function decksFromTreePaths(
  paths: readonly string[],
): Array<{ publisher: string; package: string; name: string }> {
  let decks: Array<{ publisher: string; package: string; name: string }> = [];
  let seen = new Set<string>();
  for (let path of paths) {
    let parts = path.split('/');
    if (parts.length !== 3 || parts[2] !== PACKAGE_JSON_PATH) {
      continue;
    }
    let [publisher, pkg] = parts;
    if (!SEGMENT.test(publisher) || !SEGMENT.test(pkg)) {
      continue;
    }
    let name = `${publisher}/${pkg}`;
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    decks.push({ publisher, package: pkg, name });
  }
  return decks.sort((a, b) => (a.name < b.name ? -1 : 1));
}

async function dependenciesFromTreeFile(
  readTreeFile: TreeFileReader,
  deckName: string,
): Promise<Record<string, string>> {
  let text = await readTreeText(
    readTreeFile,
    `${deckName}/${PACKAGE_JSON_PATH}`,
  );
  if (text === undefined) {
    return {};
  }
  let pkg = parsePackageJson(text);
  return pkg ? suggestedDependencies(pkg) : {};
}

async function locateFromTree(options: {
  decks: readonly { publisher: string; package: string; name: string }[];
  storeDir: string;
  readTreeFile: TreeFileReader;
}): Promise<Map<string, PackageLocation>> {
  let index = new Map<string, PackageLocation>();
  for (let deck of options.decks) {
    let location: PackageLocation = {
      publisher: deck.publisher,
      package: deck.package,
    };
    remember(index, deck.name, location);
    remember(index, deck.package, location);
    let text = await readTreeText(
      options.readTreeFile,
      `${deck.name}/${PACKAGE_JSON_PATH}`,
    );
    if (text) {
      let pkg = parsePackageJson(text);
      if (pkg?.name) {
        location.npmName = pkg.name;
        remember(index, pkg.name, location);
        remember(index, pkg.name.replace(/^@[^/]+\//, ''), location);
      }
    }
  }
  // Store packages fill npm names the tree does not hold as live decks.
  await rememberStorePackages(index, options.storeDir);
  return index;
}

// Rewrite versionless (live) import-map targets into a History Step URL.
// Dist-tags and exact Versions keep their `@` segment and are not rewritten
// — they already name store identity. A Step page that said workspace:*
// must bind the sibling *at that Step*, not today's working tree.
export function rewriteLiveTargetsIntoStep(
  depotName: string,
  revision: string,
  target: string,
): string {
  let prefix = `/${depotName}/`;
  let historyPrefix = `/${depotName}/_history/`;
  if (!target.startsWith(prefix) || target.startsWith(historyPrefix)) {
    return target;
  }
  let rest = target.slice(prefix.length);
  // `/depot/pub/pkg@1.2.0/…` and `/depot/pub/pkg@latest/…` keep their pin.
  if (/^[^/]+\/[^/]+@/.test(rest)) {
    return target;
  }
  return `${historyPrefix}${revision}/${rest}`;
}

export function rewriteImportMapIntoStep(
  depotName: string,
  revision: string,
  imports: Record<string, string>,
  scopes: Record<string, Record<string, string>> = {},
  integrity: Record<string, string> = {},
): {
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
  integrity: Record<string, string>;
} {
  let rewrite = (target: string) =>
    rewriteLiveTargetsIntoStep(depotName, revision, target);
  let atStep = (table: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(table).map(([key, value]) => [key, rewrite(value)]),
    );
  return {
    imports: atStep(imports),
    scopes: Object.fromEntries(
      Object.entries(scopes).map(([scope, table]) => [
        rewrite(scope),
        atStep(table),
      ]),
    ),
    integrity: Object.fromEntries(
      Object.entries(integrity).map(([url, hash]) => [rewrite(url), hash]),
    ),
  };
}

// Unfrozen edges from any tree — live depot or History Step — given its
// decks and a file reader. workspace:* and dist-tags skip the freeze;
// ranges do not appear here.
export async function unfrozenBindingsFromTree(options: {
  depotName: string;
  storeDir: string;
  // Used only as a fallback for live entry reads when readTreeFile misses.
  depotDir?: string;
  decks: readonly { publisher: string; package: string; name: string }[];
  readTreeFile: TreeFileReader;
  locate?: Map<string, PackageLocation>;
}): Promise<{
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
}> {
  let locate =
    options.locate ??
    (await locateFromTree({
      decks: options.decks,
      storeDir: options.storeDir,
      readTreeFile: options.readTreeFile,
    }));
  let imports: Record<string, string> = {};
  let scopes: Record<string, Record<string, string>> = {};
  for (let deck of options.decks) {
    let dependencies = await dependenciesFromTreeFile(
      options.readTreeFile,
      deck.name,
    );
    let scopeImports: Record<string, string> = {};
    for (let [key, declared] of Object.entries(dependencies)) {
      let { spec } = parseDependencyValue(declared);
      if (!isUnfrozenSpec(spec)) {
        continue;
      }
      try {
        let resolutions = await resolveDependencies({
          depotDir: options.depotDir ?? '',
          depotName: options.depotName,
          storeDir: options.storeDir,
          dependencies: { [key]: declared },
          locate,
          readTreeFile: options.readTreeFile,
        });
        for (let resolution of resolutions) {
          Object.assign(imports, resolution.imports);
          Object.assign(scopeImports, resolution.imports);
        }
      } catch {
        // Unpublished tag or unknown name: the page still serves; that
        // import fails at runtime rather than taking the document down.
      }
    }
    if (Object.keys(scopeImports).length > 0) {
      mergeScopeTables(scopes, `@${deck.name}/`, scopeImports);
    }
  }
  return { imports, scopes };
}

// Phase 3: the edges that skip the freeze on the LIVE tree. Live pages
// inject these from package.json even when the depot lock has no pin —
// workspace:* and dist-tags (`latest`, `dev`) — so trying a sibling or
// chasing a tag does not require `deck lock`. Ranges stay locked.
export async function unfrozenBindingsFromDepot(options: {
  depotDir: string;
  depotName: string;
  storeDir: string;
}): Promise<{
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
}> {
  let decks = (await discoverDecks(options.depotDir)).map((deck) => ({
    publisher: deck.publisher,
    package: deck.package,
    name: deck.name,
  }));
  return unfrozenBindingsFromTree({
    depotDir: options.depotDir,
    depotName: options.depotName,
    storeDir: options.storeDir,
    decks,
    readTreeFile: async (path) => {
      try {
        return await readFile(join(options.depotDir, path));
      } catch {
        return undefined;
      }
    },
  });
}

// Cheap gap check before the expensive unfrozen resolve. Reading every
// package.json for workspace:*/dist-tag keys is milliseconds; opening the
// store to resolve them is hundreds. When `deck lock` has already compiled
// those edges into the depot import map, serve should skip the walk.
export async function unfrozenKeysMissingFromLock(options: {
  depotDir: string;
  lockImports: Record<string, string>;
}): Promise<string[]> {
  let missing: string[] = [];
  let seen = new Set<string>();
  for (let deck of await discoverDecks(options.depotDir)) {
    let dependencies = await dependenciesFromDir(deck.dir);
    for (let [key, declared] of Object.entries(dependencies)) {
      let { spec } = parseDependencyValue(declared);
      if (!isUnfrozenSpec(spec) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      if (
        !(key in options.lockImports) &&
        !(`${key}/` in options.lockImports)
      ) {
        missing.push(key);
      }
    }
  }
  return missing.sort();
}
