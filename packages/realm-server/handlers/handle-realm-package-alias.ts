// The short, realm-relative address for a package the realm published:
//
//   GET <realm>/@crm@2.0.0            → the package's entry module
//   GET <realm>/@crm@2.0.0/account    → an export alias
//   GET <realm>/@crm@2.0.0/lead.gts   → any file in the Version
//
// `deck-multi-package-design.md` §4 specifies both redirects. What this does
// NOT do is serve the bytes: it resolves the short name and sends a 302 into
// `<realm>/_packages/<publisher>/<name>@<version>/…`, which is where the
// published tree actually lives. Both addresses sit beneath the SAME realm,
// because the realm is what governs the package name — see
// `lib/package-store.ts`.
//
// THAT SPLIT IS THE POINT. A published Version must not change when the realm
// it came from is edited, moved or deleted, and only the store can promise
// that — the realm's tree is by definition the mutable thing. Serving out of
// the tree would also put a realm read on the path of every module load of
// every consumer. So the realm keeps the convenient name and the store keeps
// the bytes, and the redirect is the one line that joins them.
//
// The redirect itself is uncacheable while its target is immutable: the
// publisher for a realm can be re-declared, so this answer can change, and
// the address it points at cannot.

import type Koa from 'koa';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { IMPORT_MAP_PATH } from '@cardstack/deck/import-map';
import { readStoreMeta, readStoredFile } from '@cardstack/deck/node';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware/index.ts';
import { findOrMountRealm } from '../lib/realm-routing.ts';
import { packageStoreForRealm } from '../lib/package-store.ts';
import type { RealmRegistryReconciler } from '../lib/realm-registry-reconciler.ts';
import {
  discoverRealmPackages,
  readPackageManifest,
  storeNameFor,
  type RealmPackage,
} from '../lib/realm-packages.ts';

/** The conventional location, read directly. Undefined if it is not there or
 *  does not name the package asked for. */
async function packageAt(
  realmDir: string,
  key: string,
): Promise<RealmPackage | undefined> {
  let text = await readFile(join(realmDir, key, IMPORT_MAP_PATH), 'utf8').catch(
    () => undefined,
  );
  if (!text) {
    return undefined;
  }
  let manifest = readPackageManifest(text);
  if (manifest.kind !== 'package' || manifest.key !== key) {
    return undefined;
  }
  return {
    dir: join(realmDir, key),
    path: key,
    key,
    publisher: manifest.publisher,
    declaration: manifest.declaration,
  };
}

// `<prefix>/@<key>@<version>` plus an optional path.
//
// Neither the key nor the version may contain a further `@` or a `/`. That is
// what keeps the grammar unambiguous against a realm path that merely happens
// to contain an `@` — and without it `@a@b@c` parses, silently choosing one
// of two readings of where the version starts.
const ALIAS =
  /^(?<prefix>.*?)\/@(?<key>[^@/]+)@(?<version>[^@/]+)(?:\/(?<rest>.*))?$/;

export interface RealmPackageAlias {
  /** Everything before the alias segment — the realm's path. */
  prefix: string;
  key: string;
  version: string;
  /** An export alias or a file path inside the Version; empty means the
   *  entry module. */
  rest: string;
}

/**
 * Pure so the grammar can be tested without a server, and because the cost of
 * getting it wrong is not a 404 — it is a realm path being swallowed by a
 * handler that has no business answering it.
 */
export function parseRealmPackageAlias(
  path: string,
): RealmPackageAlias | undefined {
  let match = path.match(ALIAS);
  if (!match?.groups) {
    return undefined;
  }
  let { prefix, key, version, rest } = match.groups as Record<string, string>;
  return { prefix, key, version, rest: rest ?? '' };
}

export type HandleRealmPackageAliasDeps = {
  realms: Realm[];
  reconciler: RealmRegistryReconciler;
  dbAdapter: DBAdapter;
  packageStorePath?: string;
};

function notFound(detail: string): Response {
  return new Response(
    JSON.stringify({ errors: [{ code: 'unknown-package-alias', detail }] }),
    {
      status: 404,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    },
  );
}

export default function handleRealmPackageAlias({
  realms,
  reconciler,
  dbAdapter,
  packageStorePath,
}: HandleRealmPackageAliasDeps): (
  ctxt: Koa.Context,
  next: Koa.Next,
) => Promise<void> {
  return async function (ctxt: Koa.Context, next: Koa.Next) {
    // Defer immediately on anything that is not shaped like an alias, so a
    // realm holding a path with an `@` in it flows through untouched.
    let storeRoot = packageStorePath;
    let alias = storeRoot ? parseRealmPackageAlias(ctxt.path) : undefined;
    if (!storeRoot || !alias || ctxt.method !== 'GET') {
      return next();
    }
    let { prefix, key, version, rest } = alias;

    let realm = await findOrMountRealm(new URL(`${ctxt.origin}${prefix}/`), {
      realms,
      reconciler,
      dbAdapter,
    });
    if (!realm?.dir) {
      return next();
    }
    // The realm governs the package namespace, so its store is the only one
    // this alias can resolve against and its path is the prefix the redirect
    // lands under. `realm.url` rather than the request's `prefix`: the two
    // agree for a request that hit the realm root exactly, and only the
    // registry's answer is right when they do not.
    let realmPath = new URL(realm.url).pathname.replace(/\/?$/, '/');
    let storeDir = packageStoreForRealm(storeRoot, realm.url);

    // The convention first: a package's directory is normally named after it,
    // so `<realm>/<key>/importmap.json` is one read rather than a tree walk on
    // a request path. `deck-a-package-carries-its-own-name.md` §2.1 makes the
    // manifest authoritative and the layout a convention — so this is an index
    // into the scan, and the manifest still decides.
    let found = await packageAt(realm.dir, key);
    if (!found) {
      // Fall back to a scan, because the convention is only a convention.
      let { packages } = await discoverRealmPackages(realm.dir);
      found = packages.find((p) => p.key === key);
    }
    if (!found) {
      // The realm holds no such package. Deferring rather than 404-ing leaves
      // the realm's own router free to answer, which is right: a file
      // literally called `@crm@2.0.0` is a legal realm path.
      return next();
    }

    let name = storeNameFor(found.publisher, key);
    let meta = await readStoreMeta(storeDir, name);
    if (!meta?.versions?.[version]) {
      // The realm declares the package but the store has no such Version —
      // most often "declared but never published". Worth saying, rather than
      // falling through to a 404 about a path nobody wrote.
      return setContextResponse(
        ctxt,
        notFound(
          `${name}@${version} is declared by this realm but is not published`,
        ),
      );
    }

    // No path: the entry module, which the pack's own manifest names. Read
    // through the store rather than from the realm's live declaration — the
    // published Version's entry is whatever it was sealed with, and the
    // realm may have moved on since.
    let path = rest;
    if (!path) {
      let entry = await entryOf(storeDir, name, version, key);
      if (!entry) {
        return setContextResponse(
          ctxt,
          notFound(`${name}@${version} declares no entry module`),
        );
      }
      path = entry;
    } else {
      let target = await exportOf(storeDir, name, version, key, path);
      if (target) {
        path = target;
      }
    }

    return setContextResponse(
      ctxt,
      new Response(null, {
        status: 302,
        headers: {
          location: `${realmPath}_packages/${name}@${version}/${path}`,
          // The target is immutable; the answer to "where does @crm@2.0.0
          // point" is not, because a realm can re-declare its publisher.
          'cache-control': 'no-store',
        },
      }),
    );
  };
}

async function manifestOf(
  storeDir: string,
  name: string,
  version: string,
): Promise<Record<string, any> | undefined> {
  let bytes = await readStoredFile(storeDir, name, version, IMPORT_MAP_PATH);
  if (!bytes) {
    return undefined;
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return undefined;
  }
}

function packagesOf(manifest: Record<string, any> | undefined) {
  return manifest?.deck?.packages ?? manifest?.boxel?.packages;
}

// `$DECK/app.gts` inside a pack means the pack root, so the token is simply
// dropped to get a path the serve door understands.
function packRelative(value: string | undefined): string | undefined {
  return value?.replace(/^\$DECK\//, '');
}

async function entryOf(
  storeDir: string,
  name: string,
  version: string,
  key: string,
): Promise<string | undefined> {
  let manifest = await manifestOf(storeDir, name, version);
  return packRelative(packagesOf(manifest)?.[key]?.entry);
}

async function exportOf(
  storeDir: string,
  name: string,
  version: string,
  key: string,
  alias: string,
): Promise<string | undefined> {
  let manifest = await manifestOf(storeDir, name, version);
  let exports = packagesOf(manifest)?.[key]?.exports;
  // Both spellings, because `./account` is how a package.json-shaped exports
  // map is written and `account` is what a URL path actually carries.
  return packRelative(exports?.[`./${alias}`] ?? exports?.[alias]);
}
