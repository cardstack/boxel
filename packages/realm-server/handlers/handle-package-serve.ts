// Read-only serve door for the versioned package address space.
//
// Third-party libraries should be addresses in our own world rather than
// forever-links to esm.sh. Until this handler answers
// `…/lib/three@0.169.0/build/three.module.js`, a decklist has nothing to pin
// and "app = decklist" is a slide rather than a system — which is why this
// small handler is a prerequisite for the resolver work and not a nicety.
//
// GRAMMAR. Deck's: `<name>@<spec>/<path>`, where `<name>` is
// `<publisher>/<package>` or a bare `<package>`. The version lives in the
// path, which is the part decklists pin.
//
// MOUNTED UNDER A REALM, NOT UNDER THE SERVER:
//
//     https://server.example/atlas/_packages/cardstack/contracts@1.1.0/index.js
//
// An earlier pass served this from the server root, which quietly made the
// realm server the arbiter of a global publisher namespace — first publisher
// of `cardstack/contracts` owned that name for everyone on the box. Qualifying
// the name by a realm gives "who decides what this name means" an answer that
// already exists, with an owner and an ACL, instead of one this server would
// have to invent. See `lib/package-store.ts` for the full argument and for why
// the realm is the STORE ROOT rather than a third segment of the package name.
//
// Authorization stops being something this file does: the bytes sit under the
// realm's prefix, so the realm's own read permission governs them the way it
// governs every other path beneath it.
//
// TWO DOORS, NO CONTENT NEGOTIATION.
//
// `<realm>/_packages/…` is the MODULE door: ask for `index.gts` (or `index`)
// and you get the compiled `index.js` the pack sealed beside it, because a
// consumer at this address is about to evaluate what it receives.
//
// `<realm>/_source/…` is the SOURCE door: exactly the bytes at exactly the
// path, for view-source, diffs and editors.
//
// An earlier pass did this with one URL and an `Accept` header. That works and
// caches badly: a negotiated response needs `Vary: Accept`, `Vary` fragments a
// cache entry per distinct `Accept` string, and clients send wildly different
// ones — so the hottest URLs in the system would cache worst. Worse, omitting
// `Vary` (which the first version did) lets a shared cache hand an editor's
// TypeScript to a browser about to run it as a module: silent, and only
// reproducible once a proxy is in front. Two addresses have neither problem
// and need no header to explain them.
//
// WRITES. There are none here. Publishing goes through
// `lib/package-registry.ts`, which this handler deliberately does not call:
// a GET must never be able to mutate the store, and keeping the gate out of
// reach is cheaper than proving it is never invoked.

import { Readable } from 'node:stream';
import { lookup as lookupMimeType } from 'mime-types';
import type { ResponseWithNodeStream } from '@cardstack/runtime-common';
import {
  executableExtensions,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import {
  readStoreMeta,
  readStoredFile,
  resolveVersionSpec,
} from '@cardstack/deck/node';
import type Koa from 'koa';
import { setContextResponse } from '../middleware/index.ts';
import {
  compressedVariant,
  isCompressible,
  negotiateEncoding,
} from '../lib/package-compression.ts';
import {
  MODULE_DOOR,
  packageStoreForRealm,
  parseRealmPackageDoor,
} from '../lib/package-store.ts';
import {
  findOrMountRealm,
  hasPublicPermissions,
  type RealmRoutingDeps,
} from '../lib/realm-routing.ts';

// A year, which is the ceiling any cache honours, plus `immutable` so a
// reload does not revalidate. Honest here rather than optimistic: an exact
// version cannot ever answer differently, so a shorter max-age would only buy
// round trips whose outcome is known in advance.
const IMMUTABLE_YEAR = 'public, max-age=31536000, immutable';

// The one `Vary` worth having. `Accept-Encoding` takes a handful of real
// values and every CDN normalises it to a canonical set before keying;
// `Accept` — the header §10.1 stopped negotiating on — is unbounded and
// normalised by nobody. Bounded cardinality is the whole difference between a
// `Vary` that works and one that shreds a cache.
const VARY_ENCODING = 'Accept-Encoding';

// One range, or none. `bytes=a-b`, `bytes=a-` and `bytes=-n` (a suffix length)
// are the forms clients actually send; a MULTI-range request is answered as a
// whole body instead, which the spec explicitly allows and which avoids
// building a multipart/byteranges body no real client of this store asks for.
type RangeResult = { start: number; end: number } | 'unsatisfiable' | undefined;

export function parseRange(
  header: string | undefined,
  size: number,
): RangeResult {
  if (!header) {
    return undefined;
  }
  let match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    return undefined;
  }
  let [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') {
    return undefined;
  }
  let start: number;
  let end: number;
  if (rawStart === '') {
    // A SUFFIX range: the last N bytes. Clamped rather than refused, because
    // asking for more tail than exists means "all of it".
    let suffix = Number(rawEnd);
    if (suffix === 0) {
      return 'unsatisfiable';
    }
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (start >= size || start > end) {
    return 'unsatisfiable';
  }
  return { start, end };
}

// What this file IS on the wire.
//
// `mime-types` has never heard of `.gts` or `.gjs`, and its miss returns
// `application/octet-stream` — which a browser downloads instead of showing,
// and which a module loader will not evaluate. Two cases it cannot answer, so
// they are answered here:
//
//   * SOURCE, explicitly asked for: the card-source type, the same one a realm
//     uses, so an editor gets back exactly what it requested rather than a
//     download prompt.
//   * AN AUTHORED FILE SERVED AS A MODULE, which happens when a pack ships
//     `.gts` with no compiled sibling: it is JavaScript to whoever is about to
//     run it, whatever the extension says.
function contentTypeFor(servedPath: string, wantsSource: boolean): string {
  if (wantsSource) {
    return SupportedMimeType.CardSource;
  }
  let known = lookupMimeType(servedPath);
  if (known) {
    return known;
  }
  return AUTHORED_EXTENSIONS.some((ext) => servedPath.endsWith(ext))
    ? 'application/javascript'
    : 'application/octet-stream';
}

// The `.js` a pack would hold for an authored module, or `undefined` when the
// path is not authored source. `.js` itself returns `undefined` deliberately —
// there is nothing to prefer, and returning `x.js` for `x.js` would make the
// lookup below read as if it did something.
const AUTHORED_EXTENSIONS = ['.gts', '.gjs', '.ts'];
function compiledSiblingFor(path: string): string | undefined {
  let extension = AUTHORED_EXTENSIONS.find((ext) => path.endsWith(ext));
  return extension ? `${path.slice(0, -extension.length)}.js` : undefined;
}

export interface ParsedPackagePath {
  name: string;
  spec: string;
  path: string;
}

export type ParseResult =
  | { ok: true; request: ParsedPackagePath }
  | { ok: false; code: string; detail: string };

// Pure, so the grammar can be tested without a server. `rest` is everything
// after the `<realm>/_packages/` prefix, already URL-decoded per segment.
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

// WHICH DOOR. Two addresses, one store per realm, and no content negotiation
// between them — see the header note. `module` compiles-through; `source`
// hands back exactly the bytes at exactly the path named.
export type ServeMode = 'module' | 'source';

export type HandlePackageServeDeps = RealmRoutingDeps & {
  packageStorePath?: string;
};

export default function handlePackageServe(
  args: HandlePackageServeDeps,
): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  let { packageStorePath } = args;
  return async function (ctxt: Koa.Context, next: Koa.Next) {
    // A MIDDLEWARE RATHER THAN A ROUTE, because the realm's path is not a
    // fixed number of segments and only the realm registry knows where it
    // ends. `parseRealmPackageDoor` finds the door marker and hands the part
    // before it to `findOrMountRealm`, which already resolves a realm from any
    // URL beneath it by longest-prefix match — so `/atlas/`, `/user/notes/`
    // and anything else the registry holds all work with no pattern to keep
    // in sync. Anything that is not a door defers untouched.
    // GET AND HEAD, and the HEAD is not a nicety.
    //
    // Two things probe with it. The module loader asks HEAD before importing,
    // to read `last-modified`; and the publish script asks HEAD to find out
    // whether a Version is already in the store. Handling only GET let both
    // fall through to the realm's own router, which answered 200 for an
    // address holding nothing — so `records@9.9.9` "existed", and a publish
    // run reported every new Version as already published and did nothing.
    //
    // A door that answers GET and HEAD differently is not a door with a gap
    // in it; it is a door that lies.
    let door =
      ctxt.method === 'GET' || ctxt.method === 'HEAD'
        ? parseRealmPackageDoor(ctxt.path)
        : undefined;
    if (!door) {
      return next();
    }
    let { realmPath } = door;
    let mode: ServeMode = door.door === MODULE_DOOR ? 'module' : 'source';

    // DECODED PER SEGMENT, which is what the router used to do for a `*rest`
    // param and is not the same as decoding the whole remainder. A version
    // spec arrives percent-encoded — `greeter@%5E2.0.0/index` is a caret range
    // — so skipping this turns a range into a nonexistent literal version;
    // decoding the joined string instead would let an encoded `%2F` invent a
    // path separator that was never in the address.
    let rest = door.rest
      .split('/')
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          // Malformed escape. Left as written rather than throwing: the
          // grammar check below will refuse it with an error a caller can act
          // on, which beats a 500 from the decoder.
          return segment;
        }
      })
      .join('/');

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

    // ─── WHOSE NAMESPACE, AND MAY YOU READ IT ─────────────────────────────
    //
    // Both questions are answered by the same lookup, which is the whole
    // benefit of putting the realm in the URL. There is no sidecar recording
    // which realm published what, because the address says so; and there is no
    // bespoke permission rule, because these bytes are under the realm's
    // prefix and inherit the realm's own read permission.
    let realm = await findOrMountRealm(
      new URL(`${ctxt.origin}${realmPath}`),
      args,
    );
    if (!realm) {
      // Deferred rather than 404-ed: this server has no realm at that prefix,
      // so it has no opinion, and the realm router downstream may still.
      return next();
    }
    let token = ctxt.state.token;
    let mayRead =
      (await hasPublicPermissions(realm, args)) ||
      (token?.permissions ?? []).includes('read');
    if (!mayRead) {
      // NOT 404. The address is real and well-formed, and pretending a package
      // does not exist would send a legitimate consumer chasing a publish that
      // already happened.
      //
      // 401 WHEN THERE IS NO TOKEN, 403 WHEN THERE IS ONE THAT DOES NOT
      // SUFFICE — and the difference is functional, not pedantry. A client
      // that receives 401 knows to authenticate and retry; one that receives
      // 403 knows not to bother. Answering 403 to an anonymous request would
      // therefore lock an authorised consumer out of a private realm's
      // packages permanently, because it would never think to present its
      // credentials. It also matches what the realm's own file routes answer
      // for the same request, which is the point of inheriting their
      // permission in the first place.
      return setContextResponse(
        ctxt,
        errorResponse(
          token ? 403 : 401,
          token ? 'forbidden' : 'unauthorized',
          `packages published by ${realm.url} are readable only by those who ` +
            `may read that realm`,
        ),
      );
    }

    let storeDir = packageStoreForRealm(packageStorePath, realm.url);
    let doorPrefix = `${realmPath.replace(/\/$/, '')}${door.door}`;

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
      let meta = await readStoreMeta(storeDir, name);
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

    let meta = await readStoreMeta(storeDir, name);
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
      let exact = `${doorPrefix}${name}@${resolution.version}/${path}`;
      return setContextResponse(
        ctxt,
        new Response(null, {
          status: 302,
          headers: { location: exact, 'cache-control': 'no-store' },
        }),
      );
    }

    // Authorization already happened, up where the realm was resolved — the
    // realm is in the URL, so there is nothing to look up per package and no
    // sidecar to keep in sync.

    // The sealed record: `treeHash` is the content digest every response
    // below validates with, and `publishedAt` is the clock.
    let record = meta?.versions?.[resolution.version];

    // HTTP-date, from the moment the Version was sealed.
    let publishedAtRaw = record?.publishedAt;
    let publishedAt = publishedAtRaw
      ? new Date(publishedAtRaw).toUTCString()
      : undefined;

    let servedPath = path;
    let bytes: Uint8Array | undefined;

    // ON THE MODULE DOOR, A `.gts` PATH GETS THE COMPILED SIBLING.
    //
    // A pack holds both the authored `.gts` and the `.js` it compiled to,
    // because the transform runs before the seal. Handing raw `.gts` to
    // something about to evaluate it as a module gives that consumer
    // TypeScript, and it dies at the first type annotation — which is exactly
    // how this was found: the indexer recorded a module as `…/index.gts`,
    // fetched it, and stored `Unexpected token (56:12)`, the colon in
    // `const COMMON: {…}[]`. The definition never populated, so a field def
    // published as a package could not be adopted at all.
    //
    // Costs nothing: the compiled artefact is already in the pack, so this is
    // a sibling lookup rather than a transpile.
    //
    // Bytes-as-authored live at their own address, `/_source/…`, so nothing
    // here reads `Accept` — see the two-doors note in the header.
    let wantsSource = mode === 'source';
    let compiled = compiledSiblingFor(path);
    if (!wantsSource && compiled) {
      bytes = await readStoredFile(
        storeDir,
        name,
        resolution.version,
        compiled,
      );
      if (bytes) {
        servedPath = compiled;
      }
    }

    bytes ??= await readStoredFile(storeDir, name, resolution.version, path);
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
          storeDir,
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

    // ─── THE WIRE IS THE CACHE ────────────────────────────────────────────
    //
    // Deck serves without a database, and everything below exists so that
    // stays true all the way to the browser: an exact version is immutable,
    // so the correct cache is the one already built into HTTP and into every
    // proxy in front of it. Nothing here needs invalidating, because nothing
    // here can change.
    //
    // ETAG FROM THE CONTENT DIGEST. The store is content-addressed, so the
    // digest is not computed here — it is read. `treeHash` identifies the
    // Version's whole tree and the path identifies the file within it, so the
    // pair is a strong validator with no hashing on the request path. Two
    // mirrors serving the same Version emit the SAME ETag, which is what lets
    // a shared cache dedupe across them; an mtime- or inode-derived one could
    // not.
    let treeHash = record?.treeHash ?? resolution.version;
    let contentType = contentTypeFor(servedPath, wantsSource);

    // ─── PRECOMPRESSED VARIANT ─────────────────────────────────────────────
    //
    // Derived once per immutable Version and read from disk forever after —
    // see `lib/package-compression.ts` for why the compressed bytes are a
    // CACHE and never part of the seal (compressed output is not reproducible,
    // and a content-addressed digest may not depend on which zlib was linked).
    //
    // This reintroduces a `Vary`, and it is a different animal from the
    // `Vary: Accept` that §10.1 deleted. `Accept-Encoding` has a handful of
    // real values and every CDN normalises it to a canonical set before
    // keying; `Accept` is unbounded and normalised by nobody. Bounded
    // cardinality is the whole difference between a `Vary` that works and one
    // that shreds a cache.
    let encoding = isCompressible(contentType, bytes.byteLength)
      ? negotiateEncoding(ctxt.header['accept-encoding'])
      : undefined;
    if (encoding) {
      let compressed = await compressedVariant(
        storeDir,
        treeHash,
        servedPath,
        encoding,
        bytes,
      );
      if (compressed) {
        bytes = compressed;
      } else {
        // Either it grew or the derivation failed. Serve identity and say so,
        // rather than claiming an encoding the body does not have.
        encoding = undefined;
      }
    }

    // ETAG FROM THE CONTENT DIGEST, PER REPRESENTATION. The digest is read
    // rather than computed — the store is content-addressed — and the encoding
    // is part of the tag because a gzipped body and an identity body are
    // different bytes. A cache keying them together would eventually hand a
    // client a compressed body with no `content-encoding`, which decodes to
    // nothing readable.
    let etag = `"${treeHash}:${servedPath}${encoding ? `:${encoding}` : ''}"`;

    // A conditional request costs a header comparison and saves the body.
    // Worth having even under `immutable`: a cold proxy revalidating a
    // year-old object, and every client that ignores `immutable` on a forced
    // reload, both land here.
    let ifNoneMatch = ctxt.header['if-none-match'];
    if (ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim() === etag)) {
      return setContextResponse(
        ctxt,
        new Response(null, {
          status: 304,
          headers: {
            etag,
            vary: VARY_ENCODING,
            'cache-control': IMMUTABLE_YEAR,
          },
        }),
      );
    }

    // ─── RANGE ─────────────────────────────────────────────────────────────
    //
    // Over the representation actually being sent, which is why this sits
    // AFTER the encoding decision: a range names bytes of the encoded body,
    // and slicing the original then labelling it `content-encoding: br` would
    // hand back an offset into the wrong stream.
    let range = parseRange(ctxt.header.range, bytes.byteLength);
    if (range === 'unsatisfiable') {
      // 416 must state the real length, so a client that guessed can correct
      // itself in one more request instead of probing.
      return setContextResponse(
        ctxt,
        new Response(null, {
          status: 416,
          headers: {
            'content-range': `bytes */${bytes.byteLength}`,
            'accept-ranges': 'bytes',
            etag,
            vary: VARY_ENCODING,
          },
        }),
      );
    }

    // Hand back a Node stream rather than a Response body. `setContextResponse`
    // reads a web-stream body back with `webStreamToText`, which is fine for
    // JS and CSS and silently corrupts everything else — and a package store
    // holds .wasm, fonts and textures alongside the modules. `Readable.from`
    // is given an ARRAY containing the buffer: handed the buffer directly it
    // iterates it as individual bytes.
    // The slice actually sent. Whole body when no range was asked for, which
    // is every module load; a window when something is resuming a large asset.
    let body = range ? bytes.subarray(range.start, range.end + 1) : bytes;

    let response = new Response(null, {
      status: range ? 206 : 200,
      headers: {
        etag,
        // ONLY on the encoding, and only because that header has bounded,
        // CDN-normalised cardinality. Source and module are separate
        // addresses, so nothing here varies on `Accept` — see the two-doors
        // note in the header.
        vary: VARY_ENCODING,
        // Byte ranges, because a package store holds .wasm, fonts and
        // textures next to the modules, and a client resuming a large asset
        // should not restart it. Advertised on every response, including the
        // whole-body ones: it also tells a PROXY that it may serve ranges out
        // of its cached copy, which is where most of the win is.
        'accept-ranges': 'bytes',
        ...(range
          ? {
              'content-range': `bytes ${range.start}-${range.end}/${bytes.byteLength}`,
            }
          : {}),
        ...(encoding ? { 'content-encoding': encoding } : {}),
        // The SERVED path, not the requested one: an extensionless module
        // request resolved to `index.gts`/`index.js` above, and typing it from
        // the bare request would hand a browser `application/octet-stream` for
        // something it is about to evaluate as a module.
        'content-type': contentType,
        // The length of what is being SENT — the slice, and after encoding.
        // The full size lives in `content-range`, which is the only place it
        // belongs on a partial response.
        'content-length': String(body.byteLength),
        // The module loader will not accept a module without one. It probes
        // with `HEAD (accept: card-source)` and stamps the mtime from this
        // header; absent, it refuses the module with "has no last-modified
        // time header", the definition never populates, and every field
        // predicate over a package-hosted type silently matches nothing.
        //
        // `publishedAt` rather than a filesystem mtime, and that is the more
        // correct clock: a Version is sealed once and is immutable
        // thereafter, so its publish time is identical on every mirror
        // serving that pack, while an mtime records when THIS disk happened
        // to receive it and would differ per replica.
        ...(publishedAt ? { 'last-modified': publishedAt } : {}),
        // An exact version is immutable by construction (Deck L4) — the
        // registry gate refuses to republish one with different bytes, so
        // this promise is enforced rather than hoped for. A YEAR is the
        // maximum any cache will honour, and it is the honest number here:
        // this URL will never say anything different, so a shorter one would
        // only buy revalidations that can never change the answer.
        'cache-control': IMMUTABLE_YEAR,
        // Modules are loaded cross-origin here — the host and the realm
        // server are different origins — and a resource with no CORP header
        // is blocked outright under cross-origin isolation. Declared rather
        // than left to a proxy, because the store is meant to be servable
        // from a bare filesystem or an S3 bucket with nothing clever in
        // front.
        'cross-origin-resource-policy': 'cross-origin',
      },
    }) as ResponseWithNodeStream;
    response.nodeStream = Readable.from([body]);
    return setContextResponse(ctxt, response);
  };
}
