import type {
  RealmIdentifier,
  RealmResourceIdentifier,
} from './realm-identifiers.ts';

interface LocalOptions {
  preserveQuerystring?: boolean;
}

// Structural subset of VirtualNetwork that RealmPaths needs. Declared
// locally so paths.ts doesn't take a direct import edge on virtual-network
// (which would transitively pull base-realm URL imports into consumers
// that only need URL-handling, like @cardstack/boxel-cli).
interface RealmPathsVirtualNetwork {
  toURL(rri: string): URL;
  toURLHref(rri: string): string;
}

export class RealmPaths {
  readonly url: string;
  // `url` without its trailing slash. `inRealm` compares against this on
  // every call and is hot enough to show up in a CPU profile of the test
  // suite, so it is computed once here rather than per call.
  private urlWithoutTrailingSlash: string;
  private virtualNetwork: RealmPathsVirtualNetwork | undefined;

  constructor(realmURL: URL, virtualNetwork?: RealmPathsVirtualNetwork);
  constructor(
    realmId: RealmIdentifier,
    virtualNetwork?: RealmPathsVirtualNetwork,
  );
  constructor(
    realmURLOrId: URL | RealmIdentifier,
    virtualNetwork?: RealmPathsVirtualNetwork,
  ) {
    if (realmURLOrId instanceof URL) {
      this.url = ensureTrailingSlash(decodeURI(realmURLOrId.href));
    } else {
      this.url = ensureTrailingSlash(realmURLOrId);
    }
    this.urlWithoutTrailingSlash = this.url.replace(/\/$/, '');
    this.virtualNetwork = virtualNetwork;
  }

  get realmId(): RealmIdentifier {
    return this.url as RealmIdentifier;
  }

  private get isURLBased(): boolean {
    return this.url.startsWith('http://') || this.url.startsWith('https://');
  }

  private assertURLBased(method: string): void {
    if (!this.isURLBased) {
      throw new Error(
        `${method}() requires a URL-based RealmPaths, but this instance was constructed from a scoped RealmIdentifier ("${this.url}"). Use the RRI-aware methods instead (e.g. fileRRI, directoryRRI, localFromRRI, inRealmRRI).`,
      );
    }
  }

  local(
    input: RealmResourceIdentifier | URL,
    opts: LocalOptions = {},
  ): LocalPath {
    if (input instanceof URL) {
      this.assertURLBased('local');
      if (!this.inRealm(input)) {
        let error = new Error(
          `realm ${this.url} does not contain ${input.href}`,
        );
        (error as any).status = 404;
        throw error;
      }

      if (opts.preserveQuerystring !== true) {
        // strip query params
        input = new URL(decodeURI(input.pathname), input);
      }

      // this will always remove a leading slash because our constructor ensures
      // this.#realm has a trailing slash.
      let local = decodeURI(input.href).slice(this.url.length);

      // this will remove any trailing slashes
      local = local.replace(/\/+$/, '');

      // the LocalPath has no leading nor trailing slashes
      return local;
    }
    if (!this.inRealm(input)) {
      let error = new Error(`realm ${this.url} does not contain ${input}`);
      (error as any).status = 404;
      throw error;
    }
    let local = decodeURI(input).slice(this.url.length);
    return local.replace(/\/+$/, '');
  }

  fileURL(local: LocalPath): URL {
    this.assertURLBased('fileURL');
    return new URL(local, this.url);
  }

  directoryURL(local: LocalPath): URL {
    this.assertURLBased('directoryURL');
    if (local === '') {
      // this preserves a root that is not at the origin of the URL
      return new URL(this.url);
    }
    return new URL(local + '/', this.url);
  }

  inRealm(input: RealmResourceIdentifier | URL): boolean {
    let inputStr = input instanceof URL ? input.href : input;
    let decoded: string;
    try {
      decoded = decodeUriIfNeeded(inputStr);
    } catch {
      return false;
    }
    // Same-form fast path: both sides URL or both prefix.
    if (
      decoded.startsWith(this.url) ||
      // realm root with missing trailing slash, optionally with query string
      beforeQuery(decoded) === this.urlWithoutTrailingSlash
    ) {
      return true;
    }
    // Cross-form: needs a VirtualNetwork to normalize prefix-form ↔ URL-form.
    // Without one, this RealmPaths only resolves same-form membership.
    if (!this.virtualNetwork) {
      return false;
    }
    let realmURL: string;
    let inputURL: string;
    try {
      realmURL = this.virtualNetwork.toURLHref(this.url);
      inputURL = this.virtualNetwork.toURLHref(inputStr);
    } catch {
      return false;
    }
    let decodedURL: string;
    try {
      decodedURL = decodeUriIfNeeded(inputURL);
    } catch {
      return false;
    }
    return (
      decodedURL.startsWith(realmURL) ||
      beforeQuery(decodedURL) === realmURL.replace(/\/$/, '')
    );
  }

  fileRRI(local: LocalPath): RealmResourceIdentifier {
    if (this.isURLBased) {
      return new URL(local, this.url).href as RealmResourceIdentifier;
    }
    return (this.url + local) as RealmResourceIdentifier;
  }

  directoryRRI(local: LocalPath): RealmResourceIdentifier {
    if (local === '') {
      return this.url as RealmResourceIdentifier;
    }
    if (this.isURLBased) {
      return new URL(local + '/', this.url).href as RealmResourceIdentifier;
    }
    return (this.url + local + '/') as RealmResourceIdentifier;
  }
}

export function join(...pathParts: string[]): LocalPath {
  return pathParts
    .map((p) => p.replace(/^\//, '').replace(/\/$/, ''))
    .filter(Boolean)
    .join('/');
}

export function ensureTrailingSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`;
}

// `decodeURI` only rewrites percent-escapes, so a string without a '%' is
// returned unchanged — and it can only throw on a malformed escape, which
// likewise requires one. Skipping the call for the common case keeps
// `inRealm` off `decodeURI` entirely for ordinary ids; it is hot enough for
// that to be visible in a CPU profile of the test suite.
function decodeUriIfNeeded(value: string): string {
  return value.includes('%') ? decodeURI(value) : value;
}

// `s.split('?')[0]` allocates an array (and every subsequent segment) just to
// read the part before the query string.
function beforeQuery(value: string): string {
  let queryStart = value.indexOf('?');
  return queryStart === -1 ? value : value.slice(0, queryStart);
}

// Documenting that this represents a local path within realm, with no leading
// slashes or dots and no trailing slash. Example:
//
//    in realm http://example.com/my-realm/ url
//    http://example.com/my-realm/hello/world/ maps to local path "hello/world"
//
export type LocalPath = string;

// Characters that a file name cannot survive a trip through this module with.
// `fileURL` builds the URL with `new URL(name, realmURL)` and `local` recovers
// the path with `decodeURI`, and that pair mangles each of these:
//
//   #   opens a fragment, so "Standup #3.m4a" is written as "Standup"
//   ?   opens a query, which `local` strips, so "notes?.m4a" becomes "notes"
//   \   is normalized to "/", silently turning the name into a directory
//   /   is a path separator, so a name would gain a directory it didn't ask for
//   %   either mis-decodes ("a%20b" comes back as "a b") or, on an escape that
//       isn't valid hex, makes `decodeURI` throw URIError
//
// Tab, newline, and carriage return are dropped outright by the URL parser
// wherever they appear, so they are handled alongside the punctuation.
//
// Losing the extension this way is the damage that carries: every layer
// re-derives a file's content type from its name (see `inferContentType`), so a
// truncated name reads as application/octet-stream and an uploaded recording
// stops being audio.
const UNSAFE_FILE_NAME_CHARS = /[#?\\/%\t\n\r]+/g;

// Inside the extension the same characters are cut from rather than replaced,
// taking the rest of the name with them. Substituting for them would seat a
// suffix past the extension, turning "recording.m4a#" into "recording.m4a-"
// and "image.png?v=2" into "image.png-v=2"; an unrecognized ".m4a-" or
// ".png-v=2" is exactly the content-type loss this function exists to prevent,
// so the extension is cut back to the part that survives instead. Cutting is
// also what the URL parser does to a `#` or `?` and everything after it, which
// is why nothing of value is thrown away here.
const EXTENSION_TAIL_FROM_UNSAFE = /[#?\\/%\t\n\r].*$/;

// The URL parser strips leading and trailing C0 controls and spaces from its
// input, so a name cannot keep them. Other Unicode whitespace — U+00A0 and
// friends — the parser preserves, so those are left alone rather than trimmed
// off a name that would have kept them. The control characters in this range
// are the whole point of it, so the lint that guards against writing one into
// a pattern by accident does not apply.
// eslint-disable-next-line no-control-regex
const URL_STRIPPED_EDGES = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g;

// A name whose first segment reads as a URL scheme — "notes:draft.txt",
// "http:foo.txt" — is read by `new URL(name, realmURL)` as a scheme rather than
// as a path inside the realm. Which way that fails depends on the realm's own
// scheme: a different one ("notes:", or "http:" under an https realm) resolves
// to an absolute URL somewhere else entirely, while a matching one is treated
// as a relative reference and silently drops the prefix, so "http:foo.txt"
// under an http realm is written as "foo.txt". A colon anywhere else is
// ordinary and common ("notes re: budget.m4a"), so only the scheme position is
// neutralized.
const SCHEME_PREFIX = /^([A-Za-z][A-Za-z0-9+.-]*):/;

// Make a single file name safe to hand to `fileURL`, so that the local path the
// realm stores is the name the caller intended and keeps the extension the
// caller gave it. Takes a bare name, never a path — `/` is replaced rather than
// preserved, so a caller assembling something like `skills/<slug>/SKILL.md`
// sanitizes the segments and joins them afterward.
export function toSafeFileName(name: string): string {
  let trimmed = name.replace(URL_STRIPPED_EDGES, '');
  // A leading dot marks a dotfile rather than an extension, so the split only
  // counts a dot with something in front of it.
  let dot = trimmed.lastIndexOf('.');
  let stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  let extension = dot > 0 ? trimmed.slice(dot) : '';
  let safe =
    stem.replace(UNSAFE_FILE_NAME_CHARS, '-') +
    extension.replace(EXTENSION_TAIL_FROM_UNSAFE, '');
  safe = safe.replace(URL_STRIPPED_EDGES, '');
  // Replacing the colon can expose another scheme behind it, because `-` is
  // itself legal in a scheme: one pass over "x:y:z.txt" yields "x-y:z.txt",
  // which `new URL` still reads as scheme "x-y". Each pass removes one colon,
  // so this settles.
  while (SCHEME_PREFIX.test(safe)) {
    safe = safe.replace(SCHEME_PREFIX, '$1-');
  }
  // "" resolves to the containing directory and "."/".." to a directory
  // traversal, none of which name a file.
  return safe === '' || safe === '.' || safe === '..' ? '-' : safe;
}

const MARKDOWN_FILE_EXTENSION = /\.(md|markdown)$/i;

// True when the id/URL names a markdown file (`.md` / `.markdown`). Matches
// on the URL pathname so a querystring or fragment can't confuse the test; a
// value that isn't a parseable URL (e.g. a bare local path) is tested as-is.
// The one definition of "is a markdown file" — markdown ids dispatch to
// file-meta reads (host skill loading, ai-bot readRealmFile) rather than
// card/raw-source reads.
export function isMarkdownFile(id: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(id).pathname;
  } catch {
    pathname = id;
  }
  return MARKDOWN_FILE_EXTENSION.test(pathname);
}
