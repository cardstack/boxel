import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import semver from 'semver';
import {
  parseDependencies,
  parsePackages,
  treePathFromMapValue,
  IMPORT_MAP_PATH,
} from './import-map.ts';
import { packagesFromPack } from './import-map-pack.ts';
import { readStoreMeta, readStoredPack } from './store.ts';
import { readZipEntry } from './canonical-zip.ts';

// The decklist lock.
//
// A deck declares what it depends on as RANGES — `"acme/confetti": "^1.0.0"` —
// because that is what the author means. What its users get must not be a
// range: a consumer of a published deck should never be exposed to the
// volatility of somebody else's working tree. So publishing resolves every
// range to one exact version and writes those pins into the deck's own
// import map, where the browser reads them.
//
// The pins go INTO THE TREE, as an ordinary edit. That keeps three things
// true at once: packs stay faithful (nothing is rewritten at pack time or
// serve time), the lock is visible in `cat importmap.json`, and moving a
// dependency forward is just another save — which auto-publishes, seals,
// and can be reverted like any other.
//
// Three levels of volatility, all expressible, all just URLs:
//
//   "live"      → /<depot>/<pub>/<pkg>/…        every save, instantly (YOLO)
//   "dev"       → /<depot>/<pub>/<pkg>@0.2.0-dev.7/…  the freshest seal
//   "^1.0.0"    → /<depot>/<pub>/<pkg>@1.2.0/…  dependable; moves when you say
//
// Prereleases are excluded from range matching (the npm rule), so a `^1.0.0`
// dependency never silently picks up somebody's auto-published dev line.

export const LIVE_SPEC = 'live';

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

export interface ResolveOptions {
  depotDir: string;
  depotName: string;
  storeDir: string;
  dependencies: Record<string, string>;
  // The map being locked, so the report can say what moved.
  currentImports?: Record<string, string>;
}

function parseKey(
  key: string,
  defaultDepot: string,
): { depot: string; publisher: string; package: string } | undefined {
  let segments = key.split('/');
  if (segments.length === 2) {
    return { depot: defaultDepot, publisher: segments[0], package: segments[1] };
  }
  if (segments.length === 3) {
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
  if (!value.includes('/')) {
    return { spec: value };
  }
  let at = value.lastIndexOf('@');
  // A bare `you/three` means live, the same default a fork wants.
  if (at <= 0) {
    return { target: value, spec: LIVE_SPEC };
  }
  return { target: value.slice(0, at), spec: value.slice(at + 1) || LIVE_SPEC };
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

async function entryOf(
  options: ResolveOptions,
  target: { depot: string; publisher: string; package: string },
  version: string | undefined,
): Promise<string | undefined> {
  if (version === undefined) {
    // Live: the entry is whatever the working tree declares right now.
    try {
      let text = await readFile(
        join(
          options.depotDir,
          target.publisher,
          target.package,
          IMPORT_MAP_PATH,
        ),
        'utf8',
      );
      let value = parsePackages(text)?.[target.package]?.entry;
      return value ? treePathFromMapValue(value) : undefined;
    } catch {
      return undefined;
    }
  }
  let bytes = await readStoredPack(
    options.storeDir,
    `${target.publisher}/${target.package}`,
    version,
  );
  if (!bytes) {
    return undefined;
  }
  let value = packagesFromPack(bytes)?.[target.package]?.entry;
  return value ? treePathFromMapValue(value) : undefined;
}

export async function resolveDependencies(
  options: ResolveOptions,
): Promise<DependencyResolution[]> {
  let resolutions: DependencyResolution[] = [];
  for (let [key, declared] of Object.entries(options.dependencies)) {
    let { target: alias, spec } = parseDependencyValue(declared);
    // The KEY is always the import specifier. Without an alias it must also
    // BE the deck name, because nothing else says which deck to resolve.
    // With one, the key is free — which is what lets a vendored package's
    // bare npm specifier (`three`, `tslib`) point at a deck.
    if (alias === undefined && parseKey(key, options.depotName) === undefined) {
      throw new Error(
        `dependency "${key}" is not <publisher>/<package> or <depot>/<publisher>/<package>`,
      );
    }
    let target = parseKey(alias ?? key, options.depotName);
    if (!target) {
      throw new Error(
        `dependency "${key}" aliases "${alias}", which is not <publisher>/<package> or <depot>/<publisher>/<package>`,
      );
    }
    if (target.depot !== options.depotName) {
      // Cross-depot dependencies need that depot's store, which this depot
      // does not have. Refusing beats writing a pin nobody can serve.
      throw new Error(
        `dependency "${key}" is in depot ${target.depot}; only ${options.depotName} can be locked from here`,
      );
    }
    let base = `/${target.depot}/${target.publisher}/${target.package}`;
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
    let versioned = version === undefined ? base : `${base}@${version}`;
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
      ...(alias ? { alias } : {}),
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
  // The URL prefix the scope applies to: "/site/lib/tone@14.7.77/".
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
  let raw = readZipEntry(bytes, IMPORT_MAP_PATH);
  return raw ? (parseDependencies(raw.toString('utf8')) ?? {}) : {};
}

// Walk what the resolved decks themselves depend on, breadth-first, and emit
// one scope per deck. Cycles terminate on the visited set.
export async function resolveScopes(options: {
  depotName: string;
  storeDir: string;
  roots: readonly DependencyResolution[];
  maxDepth?: number;
}): Promise<ScopedResolution[]> {
  let { depotName, storeDir, roots, maxDepth = 8 } = options;
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
    let dependencies = await sealedDependencies(storeDir, job.deck, job.version);
    let scope = `/${depotName}/${job.deck}@${job.version}/`;
    for (let [specifier, declared] of Object.entries(dependencies)) {
      let { target, spec } = parseDependencyValue(declared);
      // Without an alias the KEY is the deck name — the same default
      // `resolveDependencies` applies one function up. Treating an
      // un-aliased dependency as "nothing to scope" was wrong, and quietly
      // so: a deck that depends on another deck by its own name
      // (`"std/tokens": "^1.0.0"`, the ordinary spelling) got no scope at
      // all, so its bare specifiers went unresolved in the browser on every
      // page that imported it indirectly. Only the aliased shape — a
      // vendored library — happened to work, which is why the demos that
      // vendor found nothing wrong.
      let child = parseKey(target ?? specifier, depotName);
      if (!child) {
        continue;
      }
      let childDeck = `${child.publisher}/${child.package}`;
      let version = semver.valid(spec) === spec ? spec : undefined;
      if (!version) {
        let meta = await readStoreMeta(storeDir, childDeck);
        version = meta ? resolveSpec(spec, meta) : undefined;
      }
      if (!version) {
        continue;
      }
      let base = `/${child.depot}/${childDeck}@${version}`;
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
      // A subpath a consumer writes may not be the path the package
      // publishes — dayjs's `plugin/quarterOfYear.js` is really
      // `esm/plugin/quarterOfYear/index.js` — so the deck's exports become
      // explicit scope entries rather than relying on the prefix mapping.
      for (let [alias, target] of Object.entries(exports)) {
        record[`${specifier}/${alias.replace(/^\.\//, '')}`] =
          `${base}/${target}`;
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
  let mapEntry = packagesFromPack(bytes)?.[deck.split('/').at(-1)!];
  let exports: Record<string, string> = {};
  for (let [alias, value] of Object.entries(mapEntry?.exports ?? {})) {
    let treePath = treePathFromMapValue(value);
    if (treePath) {
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
  specifier: string,
  target: string,
  depotName?: string,
): boolean {
  if (depotName) {
    return new RegExp(
      `^/${depotName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*(@[^/]+)?/`,
    ).test(target);
  }
  let name = specifier.replace(/\/$/, '');
  if (name.split('/').length !== 2) {
    return false;
  }
  return new RegExp(
    `^/[a-z0-9][a-z0-9-]*/${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(@[^/]+)?/`,
  ).test(target);
}

export async function lockDeck(options: {
  depotDir: string;
  depotName: string;
  storeDir: string;
  deckDir: string;
}): Promise<{ resolutions: DependencyResolution[]; text: string; changed: boolean }> {
  let mapPath = join(options.deckDir, IMPORT_MAP_PATH);
  let mapText = await readFile(mapPath, 'utf8');
  let dependencies = parseDependencies(mapText) ?? {};
  let currentImports = (JSON.parse(mapText).imports ?? {}) as Record<
    string,
    string
  >;
  let resolutions = await resolveDependencies({
    depotDir: options.depotDir,
    depotName: options.depotName,
    storeDir: options.storeDir,
    dependencies,
    currentImports,
  });
  let scoped = await resolveScopes({
    depotName: options.depotName,
    storeDir: options.storeDir,
    roots: resolutions,
  });
  let { text, changed } = applyLock(
    mapText,
    resolutions,
    scoped,
    options.depotName,
  );
  return { resolutions, text, changed };
}
