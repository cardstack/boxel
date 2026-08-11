// Read-only serve door for the versioned package address space.
//
// Third-party libraries should be addresses in our own world rather than
// forever-links to esm.sh. Until this handler answers
// `…/lib/three@0.169.0/build/three.module.js`, a decklist has nothing to pin
// and "app = decklist" is a slide rather than a system — which is why this
// small handler is a prerequisite for the resolver work and not a nicety.
//
// GRAMMAR. Deck's: `<name>@<spec>/<path>`, where `<name>` is
// `<publisher>/<package>` or a bare `<package>`. Mounted under `/_packages/`
// rather than `/catalog/` because `/catalog/` is already a realm on this
// server; reconciling the two address spaces is a routing decision that
// belongs with the catalog work, not with a read-only file server. The
// version lives in the path either way, which is the part decklists pin.
//
// WRITES. There are none here. Publishing goes through
// `lib/package-registry.ts`, which this handler deliberately does not call:
// a GET must never be able to mutate the store, and keeping the gate out of
// reach is cheaper than proving it is never invoked.

import { Readable } from 'node:stream';
import { lookup as lookupMimeType } from 'mime-types';
import type { ResponseWithNodeStream } from '@cardstack/runtime-common';
import { executableExtensions } from '@cardstack/runtime-common';
import {
  readStoreMeta,
  readStoredFile,
  resolveVersionSpec,
} from '@cardstack/deck/node';
import type Koa from 'koa';
import { setContextResponse } from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';

export interface ParsedPackagePath {
  name: string;
  spec: string;
  path: string;
}

export type ParseResult =
  | { ok: true; request: ParsedPackagePath }
  | { ok: false; code: string; detail: string };

// Pure, so the grammar can be tested without a server. `rest` is everything
// after the `/_packages/` prefix, already URL-decoded by the router.
export function parsePackagePath(rest: string): ParseResult {
  let at = rest.indexOf('@');
  if (at <= 0) {
    return {
      ok: false,
      code: 'malformed-address',
      detail:
        'expected <name>@<version>/<path>, e.g. lib/three@0.169.0/build/three.module.js',
    };
  }
  let name = rest.slice(0, at);
  let afterAt = rest.slice(at + 1);
  let slash = afterAt.indexOf('/');
  if (slash === -1) {
    return {
      ok: false,
      code: 'no-file-path',
      detail:
        `${name}@${afterAt} names a version but not a file; this endpoint ` +
        'serves files, so ask for one (there is no default entry point)',
    };
  }
  let spec = afterAt.slice(0, slash);
  let path = afterAt.slice(slash + 1);
  if (!spec) {
    return { ok: false, code: 'malformed-address', detail: 'empty version' };
  }
  if (!path) {
    return { ok: false, code: 'no-file-path', detail: 'empty file path' };
  }
  // Traversal is checked here rather than trusted to the store: the store
  // resolves a path inside a content-addressed tree, and a `..` that escaped
  // would be a filesystem read outside it. Cheap to refuse, expensive to be
  // wrong about.
  if (
    path.split('/').some((segment) => segment === '..' || segment === '.') ||
    path.startsWith('/')
  ) {
    return {
      ok: false,
      code: 'malformed-address',
      detail: 'file path may not contain . or .. segments',
    };
  }
  return { ok: true, request: { name, spec, path } };
}

function errorResponse(status: number, code: string, detail: string) {
  return new Response(JSON.stringify({ errors: [{ code, detail }] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default function handlePackageServe({
  packageStorePath,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    if (!packageStorePath) {
      // Inert until a store is configured, and says so rather than 404-ing:
      // "no such package" and "this server does not serve packages" are
      // different problems and a caller can act on the difference.
      return setContextResponse(
        ctxt,
        errorResponse(
          501,
          'package-serving-not-configured',
          'this realm server has no package store configured',
        ),
      );
    }

    // The `*rest` wildcard: @koa/router hands back the joined remainder as a
    // string, but tolerate an array in case a future router version returns
    // segments instead — the alternative is a silent `[object Array]` in the
    // package name.
    let raw = ctxt.params?.rest;
    let rest = Array.isArray(raw) ? raw.join('/') : (raw ?? '');

    // An address with no `@` names the PACKAGE rather than a file inside one
    // version of it, and answers with the versions that exist.
    //
    // Anything that has to offer a CHOICE of version — a picker, a lock card,
    // a timeline — otherwise has to invent version numbers and probe for
    // 404s. That is a scan, not a listing, and it can never discover a
    // version nobody thought to guess.
    //
    // Read-only like the rest of this door. It reports what the store holds
    // and cannot change it; publishing stays out of reach of a GET.
    if (rest && !rest.includes('@')) {
      let name = rest.replace(/\/+$/, '');
      let meta = await readStoreMeta(packageStorePath, name);
      if (!meta) {
        return setContextResponse(
          ctxt,
          errorResponse(404, 'unknown-package', `no package named ${name}`),
        );
      }
      // Newest first, by publish time rather than by semver. This is the
      // order things HAPPENED, which is what a timeline wants — and it stays
      // right for a store holding versions no semver comparison would order
      // the way they were actually released.
      let versions = Object.entries(meta.versions ?? {})
        .map(([version, record]) => ({
          version,
          treeHash: record.treeHash,
          publishedAt: record.publishedAt,
        }))
        // A record with no publish time sorts last rather than throwing off
        // the comparison — an unstamped version is older bookkeeping, not a
        // reason to refuse the whole listing.
        .sort((a, b) =>
          (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
        );
      return setContextResponse(
        ctxt,
        new Response(
          JSON.stringify({ name: meta.name, versions, tags: meta.tags ?? {} }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              // Never cached, unlike the immutable bytes this door usually
              // serves. The whole reason to ask is to find out whether
              // something new landed; a cached answer would make a picker
              // blind to precisely the version it is looking for.
              'cache-control': 'no-store',
            },
          },
        ),
      );
    }

    let parsed = parsePackagePath(rest);
    if (!parsed.ok) {
      return setContextResponse(
        ctxt,
        errorResponse(400, parsed.code, parsed.detail),
      );
    }
    let { name, spec, path } = parsed.request;

    let meta = await readStoreMeta(packageStorePath, name);
    if (!meta) {
      return setContextResponse(
        ctxt,
        errorResponse(404, 'unknown-package', `no package named ${name}`),
      );
    }

    let resolution = resolveVersionSpec(spec, meta);
    if (resolution.kind === 'invalid') {
      // Permanent: the spec is not a version, tag, or range in any store.
      return setContextResponse(
        ctxt,
        errorResponse(400, 'invalid-version-spec', resolution.detail),
      );
    }
    if (resolution.kind === 'not-found') {
      return setContextResponse(
        ctxt,
        errorResponse(404, 'unknown-version', resolution.detail),
      );
    }
    if (resolution.kind === 'redirect') {
      // A tag or range is a question whose answer changes. Redirect to the
      // exact address so the immutable response below is only ever served
      // from a URL that can honestly promise immutability, and mark the
      // redirect itself uncacheable.
      let exact = `/_packages/${name}@${resolution.version}/${path}`;
      return setContextResponse(
        ctxt,
        new Response(null, {
          status: 302,
          headers: { location: exact, 'cache-control': 'no-store' },
        }),
      );
    }

    let servedPath = path;
    let bytes = await readStoredFile(
      packageStorePath,
      name,
      resolution.version,
      path,
    );
    if (!bytes) {
      // An EXTENSIONLESS module path resolves to its executable file, the same
      // way a realm resolves one. This is not a convenience. Type identity is
      // formed by `internalKeyFor`, which TRIMS the executable extension, so
      // the canonical address of a card type is `…/greeter@2.4.0/index` and
      // never `…/index.js`. Anything that starts from a type key and then
      // fetches the module — the definition lookup, and through it every field
      // predicate in a query — asks for the trimmed form. A realm answers it.
      // Without this the package store 404s, the definition never populates,
      // and `eq` against a package-hosted type silently matches NOTHING
      // instead of erroring, which is the worst failure shape available.
      //
      // Tried only on a miss, so an exact file always wins and a package that
      // genuinely holds both `x` and `x.js` is unaffected.
      for (let extension of executableExtensions) {
        let candidate = `${path}${extension}`;
        bytes = await readStoredFile(
          packageStorePath,
          name,
          resolution.version,
          candidate,
        );
        if (bytes) {
          servedPath = candidate;
          break;
        }
      }
    }
    if (!bytes) {
      return setContextResponse(
        ctxt,
        errorResponse(
          404,
          'unknown-file',
          `${name}@${resolution.version} does not contain ${path}`,
        ),
      );
    }

    // Hand back a Node stream rather than a Response body. `setContextResponse`
    // reads a web-stream body back with `webStreamToText`, which is fine for
    // JS and CSS and silently corrupts everything else — and a package store
    // holds .wasm, fonts and textures alongside the modules. `Readable.from`
    // is given an ARRAY containing the buffer: handed the buffer directly it
    // iterates it as individual bytes.
    let response = new Response(null, {
      status: 200,
      headers: {
        // The SERVED path, not the requested one: an extensionless module
        // request resolved to `index.gts`/`index.js` above, and typing it from
        // the bare request would hand a browser `application/octet-stream` for
        // something it is about to evaluate as a module.
        'content-type':
          lookupMimeType(servedPath) || 'application/octet-stream',
        'content-length': String(bytes.byteLength),
        // An exact version is immutable by construction (Deck L4) — the
        // registry gate refuses to republish one with different bytes, so
        // this promise is enforced rather than hoped for. PR 6 generalises
        // cache classes across the server; this is the one address where the
        // answer is already unambiguous.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    }) as ResponseWithNodeStream;
    response.nodeStream = Readable.from([bytes]);
    return setContextResponse(ctxt, response);
  };
}
