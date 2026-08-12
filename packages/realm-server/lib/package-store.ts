// WHERE A REALM'S PUBLISHED PACKAGES LIVE, and why that is a per-realm root
// rather than one store for the server.
//
// ─── THE PROBLEM WITH A SERVER-WIDE STORE ───────────────────────────────────
//
// The first cut served every package from `/_packages/<publisher>/<name>@<v>/`
// at the server root. That address has no room in it for WHO decided what
// `cardstack/contracts` means, so the answer defaulted to the realm server —
// whoever published that name first owned it for everyone on the box. A realm
// server is a file server and a renderer. Making it the arbiter of a global
// publisher namespace hands it a registry's job, and a registry's politics,
// neither of which it asked for and neither of which it can do well: there is
// no process here for granting a name, disputing one, or transferring one, and
// inventing one would be inventing npm inside a card server.
//
// ─── THE FIX IS AN ADDRESS, NOT A POLICY ────────────────────────────────────
//
// Put the realm in the URL:
//
//     https://server.example/atlas/_packages/cardstack/contracts@1.1.0/index.js
//
// Now the name is qualified by a realm that already has an owner, an ACL and a
// lifecycle, so "who says what this name means" has an answer that predates
// the question. Two realms may both publish `cardstack/contracts`; they are
// different packages at different addresses and nothing has to adjudicate
// between them. The server governs nothing, which is the point.
//
// Authorization falls out for free and stops being a thing this code does at
// all: the bytes sit under the realm's own prefix, so the realm's read
// permission governs them the same way it governs every other path beneath it.
// The `lib/package-origins.ts` sidecar that existed only to answer "which
// realm published this" is deleted rather than kept in sync — the URL says it.
//
// ─── WHY THE REALM IS THE STORE ROOT AND NOT PART OF THE NAME ───────────────
//
// Deck keys a package as `<publisher>/<package>` — two segments, validated,
// and `packages/deck` is VENDORED VERBATIM here (fixes go to ~/Projects/deck
// and are pulled through). So the realm cannot become a third name segment
// without editing a vendored dependency to carry a concept that is Boxel's and
// not Deck's: Deck stores content, and has no idea what a realm is.
//
// Rooting the store per realm needs no such change, and it makes the property
// STRUCTURAL rather than conventional — two realms cannot collide because they
// are not writing to the same tree. The cost, stated: identical bytes published
// by two realms are stored twice, because each root has its own content-
// addressed object dir. That is worth paying for isolation, and it is
// recoverable later by sharing an object dir under per-realm indexes.
//
// LAYOUT. `<store>/<host>/<realm path…>/<publisher>/<package>/meta.json`, e.g.
// `.package-store/server.example/atlas/cardstack/contracts/meta.json`. Host
// first because a store may one day hold mirrors of realms from more than one
// server and a bare path would collide; readable segments throughout because
// the whole serving design is meant to run off a plain filesystem or an S3
// bucket, and this is a key S3 takes verbatim.

import { join } from 'path';

// `:` is legal in a POSIX filename and awkward everywhere else — S3 keys,
// Windows checkouts, shell globs. A port is rare enough outside dev that
// spending a character on it costs nothing.
function hostSegment(url: URL): string {
  return url.host.replace(/:/g, '_');
}

// Refused rather than sanitised. A realm path segment that is `.`, `..` or
// empty cannot be turned into a safe directory name by rewriting it — any
// mapping that makes it safe also makes two distinct realms share a root,
// which is the exact failure this file exists to prevent.
const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * The Deck store root for one realm's published packages.
 *
 * Throws on a realm URL whose path cannot be expressed as directory segments.
 * That is a programming error rather than a request error — every realm URL in
 * the system comes from the registry, not from a user — so it is loud.
 */
export function packageStoreForRealm(
  packageStorePath: string,
  realmURL: string | URL,
): string {
  let url = typeof realmURL === 'string' ? new URL(realmURL) : realmURL;
  let segments = url.pathname.split('/').filter(Boolean);
  for (let segment of segments) {
    if (!SAFE_SEGMENT.test(segment) || segment === '.' || segment === '..') {
      throw new Error(
        `realm ${url.href} has a path segment that cannot root a package ` +
          `store: ${JSON.stringify(segment)}`,
      );
    }
  }
  return join(packageStorePath, hostSegment(url), ...segments);
}

// The two doors, as they appear under a realm. Kept here beside the store root
// because they are the same decision seen from the wire: `<realm>/_packages/`
// is the module door and `<realm>/_source/` is the bytes-as-authored door, and
// both are rooted at a realm rather than at the server.
export const MODULE_DOOR = '/_packages/';
export const SOURCE_DOOR = '/_source/';

export interface RealmPackageDoor {
  /** The realm's path, with its trailing slash — `/atlas/`. */
  realmPath: string;
  door: typeof MODULE_DOOR | typeof SOURCE_DOOR;
  /** `<name>@<version>/<path>`, exactly what the door's grammar parses. */
  rest: string;
}

/**
 * Split a request path into the realm that governs the names and the package
 * address beneath it. `undefined` for a path that names neither door, so the
 * middleware can defer to the realm's own router without a second opinion.
 *
 * The FIRST occurrence of a door marker wins. Realm paths cannot contain one —
 * `_`-prefixed segments are reserved by the realm server — while a pack MAY
 * ship a directory called `_packages`, and splitting on the last occurrence
 * would let a published file rename the realm.
 *
 * Pure, so the grammar is testable without a server, and because getting it
 * wrong is not a 404: it is a realm path swallowed by a handler with no
 * business answering it.
 */
export function parseRealmPackageDoor(
  path: string,
): RealmPackageDoor | undefined {
  let earliest: RealmPackageDoor | undefined;
  let earliestAt = Infinity;
  for (let door of [MODULE_DOOR, SOURCE_DOOR] as const) {
    let at = path.indexOf(door);
    // `at > 0`: a door at position 0 is the old server-root address, which no
    // longer exists. Refusing it here rather than silently treating the server
    // root as a realm is what makes the removal visible instead of mysterious.
    //
    // EARLIEST ACROSS BOTH DOORS, not first-in-this-loop: a pack is allowed to
    // ship a file under `_packages/`, so `/atlas/_source/x@1/_packages/y` has
    // both markers and only the leftmost one is the realm boundary. Checking
    // them in declaration order would let that path claim a realm of
    // `/atlas/_source/x@1`.
    if (at > 0 && at < earliestAt) {
      earliestAt = at;
      earliest = {
        realmPath: `${path.slice(0, at)}/`,
        door,
        rest: path.slice(at + door.length),
      };
    }
  }
  return earliest;
}
