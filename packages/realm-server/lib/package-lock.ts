// Resolving a package's declared dependency RANGES into the exact pins that
// travel inside its sealed Version.
//
// THE RULING THIS IMPLEMENTS. `deck-a-package-resolves-through-its-own-map.md`
// §0: a module inside a published Version resolves its imports through that
// Version's own sealed map, and the depot's map resolves only what is not
// packaged. §4 names why cross-package dependencies do not work yet, in two
// halves — "a pack carries no lock … and even if it did, nothing would consult
// it". This is the first half.
//
// RANGES IN, PINS OUT, BOTH KEPT. The author writes intent:
//
//     "deck": { "dependencies": { "experiments/greeter": "^2.0.0" } }
//
// and the seal carries what that intent resolved to on the day it was sealed:
//
//     "imports": {
//       "experiments/greeter":  "/demo/_packages/experiments/greeter@2.2.0/index.js",
//       "experiments/greeter/": "/demo/_packages/experiments/greeter@2.2.0/"
//     }
//
// The range is kept beside the pin rather than consumed by it, and that is
// load-bearing in two places. A reader can see what the author would have
// accepted, not only what they got. And `deck-who-may-intervene.md` §6 lets an
// operator advance a sealed pin *within the range the package itself declared*
// — permission granted in writing at publish time — which is unavailable if
// the only thing sealed is the answer.
//
// WHY THE PINS ARE ORIGIN-RELATIVE. `/demo/_packages/…`, not an absolute URL.
// What a seal owes its consumer is the VERSION; the host is not the package's
// business. A pack pinned to `https://realm-a.example/demo/_packages/…` is
// welded to one server forever and cannot be mirrored, which is precisely what
// a content-addressed store exists to allow. Origin-relative says "the package
// space of whichever server is serving me", which is true on every server that
// holds the Version and false on none of them.
//
// AND WHY THEY CARRY THE REALM. The path is `<realm>/_packages/…` because the
// REALM is what governs the name. A realm server does not arbitrate a global
// publisher namespace — `cardstack/contracts` is only meaningful once you know
// whose it is — so the qualifier has to be in the address. See
// `lib/package-store.ts` for the full argument.
//
// The consequence, stated here rather than discovered later: a pack's
// dependencies resolve within its OWN realm's store, because that store is the
// only one this resolution reads. Depending on a package a DIFFERENT realm
// published is not supported and would need the dependency key to name that
// realm. That is a deliberate gap rather than an oversight: a cross-realm range
// also needs an answer to who may publish into whose namespace, and that
// question is open.
//
// This is the opposite call from `lib/publish-import-map.ts`, which rewrites
// origin-relative values in a REALM's map to absolute. The difference is real:
// a published realm moves to a host that has no package store, so its pins
// must point back at one that does. A pack never leaves the package space — it
// IS the package space — so the relative form stays correct wherever it lands.

import { IMPORT_MAP_PATH, parsePackages } from '@cardstack/deck/import-map';
import { readStoreMeta, readStoredFile } from '@cardstack/deck/node';
import { treePathFromMapValue } from '@cardstack/deck/import-map';
import { resolveVersionSpec } from '@cardstack/deck/node';

/** The one live spelling: "do not pin me, follow the working tree". */
export const LIVE_SPEC = 'live';

export type LockRefusal =
  | 'unknown-dependency'
  | 'unsatisfiable-dependency'
  | 'malformed-dependency';

export interface DependencyPin {
  /** The declared key, which is both the store name and the specifier. */
  key: string;
  /** What the author wrote. */
  spec: string;
  /** What it resolved to. Absent for `live`. */
  version?: string;
}

export type LockResult =
  | {
      kind: 'locked';
      pins: DependencyPin[];
      /** The `imports` block to seal into the pack. */
      imports: Record<string, string>;
    }
  | { kind: 'refused'; code: LockRefusal; detail: string };

/**
 * Where a Version's files are addressed on this server.
 *
 * One function rather than a template literal at each call site, because the
 * prefix is a routing fact — `handlers/handle-package-serve.ts` owns it — and
 * a second spelling of it is a second thing to keep in step.
 *
 * `realmPath` is the governing realm's path with its slashes, `/atlas/`. It is
 * a required argument rather than a defaulted one on purpose: the whole point
 * of the move is that a package address WITHOUT a realm names nobody's
 * namespace, and a default would quietly mint exactly those again.
 */
export function packageBaseURL(
  realmPath: string,
  name: string,
  version: string,
): string {
  let prefix = `/${realmPath.replace(/^\/+|\/+$/g, '')}`;
  return `${prefix}/_packages/${name}@${version}/`;
}

/**
 * Resolve a package's declared dependencies against a store.
 *
 * FAILS CLOSED. A range nothing satisfies refuses the publish rather than
 * sealing a partial map. The alternative is a Version whose manifest looks
 * complete and whose consumer discovers the hole at import time, on a
 * different machine, weeks later — and a seal that certifies bytes it cannot
 * make run is worth less than no seal at all.
 *
 * `live` is the deliberate exception and is NOT pinned: it means "follow the
 * working tree", which is the author asking for volatility on purpose. It
 * contributes no `imports` entry, so the depot's map answers — the escape
 * hatch the ruling documents in §3, taken knowingly.
 */
export async function lockDependencies(options: {
  storeDir: string;
  /** The governing realm's path, e.g. `/atlas/`. Every pin is written beneath
   *  it, and `storeDir` is that same realm's store — the two must name one
   *  realm or a pin points somewhere its bytes are not. */
  realmPath: string;
  dependencies: Record<string, string> | undefined;
}): Promise<LockResult> {
  let { storeDir, realmPath, dependencies } = options;
  let pins: DependencyPin[] = [];
  let imports: Record<string, string> = {};

  // REFUSED, not defaulted. Without a realm the base below would be
  // `/_packages/…`, the rootless address this design removed precisely
  // because it names nobody's namespace. A caller that forgot to pass the
  // realm should fail at publish, loudly, rather than seal a pin that
  // resolves to nothing on every server that reads it.
  //
  // Gated on what will actually be PINNED, not on the declaration count. A
  // package whose dependencies are all `live` mints no addresses at all, so it
  // needs no realm — refusing it would break the escape hatch over a
  // requirement that does not apply to it.
  let willPin = Object.values(dependencies ?? {}).some(
    (spec) => typeof spec === 'string' && spec !== LIVE_SPEC,
  );
  if (willPin && !realmPath.trim()) {
    return {
      kind: 'refused',
      code: 'malformed-dependency',
      detail:
        'cannot pin dependencies without the publishing realm: a package ' +
        'address is only meaningful under the realm that governs its name',
    };
  }

  for (let [key, spec] of Object.entries(dependencies ?? {})) {
    if (typeof spec !== 'string' || spec.length === 0) {
      return {
        kind: 'refused',
        code: 'malformed-dependency',
        detail: `dependency "${key}" has no version range`,
      };
    }
    if (spec === LIVE_SPEC) {
      pins.push({ key, spec });
      continue;
    }

    let meta = await readStoreMeta(storeDir, key);
    if (!meta || Object.keys(meta.versions).length === 0) {
      return {
        kind: 'refused',
        code: 'unknown-dependency',
        detail: `dependency "${key}" has no published versions on this server`,
      };
    }
    // The SAME resolver the serve door uses, deliberately. "What does ^2.0.0
    // mean here" must have one answer, or a pin disagrees with the redirect a
    // consumer would have followed by hand.
    let resolution = resolveVersionSpec(spec, meta);
    if (resolution.kind === 'invalid' || resolution.kind === 'not-found') {
      return {
        kind: 'refused',
        code:
          resolution.kind === 'invalid'
            ? 'malformed-dependency'
            : 'unsatisfiable-dependency',
        detail: `dependency "${key}": ${resolution.detail}`,
      };
    }
    let version = resolution.version;
    let base = packageBaseURL(realmPath, key, version);
    let { entry, exports } = await entryAndExportsOf(storeDir, key, version);

    // The prefix mapping carries every path in the Version; the bare
    // specifier carries a bare import of the package.
    imports[`${key}/`] = base;
    if (entry) {
      imports[key] = `${base}${entry}`;
    }
    // Export aliases are written out one by one rather than left to the
    // prefix mapping, because a subpath a consumer writes need not be the
    // path the package publishes: `crm/account` is really `account.js`, and
    // the prefix rule alone would send it to `account`.
    for (let [alias, target] of Object.entries(exports)) {
      imports[`${key}/${alias.replace(/^\.\//, '')}`] = `${base}${target}`;
    }
    pins.push({ key, spec, version });
  }

  return { kind: 'locked', pins, imports };
}

async function entryAndExportsOf(
  storeDir: string,
  name: string,
  version: string,
): Promise<{ entry?: string; exports: Record<string, string> }> {
  let bytes = await readStoredFile(storeDir, name, version, IMPORT_MAP_PATH);
  if (!bytes) {
    return { exports: {} };
  }
  // The SEALED manifest, never the realm's live one. What `greeter@2.2.0`
  // exports was decided when it was sealed, and the realm may have moved on.
  let entry = parsePackages(bytes.toString('utf8'))?.[name.split('/').at(-1)!];
  let exports: Record<string, string> = {};
  for (let [alias, value] of Object.entries(entry?.exports ?? {})) {
    let path = treePathFromMapValue(value);
    if (path) {
      exports[alias] = path;
    }
  }
  return {
    entry: entry?.entry ? treePathFromMapValue(entry.entry) : undefined,
    exports,
  };
}
