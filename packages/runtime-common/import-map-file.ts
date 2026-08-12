// A realm's import map: `importmap.json`, at the realm root or — preferably —
// one per app under `apps/`.
//
// WHERE THE PINS LIVE, AND WHY IT MOVED. A single map at the realm root has to
// carry every app's pins at once, with per-app differences expressed as
// `scopes` keyed by directory. That works, and it puts one file in the way of
// the thing app surfaces exist to guarantee: a realm can host COMPETING apps,
// and each must be able to move its own versions without touching a file its
// neighbour also depends on. A shared root map is exactly the coupling that
// design removes one layer up, reintroduced one layer down.
//
// So an app owns its pins. `apps/<name>/importmap.json` governs the modules
// beneath it, and `composeRealmDecklist` folds each app in as a scope over its
// own directory — which is what the root map's `scopes` said by hand, now said
// by where the file sits. A realm whose modules all live in apps needs no root
// map at all.
//
// The root map is still read, and still first: realms that predate this hold
// real pins there, and a realm with no `apps/` directory is not doing anything
// wrong. An app map wins for its own subtree, because it is the more specific
// statement and the one sitting next to the code it governs.
//
// NOT A CARD, and that is the point rather than an implementation detail.
// `deck-multi-package-design.md` §2 states it plainly — "One plain JSON file
// at the realm root. It is not a card." — and §3 gives the reason: module
// resolution must not depend on the index or on card compute. A card would
// make it depend on both. The authoring surface is the RealmConfig card,
// which WRITES this file; the card is a convenience, never a dependency, so
// an agent that writes `importmap.json` directly satisfies the protocol and a
// broken card def cannot stop a realm from resolving its modules.
//
// The format is the web import-map standard — `imports` and `scopes`, a
// browser could load it — plus one vendor key for everything Deck adds, so
// future spec members can never collide with ours. Deck writes `deck`; a map
// authored in a Boxel realm may write `boxel`. Both are read.
//
// Every algorithm here is imported from `@cardstack/deck`, not reimplemented.
// That is the backport's standing rule: the flattening order, the depth
// limit, what `null` means and which parents are legal are protocol
// decisions, and a second copy of them is a second thing to get wrong.

import { IMPORT_MAP_PATH } from '@cardstack/deck/import-map';
import {
  flattenInheritance,
  isExactParent,
  parseLink,
  resolveInheritance,
  type DecklistLink,
  type MapValue,
} from '@cardstack/deck/inherit';

import { ensureTrailingSlash } from './paths.ts';

import type { DecklistInput } from './virtual-network.ts';

export { IMPORT_MAP_PATH };

export type { DecklistLink };

/**
 * Where a realm keeps its apps.
 *
 * A CONVENTION rather than a declaration, deliberately. The alternative was a
 * root map listing the app directories — but then adding an app means editing
 * a shared file, which is the coupling this whole arrangement removes. One
 * directory listing costs one request and needs no registry to keep in step.
 */
export const APPS_DIR = 'apps/';

/**
 * Where a realm keeps the working trees of packages it publishes.
 *
 * A SECOND ROOT, and the reason is worth stating because it is not symmetry.
 * A package's working tree is realm content like any other — the realm indexes
 * it, code mode opens it, and its modules import bare specifiers that
 * something has to resolve. Before per-app maps that something was the realm
 * root map; with the root map gone, a working tree needs pins of its own, and
 * they belong in the map that already sits in that directory declaring the
 * package.
 *
 * Those pins are a LOCKFILE, not a duplicate of the ranges beside them: the
 * ranges say what the author would accept and the pins say what this tree
 * currently develops against, which is exactly the pair a publish seals.
 */
export const PACKAGES_DIR = 'packages/';

/**
 * The directories a realm's maps are discovered under, and how far to descend.
 *
 * BOUNDED ON PURPOSE. Scanning a whole realm for `importmap.json` would be
 * unbounded work on every boot for a realm of any size; naming the roots keeps
 * it to two listings plus one per candidate.
 *
 * The depth differs because the layouts do: an app is `apps/<name>/`, while a
 * package is `<publisher>/<package>` and therefore `packages/<publisher>/<key>/`.
 * Rather than hardcode which is which, a directory holding a map is taken as
 * the answer and only a directory WITHOUT one is descended into — the same
 * rule Deck's own store walk uses to find scoped and unscoped packages without
 * assuming a depth.
 */
export const DECKLIST_ROOTS: readonly { dir: string; maxDepth: number }[] = [
  { dir: APPS_DIR, maxDepth: 1 },
  { dir: PACKAGES_DIR, maxDepth: 2 },
];

/** The URL of an app's own import map. */
export function appImportMapURL(appBase: string): string {
  return `${ensureTrailingSlash(appBase)}${IMPORT_MAP_PATH}`;
}

/**
 * One realm decklist from a root map (if any) and the maps discovered beneath
 * `apps/` and `packages/`.
 *
 * Each map's `imports` become a SCOPE over its own directory, which is
 * precisely what a hand-written root scope said — the difference is only that
 * the statement now lives next to the code it governs, so moving one app's
 * versions cannot touch another's.
 *
 * An app's own `scopes` are carried across verbatim. They were already
 * resolved against the app's base by `resolveImportMap`, so their keys mean
 * that app's subtree and stay correct without re-basing here.
 *
 * PRECEDENCE. An app map wins over a root scope for the same directory. The
 * root map is the older, less specific spelling of the same fact, and when a
 * realm carries both the file sitting beside the code is the one an author
 * just edited. Realm-wide `imports` are untouched: they remain the default for
 * everything no app claims.
 *
 * Pure, and separate from the fetching, so the precedence rules can be tested
 * without a server.
 */
export function composeRealmDecklist(
  root: DecklistInput | undefined,
  found: { base: string; decklist: DecklistInput }[],
): DecklistInput | undefined {
  if (!root && found.length === 0) {
    return undefined;
  }
  // `Record<string, string>`, not `MapValue`: these decklists have already
  // been through `resolveImportMap`, which narrows away the `null` removals.
  // A removal is an instruction for the merge, and the merge is done.
  let scopes: Record<string, Record<string, string>> = {
    ...(root?.scopes ?? {}),
  };
  for (let { base, decklist } of found) {
    // The map's own scopes first, so its self-scope below cannot be
    // overwritten by one it inherited from a pack.
    for (let [key, value] of Object.entries(decklist.scopes ?? {})) {
      scopes[key] = { ...(scopes[key] ?? {}), ...value };
    }
    if (decklist.imports && Object.keys(decklist.imports).length > 0) {
      let key = ensureTrailingSlash(base);
      scopes[key] = { ...(scopes[key] ?? {}), ...decklist.imports };
    }
  }
  return {
    ...(root?.imports ? { imports: root.imports } : {}),
    ...(Object.keys(scopes).length ? { scopes } : {}),
  };
}

/**
 * The URL of a realm's import map.
 */
export function importMapURL(realmURL: string): string {
  return `${ensureTrailingSlash(realmURL)}${IMPORT_MAP_PATH}`;
}

/**
 * Whether a realm's index invalidation list names that realm's import map.
 *
 * BOTH SPELLINGS, and the reason is worth stating because a single wrong
 * guess here costs all reactivity silently. The realm reports the map as
 * `<realm>importmap` — the extension is dropped, the same way it is for a
 * card instance whose id has none. That is what arrives today, verified
 * against a live incremental index. The full filename is accepted too, since
 * it is the file's actual URL and the stripping is the index's convention
 * rather than a promise; matching both costs one comparison, and matching
 * only the wrong one produces an import map that quietly stops propagating.
 */
export function invalidationsNameImportMap(
  invalidations: readonly string[],
  realmURL: string,
): boolean {
  let root = importMapURL(realmURL);
  // ANY app's map counts, not only the realm's own. Since an app owns its
  // pins, editing `apps/rfq-to-payment/importmap.json` changes what that app
  // resolves — and if that did not trigger a reload, the edit would appear to
  // do nothing until the next restart, which is the exact class of silent
  // staleness this file is careful about elsewhere.
  //
  // Matched by SHAPE rather than by listing the apps: this runs against an
  // invalidation list with no directory listing to hand, and a map that
  // arrives for an app nobody has seen yet is precisely the one worth
  // reloading for.
  let appMap = new RegExp(
    `^${escapeForRegExp(ensureTrailingSlash(realmURL))}${escapeForRegExp(
      APPS_DIR,
    )}[^/]+/${escapeForRegExp(IMPORT_MAP_PATH)}$`,
  );
  return invalidations.some((id) => {
    // Both spellings: the indexer reports a module by its extensionless id.
    let bare = id.replace(/\.json$/, '');
    return (
      bare === root.replace(/\.json$/, '') ||
      appMap.test(id) ||
      appMap.test(`${bare}.json`)
    );
  });
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Read one link of an inheritance chain out of the bytes of an
 * `importmap.json`.
 *
 * Tolerant of a file that is missing, empty, or not JSON at all — those
 * yield an empty link, matching how a realm with no map behaves. NOT tolerant
 * of a malformed `deck.extends`: that throws, because a typo'd parent which
 * silently resolved to "inherits nothing" would produce an app missing most
 * of its dependencies, reported much later as unrelated import errors.
 */
export function parseImportMapFile(jsonText: string): DecklistLink {
  return parseLink(jsonText);
}

/**
 * Where a parent named by `deck.extends` keeps its own import map.
 *
 * Deck accepts three spellings of a parent. Two of them have an unambiguous
 * address in a Boxel realm server and are supported here:
 *
 *   https://app.example/catalog/acme/blog@1.2.3/   fully qualified
 *   lib/palette@1.0.0                              a package on this server
 *
 * The second resolves under THIS REALM's `_packages/` door, which is where the
 * versioned package space is served from — the same address a pin in `imports`
 * would name, so a parent and a pin agree about where a version lives.
 *
 * Realm-relative, not server-rooted. A bare `lib/palette@1.0.0` names a
 * package in the namespace of the realm doing the extending, because a realm
 * server governs no global publisher namespace: `lib/palette` means nothing
 * until you know whose it is. Inheriting from another realm's package needs
 * the full-URL spelling above, which says so out loud.
 *
 * The third — a scoped alias like `@catalog/acme/blog@1.2.3/` — is refused.
 * Resolving it needs a mapping from catalog scope to origin that this server
 * does not have and that the corpus has not settled. Refusing with the reason
 * named beats guessing an origin and inheriting from the wrong tree.
 */
export function parentImportMapURL(parent: string, realmURL: string): string {
  if (!isExactParent(parent)) {
    throw new Error(
      `deck.extends must name an exact version, and "${parent}" does not`,
    );
  }
  if (/^https?:\/\//i.test(parent)) {
    return importMapURL(parent);
  }
  if (parent.startsWith('@')) {
    throw new Error(
      `deck.extends names "${parent}", a catalog-scoped parent. This server ` +
        `has no mapping from a catalog scope to an origin, so the parent ` +
        `cannot be fetched. Name it by full URL instead.`,
    );
  }
  // `<publisher>/<package>@<version>` — a package published by THIS realm.
  // Resolved relative to the realm URL rather than to the server root, so the
  // door it lands on is the realm's own.
  let base = realmURL.replace(/\/?$/, '/');
  return new URL(
    `_packages/${parent.replace(/\/$/, '')}/${IMPORT_MAP_PATH}`,
    base,
  ).href;
}

/**
 * Flatten a chain that has already been loaded, ancestor first.
 */
export function flattenImportMaps(
  chain: readonly DecklistLink[],
): DecklistInput {
  return narrow(flattenInheritance(chain));
}

// A Version's own address space: `…/_packages/<publisher>/<name>@<version>/`
// or `…/_packages/<name>@<version>/` for a depot-local one. Neither the name
// segments nor the version may contain a further `@` or `/`, the same grammar
// the serve door parses.
const PACKAGE_BASE = /^(.*\/_packages\/(?:[^/@]+\/)?[^/@]+@([^/@]+)\/)/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/;

/** The Version base a mapped value points into, if it points into one.
 *
 * Exported because the same question gets asked from the other direction: not
 * only "where does this pin point" but "which Version is this module I am
 * about to load part of", which is what tells a client whose pins to install
 * before resolving anything inside it. */
export function packageBaseOf(value: string): string | undefined {
  let match = value.match(PACKAGE_BASE);
  if (!match) {
    return undefined;
  }
  // A RANGE-SPELLED pin — `greeter@%5E2.0.0/` — is deliberately skipped. The
  // sealed map would have to be fetched through a redirect, and the scope key
  // it produced would name the range while the module that gets loaded is
  // addressed by the exact version it redirected to, so the scope would match
  // nothing. Attaching a scope that silently never applies is worse than
  // attaching none: it looks configured. This is the same range-spelling gap
  // that `internalKeyFor` has, and it wants the same fix.
  return EXACT_VERSION.test(decodeURIComponent(match[2]))
    ? match[1]
    : undefined;
}

/**
 * Give every pinned Version its own sealed resolution scope.
 *
 * THE RULING. `deck-a-package-resolves-through-its-own-map.md` §0: a module
 * inside a published Version resolves its imports through that Version's own
 * sealed map. §4 names the two halves that were missing — a pack carrying no
 * lock, and nothing consulting it if it did. The packer emits the lock now;
 * this is the consulting half.
 *
 * The mechanism is the one already there. A Version is served from a URL
 * prefix, its sealed `imports` become `scopes[<that prefix>]`, and import-maps
 * resolution does the rest. Nothing new decides precedence: a realm's own map
 * is installed as a scope over the REALM, a packaged module is not under the
 * realm, so the sealed answer is the only answer a packaged module can get.
 * That is the ruling's §4 precedence rule, obtained by construction rather
 * than by a rule somebody has to remember.
 *
 * Transitive, breadth-first, because `crm` depending on `greeter` depending on
 * `palette` has to work for any of this to be worth having. Cycles terminate
 * on the visited set; depth is bounded so a malformed chain cannot spin.
 *
 * FAILS OPEN, unlike `extends`. A parent that cannot be loaded takes the whole
 * map down because inheritance is a declared, total dependency — half of an
 * inherited map is a lie about what the realm resolves. A sealed lock is
 * neither: it is scoped to one Version, and losing it costs exactly that
 * Version's imports, which will then fail loudly at their own import. Taking a
 * realm's whole map down because one pinned package is unreachable would turn
 * a local outage into a global one.
 */
export async function resolveSealedScopes(options: {
  flat: DecklistInput;
  load: (importMapURL: string) => Promise<DecklistLink | undefined>;
  maxDepth?: number;
}): Promise<{
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
}> {
  let { flat, load, maxDepth = 8 } = options;
  let scopes: Record<string, Record<string, string>> = { ...flat.scopes };
  let visited = new Set<string>();

  let bases = (table: Record<string, string> | undefined) =>
    Object.values(table ?? {})
      .map(packageBaseOf)
      .filter((base): base is string => base !== undefined);

  let queue = [...bases(flat.imports)].map((base) => ({ base, depth: 0 }));
  for (let table of Object.values(flat.scopes ?? {})) {
    queue.push(...bases(table).map((base) => ({ base, depth: 0 })));
  }

  while (queue.length > 0) {
    let { base, depth } = queue.shift()!;
    if (visited.has(base) || depth > maxDepth) {
      continue;
    }
    visited.add(base);
    let mapURL = `${base}${IMPORT_MAP_PATH}`;
    let link: DecklistLink | undefined;
    try {
      link = await load(mapURL);
    } catch {
      // See "fails open" above.
      continue;
    }
    if (!link?.imports || Object.keys(link.imports).length === 0) {
      continue;
    }
    // Resolved against the VERSION's own base, not the realm's. A sealed pin
    // is written origin-relative (`/_packages/…`) on purpose — see
    // `realm-server/lib/package-lock.ts` — so it means the package space of
    // whichever host is serving this Version, which is what resolving against
    // the Version's own URL produces.
    let resolved = resolveLinkAgainst(link, mapURL);
    let sealed = narrow({
      imports: resolved.imports ?? {},
      scopes: {},
    }).imports;
    // The realm's own scope entry for this base, if it wrote one, is an
    // override the author chose and can read back — the ruling's §3 "deliberate
    // override" — so it is applied ON TOP of the sealed table rather than
    // under it.
    scopes[base] = { ...sealed, ...(scopes[base] ?? {}) };
    queue.push(
      ...bases(sealed).map((child) => ({ base: child, depth: depth + 1 })),
    );
  }

  return { imports: flat.imports ?? {}, scopes };
}

/**
 * Walk a map's ancestry and flatten it into the single map the loader gets.
 *
 * `load` is the caller's, because fetching a parent is I/O and the walk has
 * to stay usable in a browser. Fails closed: a parent that cannot be loaded
 * throws rather than yielding a partial map.
 */
export async function resolveImportMap(options: {
  start: DecklistLink;
  load: (parentURL: string) => Promise<DecklistLink | undefined>;
  realmURL: string;
}): Promise<DecklistInput> {
  let { start, load, realmURL } = options;
  if (!start.extends) {
    // The overwhelmingly common case, and worth not paying an INHERITANCE
    // walk for. The sealed-scope walk still runs: it is driven by the pins a
    // map holds, which a map with no parent has just as often as one with.
    return resolveSealedScopes({
      flat: flattenImportMaps([resolveLinkAgainst(start, realmURL)]),
      load,
    });
  }
  // EVERY LINK IS RESOLVED AGAINST THE URL IT CAME FROM, before the merge.
  //
  // A map's relative values mean "next to me", and inheritance is the one
  // place where "me" differs per link: a parent published at
  // `/_packages/acme/gallery@1.2.3/` writing `./scene.js` means that
  // package's scene, not a file of the same name sitting in whichever realm
  // remixed it. Flattening first and resolving once at the end — which is
  // what a single base would do — silently re-homes every inherited entry
  // onto the child, and the failure is invisible until an inherited module
  // 404s or, worse, hits an unrelated file the child happens to have.
  //
  // `null` survives resolution untouched: it is a removal instruction, not
  // an address.
  let flat = await resolveInheritance({
    start: resolveLinkAgainst(start, realmURL),
    load: async (parent) => {
      let parentURL = parentImportMapURL(parent, realmURL);
      let link = await load(parentURL);
      return link && resolveLinkAgainst(link, parentURL);
    },
  });
  return resolveSealedScopes({ flat: narrow(flat), load });
}

/**
 * Make every address in one link absolute against that link's own base.
 *
 * Scope KEYS are resolved too: they are matched against the importer's URL,
 * so a scope inherited from a parent has to keep meaning the parent's
 * subtree rather than the child's.
 */
function resolveLinkAgainst(link: DecklistLink, baseURL: string): DecklistLink {
  let resolve = (value: MapValue): MapValue => {
    if (value === null || typeof value !== 'string') {
      return value;
    }
    try {
      return new URL(value, baseURL).href;
    } catch {
      // A bare specifier mapped onto another bare specifier is not a URL and
      // is passed through rather than dropped — the map is user-authored,
      // and losing the whole entry over one odd value is the worse failure.
      return value;
    }
  };
  let resolveKey = (key: string): string => {
    try {
      return new URL(key, baseURL).href;
    } catch {
      return key;
    }
  };

  let imports: Record<string, MapValue> = {};
  for (let [specifier, value] of Object.entries(link.imports ?? {})) {
    imports[specifier] = resolve(value);
  }
  let scopes: Record<string, Record<string, MapValue> | null> = {};
  for (let [prefix, table] of Object.entries(link.scopes ?? {})) {
    if (table === null) {
      scopes[resolveKey(prefix)] = null;
      continue;
    }
    let resolved: Record<string, MapValue> = {};
    for (let [specifier, value] of Object.entries(table)) {
      resolved[specifier] = resolve(value);
    }
    scopes[resolveKey(prefix)] = resolved;
  }
  return { ...link, imports, scopes };
}

/**
 * The map is user-authored and can be saved mid-edit in any shape, so nothing
 * downstream may assume a value is a string. An entry that is not one is
 * dropped and the rest of the map still applies: refusing the whole map over
 * one bad entry would take a user's working pins away at the moment they are
 * editing them.
 *
 * A malformed `extends` is the deliberate exception — see
 * `parseImportMapFile`.
 */
function narrow(flat: {
  imports: Record<string, unknown>;
  scopes: Record<string, Record<string, unknown>>;
}): DecklistInput {
  let imports: Record<string, string> = {};
  for (let [specifier, value] of Object.entries(flat.imports ?? {})) {
    if (typeof value === 'string') {
      imports[specifier] = value;
    }
  }
  let scopes: Record<string, Record<string, string>> = {};
  for (let [prefix, table] of Object.entries(flat.scopes ?? {})) {
    if (typeof table !== 'object' || table === null) {
      continue;
    }
    let narrowed: Record<string, string> = {};
    for (let [specifier, value] of Object.entries(table)) {
      if (typeof value === 'string') {
        narrowed[specifier] = value;
      }
    }
    scopes[prefix] = narrowed;
  }
  return { imports, scopes };
}
