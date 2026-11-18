// A path specifier names a set of paths in a realm: a list of prefixes, and
// a path is in the set when it falls under any of them.
//
//   `blog/`             the directory `blog` and everything in it
//   `blog/post-1.json`  that one file
//   `/`                 the whole realm
//
// A prefix is literal. Nothing in it is evaluated, and it reads nothing about
// the caller, a target or the realm's settings, so what a specifier covers can
// be read from the specifier alone. `*` and `:` are refused as written, which
// keeps them free for a pattern form that wouldn't change what any existing
// specifier means. A pattern form reads a prefix as written, never its decoded
// segments, so their escapes `%2A` and `%3A` stay a literal `*` and `:`.
//
// A prefix is relative to the root of the realm it is applied to. A leading
// `/` is optional, and a trailing `/` makes it a directory. Its
// percent-escapes are decoded once, as `decodeURI` decodes them, so a prefix
// names the path that a URL spelled the same way resolves to: `%20` is a
// space, and the escapes of URL delimiters such as `%2F` and `%3F` stay
// encoded, as they are in a path `RealmPaths.local` resolves. The exception is
// `%3A`, which decodes to `:`. A realm stores a `:` in a file name as is
// (`notes re: budget.m4a`), and `:` as written is reserved, so `%3A` is how a
// prefix names it, as `%2A` names a `*`. `%2E%2E` is `..`, and is refused like
// `..`.
//
// Matching compares decoded segments one at a time, case-sensitively and with
// no Unicode normalization, against a path as `RealmPaths.local` resolves it.
// It is linear in the lengths of the path and the prefixes, and no authored
// string is ever compiled into a regular expression. `blog/` never matches
// `blog-old/` or `blog.json`.

export interface PathPrefix {
  // The prefix as written.
  source: string;
  // The decoded segments, from the realm's root. Empty for the whole realm.
  segments: readonly string[];
  // True for a directory, which covers itself and everything in it. False
  // for a single file.
  directory: boolean;
  // The decoded realm-relative path: `blog/drafts/` for a directory,
  // `blog/post-1.json` for a file, and `''` for the whole realm. Search and
  // history lower a prefix from this rather than from `source`, and must
  // match it literally: it can hold `%`, `_`, `*`, `:`, `[` and `]`. An SQL
  // lowering escapes `LIKE`'s `%`, `_` and `\` and compares against the form
  // the index stores a path in; a `git` lowering passes literal pathspecs.
  path: string;
}

export interface PathSpecifier {
  // An empty list means no path limit: the specifier covers every path.
  prefixes: readonly PathPrefix[];
}

export type PathPrefixErrorCode =
  // `''`. The whole realm is written `/`.
  | 'empty-prefix'
  // Whitespace at the start or end of the prefix as a whole.
  | 'surrounding-whitespace'
  // `//` inside the prefix.
  | 'empty-segment'
  // A `.` or `..` segment, as written or percent-encoded.
  | 'dot-segment'
  // `*` or `:` as written, which are reserved for a pattern form.
  | 'reserved-character'
  // A backslash (as written or percent-encoded), `?`, `#`, a control
  // character, or a lone UTF-16 surrogate.
  | 'invalid-character'
  // A `%` that doesn't start a valid escape.
  | 'invalid-escape';

export interface PathPrefixError {
  code: PathPrefixErrorCode;
  // A sentence a policy's issue list, explain or an editor can show as is.
  message: string;
  // The prefix as written.
  source: string;
  // The offending segment, counted from the realm's root, when there is one.
  segmentIndex?: number;
}

export interface PathSpecifierError extends PathPrefixError {
  // The position of the offending prefix in the specifier's list.
  prefixIndex: number;
}

export type ParsePathPrefixResult =
  | { ok: true; prefix: PathPrefix }
  | { ok: false; error: PathPrefixError };

export type ParsePathSpecifierResult =
  | { ok: true; specifier: PathSpecifier }
  | { ok: false; errors: readonly PathSpecifierError[] };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const ESCAPED_COLON = /%3A/i;

/**
 * Parses one prefix of a path specifier, such as `blog/`, `/blog/post-1.json`
 * or `/`.
 *
 * Returns a structured error for an invalid prefix; it never throws.
 */
export function parsePathPrefix(source: string): ParsePathPrefixResult {
  if (source === '') {
    return fail(
      source,
      'empty-prefix',
      'A path prefix can\'t be empty. Write "/" for the whole realm.',
    );
  }
  if (source.trim() !== source) {
    return fail(
      source,
      'surrounding-whitespace',
      `Path prefix "${source}" starts or ends with whitespace.`,
    );
  }
  let rest = source.startsWith('/') ? source.slice(1) : source;
  if (rest === '') {
    return {
      ok: true,
      prefix: { source, segments: [], directory: true, path: '' },
    };
  }
  let directory = rest.endsWith('/');
  if (directory) {
    rest = rest.slice(0, -1);
  }
  let segments: string[] = [];
  let rawSegments = rest.split('/');
  for (let [segmentIndex, raw] of rawSegments.entries()) {
    let decoded = parseSegment(source, raw, segmentIndex);
    if (typeof decoded !== 'string') {
      return { ok: false, error: decoded };
    }
    segments.push(decoded);
  }
  return {
    ok: true,
    prefix: {
      source,
      segments,
      directory,
      path: segments.join('/') + (directory ? '/' : ''),
    },
  };
}

/**
 * Parses a path specifier from its prefixes as written.
 *
 * Every invalid prefix is reported, each with its position in the list. One
 * invalid prefix makes the whole specifier invalid: leaving out only the bad
 * ones could leave an empty list, which means no path limit. An empty list
 * is valid, and means no path limit.
 */
export function parsePathSpecifier(
  sources: readonly string[],
): ParsePathSpecifierResult {
  let prefixes: PathPrefix[] = [];
  let errors: PathSpecifierError[] = [];
  for (let [prefixIndex, source] of sources.entries()) {
    let result = parsePathPrefix(source);
    if (result.ok) {
      prefixes.push(result.prefix);
    } else {
      errors.push({ ...result.error, prefixIndex });
    }
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, specifier: { prefixes } };
}

// Whether a path names a file or a directory. A resolved path can't say:
// `RealmPaths.local` strips a directory's trailing slash, so `blog/` and a
// file named `blog` resolve alike.
export type PathKind = 'file' | 'directory';

/**
 * Whether the file or directory at `path` falls under any prefix of
 * `specifier`. A specifier with no prefixes has no path limit, so it matches
 * every path.
 *
 * `path` is a path in the realm as `RealmPaths.local` resolves it, relative
 * to the realm's root. A leading or trailing `/` is ignored, and `''` is the
 * realm's root, which is a directory. `kind` says what `path` names: a
 * directory prefix covers that directory and everything in it, but not a
 * file of the same name, and a file prefix covers only that file. A path
 * with an empty, `.` or `..` segment matches nothing, and so does the root
 * named as a file.
 */
export function pathSpecifierMatches(
  specifier: PathSpecifier,
  path: string,
  kind: PathKind,
): boolean {
  if (specifier.prefixes.length === 0) {
    return true;
  }
  let target = splitPath(path, kind);
  if (!target) {
    return false;
  }
  return specifier.prefixes.some((prefix) => prefixCovers(prefix, target));
}

/**
 * Whether the file or directory at `path` falls under `prefix`. `path` and
 * `kind` are read as `pathSpecifierMatches` reads them.
 */
export function pathPrefixMatches(
  prefix: PathPrefix,
  path: string,
  kind: PathKind,
): boolean {
  let target = splitPath(path, kind);
  return target ? prefixCovers(prefix, target) : false;
}

interface SplitPath {
  segments: readonly string[];
  directory: boolean;
}

function prefixCovers(prefix: PathPrefix, target: SplitPath): boolean {
  let length = prefix.segments.length;
  if (prefix.directory) {
    // A directory covers itself and everything in it, but not a file of the
    // same name.
    if (
      target.segments.length < length ||
      (target.segments.length === length && !target.directory)
    ) {
      return false;
    }
  } else if (target.directory || target.segments.length !== length) {
    return false;
  }
  for (let i = 0; i < length; i++) {
    if (target.segments[i] !== prefix.segments[i]) {
      return false;
    }
  }
  return true;
}

function splitPath(path: string, kind: PathKind): SplitPath | undefined {
  let rest = path.startsWith('/') ? path.slice(1) : path;
  if (rest.endsWith('/')) {
    rest = rest.slice(0, -1);
  }
  let directory = kind === 'directory';
  if (rest === '') {
    return directory ? { segments: [], directory } : undefined;
  }
  let segments = rest.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    return undefined;
  }
  return { segments, directory };
}

// Validates one segment as written, decodes it, and validates the decoded
// value. Returns the decoded segment, or the error.
function parseSegment(
  source: string,
  raw: string,
  segmentIndex: number,
): string | PathPrefixError {
  let error = (code: PathPrefixErrorCode, message: string) =>
    failure(source, code, message, segmentIndex);
  if (raw === '') {
    return error(
      'empty-segment',
      `Path prefix "${source}" has an empty segment (//).`,
    );
  }
  if (raw.includes('*') || raw.includes(':')) {
    return error(
      'reserved-character',
      `Path prefix "${source}" uses * or :, which are reserved for path patterns. Write %2A for a literal * and %3A for a literal :.`,
    );
  }
  if (raw.includes('?') || raw.includes('#')) {
    return error(
      'invalid-character',
      `Path prefix "${source}" has ? or #. A path prefix names a path, not a URL with a query or fragment.`,
    );
  }
  if (LONE_SURROGATE.test(raw)) {
    return error(
      'invalid-character',
      `Path prefix "${source}" isn't valid Unicode.`,
    );
  }
  let decoded: string;
  try {
    // `decodeURI` keeps `%3A` encoded, so it is decoded here, in the same
    // pass. Each `%` in a valid segment starts an escape, so `%3A` is only
    // ever a whole escape, and `%253A` still decodes to `%3A`.
    decoded = raw
      .split(ESCAPED_COLON)
      .map((part) => decodeURI(part))
      .join(':');
  } catch {
    return error(
      'invalid-escape',
      `Path prefix "${source}" has a % that doesn't start a valid escape. Write %25 for a literal %.`,
    );
  }
  if (decoded.includes('\\')) {
    return error(
      'invalid-character',
      `Path prefix "${source}" has a backslash, which can't appear in a realm path.`,
    );
  }
  if (CONTROL_CHARACTER.test(decoded)) {
    return error(
      'invalid-character',
      `Path prefix "${source}" has a control character.`,
    );
  }
  if (decoded === '.' || decoded === '..') {
    return error(
      'dot-segment',
      `Path prefix "${source}" has a . or .. segment. A prefix names a path inside the realm, from its root.`,
    );
  }
  return decoded;
}

function failure(
  source: string,
  code: PathPrefixErrorCode,
  message: string,
  segmentIndex?: number,
): PathPrefixError {
  return {
    code,
    message,
    source,
    ...(segmentIndex === undefined ? {} : { segmentIndex }),
  };
}

function fail(
  source: string,
  code: PathPrefixErrorCode,
  message: string,
): { ok: false; error: PathPrefixError } {
  return { ok: false, error: failure(source, code, message) };
}
