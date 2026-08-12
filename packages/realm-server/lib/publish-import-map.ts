// Re-home a realm's import map when the realm is published.
//
// THE BUG THIS EXISTS TO PREVENT. Publish copies a realm's tree verbatim onto
// a DIFFERENT ORIGIN — a published realm lives on its own host, not on the
// realm server that authored it. Every relative reference survives that move
// untouched, which is the whole reason a well-written realm needs almost no
// re-homing. An ORIGIN-RELATIVE one does not:
//
//     "palette": "/demo/_packages/lib/palette@1.0.0/index.js"
//
// means "the package store on whatever host is serving me". At the source
// that is the realm server, and the store is there. At the destination it is
// the published host, where no store exists and never will — the versioned
// package space is served by the realm server alone. So the pin resolves to a
// 404 the moment the realm is published, and nothing about the copy looks
// wrong: the bytes are identical, the map is valid, and the failure surfaces
// later as a module that cannot be found.
//
// WHY THE CLASSIFIER RATHER THAN A PREFIX SWAP. Search-and-replace over the
// map would work until a value that is merely data looked like a reference,
// which is exactly the failure `@cardstack/deck/classify` was written to
// refuse (see its header). Asking it per value keeps three cases honest and
// separate:
//
//   relative  →  leave.    It travels with the tree and means the same thing
//                          at the destination. This is most of a good map.
//   `/…`      →  rewrite.  Origin-relative: the origin is precisely what
//                          changed, so re-point it at the source server.
//   absolute  →  leave.    Someone else's URL. Rewriting it would invent an
//                          address; it is reported instead.
//
// The source base handed to the classifier is `/` — for an origin-relative
// value, the root of the source origin IS "the prefix that means this tree's
// host", and that is the one thing that certainly has to be re-pointed.

import fsExtra from 'fs-extra';
import { join } from 'path';
import { classifyReference, summarise } from '@cardstack/deck/classify';
import { IMPORT_MAP_PATH } from '@cardstack/runtime-common';

const { pathExists, readFile, writeFile } = fsExtra;

export interface RebindReport {
  /** No map in this realm — the ordinary case, and not a failure. */
  absent: boolean;
  rewritten: number;
  left: number;
  /** Absolute references pointing somewhere this server does not own. */
  foreign: string[];
}

/**
 * Rewrite the published copy's `importmap.json` in place.
 *
 * Operates on the COPY, never the source: the author's map keeps its
 * portable relative form, and only the published snapshot is pinned to the
 * server that can actually serve it.
 *
 * Best-effort about the file, strict about its contents. A realm with no map,
 * or a map that is not JSON, is left exactly as it is — publish must not fail
 * because a realm has no pins, and a map that is already broken is not made
 * worse by copying it. What it will not do is half-rewrite: the file is
 * written once, at the end, or not at all.
 */
export async function rebindPublishedImportMap(
  publishedRealmPath: string,
  opts: { serverURL: string; sourceRealmURL?: string },
): Promise<RebindReport> {
  let mapPath = join(publishedRealmPath, IMPORT_MAP_PATH);
  if (!(await pathExists(mapPath))) {
    return { absent: true, rewritten: 0, left: 0, foreign: [] };
  }

  let raw = await readFile(mapPath, 'utf8');
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { absent: false, rewritten: 0, left: 0, foreign: [] };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { absent: false, rewritten: 0, left: 0, foreign: [] };
  }

  let seen: { value: string; result: ReturnType<typeof classifyReference> }[] =
    [];

  let rebind = (value: unknown): unknown => {
    if (typeof value !== 'string') {
      // `null` removes an inherited entry; anything else is malformed and is
      // not this function's to repair.
      return value;
    }
    let result = classifyReference({
      value,
      // Every value in an import map is a reference by construction — that is
      // what an import map is. This is the one place `role` is not a judgement
      // call.
      role: 'reference',
      sourceBase: '/',
    });
    seen.push({ value, result });
    if (result.action === 'rewrite') {
      return new URL(`/${result.rest}`, opts.serverURL).href;
    }
    return value;
  };

  let next: Record<string, unknown> = { ...doc };

  if (isPlainObject(doc.imports)) {
    let imports: Record<string, unknown> = {};
    for (let [specifier, value] of Object.entries(doc.imports)) {
      imports[specifier] = rebind(value);
    }
    next.imports = imports;
  }

  if (isPlainObject(doc.scopes)) {
    let scopes: Record<string, unknown> = {};
    for (let [prefix, table] of Object.entries(doc.scopes)) {
      if (!isPlainObject(table)) {
        // A whole scope dropped with `null` stays dropped.
        scopes[prefix] = table;
        continue;
      }
      let rebound: Record<string, unknown> = {};
      for (let [specifier, value] of Object.entries(table)) {
        rebound[specifier] = rebind(value);
      }
      // Scope KEYS are matched against the importer's URL, and importers in a
      // published realm are addressed relative to that realm — so a key that
      // is already relative still means the same subtree and is left alone.
      // An origin-relative key has the same problem as a value and gets the
      // same treatment.
      let reboundKey = rebind(prefix);
      scopes[typeof reboundKey === 'string' ? reboundKey : prefix] = rebound;
    }
    next.scopes = scopes;
  }

  // `deck.extends` names a parent that a depot-local spelling resolves under
  // the SOURCE REALM's `_packages/` door — the same store on the same server —
  // so it breaks on a new origin for the same reason a pin does. Rewriting it
  // to the fully qualified form is what keeps a published remix able to find
  // what it inherits.
  //
  // Resolved against the source realm rather than the server root, because a
  // bare parent names a package in that realm's namespace: a realm server
  // governs no global publisher namespace, so `lib/palette@1.0.0` is only
  // meaningful once you know whose it is. Without a source realm there is no
  // namespace to resolve in, so the value is left alone rather than rewritten
  // to an address that would resolve to the wrong package or to none.
  let deck = doc.deck;
  if (isPlainObject(deck) && typeof deck.extends === 'string') {
    let parent = deck.extends;
    if (
      !/^https?:\/\//i.test(parent) &&
      !parent.startsWith('@') &&
      opts.sourceRealmURL
    ) {
      let realmBase = new URL(
        opts.sourceRealmURL.replace(/\/?$/, '/'),
        opts.serverURL,
      );
      let absolute = new URL(
        `_packages/${parent.replace(/^\/+|\/+$/g, '')}/`,
        realmBase,
      ).href;
      next.deck = { ...deck, extends: absolute };
      seen.push({
        value: parent,
        result: { action: 'rewrite', reason: 'source-base', rest: parent },
      });
    }
  }

  let report = summarise(seen);
  if (report.rewrite > 0) {
    await writeFile(mapPath, `${JSON.stringify(next, null, 2)}\n`);
  }
  return {
    absent: false,
    rewritten: report.rewrite,
    left: report.leave,
    foreign: report.foreign,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
