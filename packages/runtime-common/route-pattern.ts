// Route path patterns (`/posts/:slug`) and card id patterns
// (`./Person/:person_id`) for dynamic host routes.
//
// A pattern is a list of segments, each a literal or a `:name` parameter.
// It is parsed once into a structured form, and every operation after
// that walks the segments one by one: matching is linear in the lengths
// of the path and the pattern, and no authored string is ever compiled
// into a regular expression. There are no wildcards, catch-alls or
// optional segments: a `:name` segment matches exactly one non-empty
// path segment.
//
// One canonical percent-encoding makes filling and matching inverses:
// a filled segment encodes every character except the RFC 3986
// unreserved ones (`A-Z a-z 0-9 - . _ ~`), with upper-case hex digits,
// and a matched segment is percent-decoded. So `fill(match(x)) === x`
// for a canonically encoded `x`, and `match(fill(v)) === v` for any
// value `fill` accepts.

export interface RoutePatternLiteralSegment {
  kind: 'literal';
  // The decoded literal. A request segment matches it when the request
  // segment, decoded, is equal to it.
  value: string;
}

export interface RoutePatternParamSegment {
  kind: 'param';
  name: string;
}

export type RoutePatternSegment =
  | RoutePatternLiteralSegment
  | RoutePatternParamSegment;

interface ParsedPattern {
  // The pattern as authored.
  source: string;
  segments: readonly RoutePatternSegment[];
  // The parameter names, in the order they appear.
  paramNames: readonly string[];
}

// A request path pattern, written from the realm's root: `/posts/:slug`.
export interface RoutePathPattern extends ParsedPattern {
  kind: 'path';
}

// A card id pattern, written relative to the realm: `./Person/:person_id`.
export interface CardIdPattern extends ParsedPattern {
  kind: 'card-id';
}

export type RoutePatternErrorCode =
  // A path pattern that doesn't start with `/`, or a card id pattern
  // that doesn't start with `./`.
  | 'invalid-start'
  // `//` inside the pattern, or a card id pattern that is only `./`.
  | 'empty-segment'
  // A segment that is just `:`.
  | 'empty-param-name'
  // A `:name` whose name is not letters, digits and `_`, starting with
  // a letter or `_`.
  | 'invalid-param-name'
  // A name used twice in the pattern, or already used by a parent route.
  | 'duplicate-param-name'
  // A `:` anywhere but the start of a segment.
  | 'misplaced-colon'
  // A literal with a character outside the unreserved set and `%XX`, a
  // malformed `%XX`, or a literal `.` or `..` segment.
  | 'invalid-literal';

export interface RoutePatternError {
  code: RoutePatternErrorCode;
  // A human-readable warning a route validator can show as is.
  message: string;
  // The index of the offending segment, when there is one.
  segmentIndex?: number;
  // The offending parameter name, for the name errors.
  name?: string;
}

export type ParseRoutePatternResult<P> =
  | { ok: true; pattern: P }
  | { ok: false; error: RoutePatternError };

export interface ParseRoutePatternOptions {
  // Names already used by the route's parents. A child route's names
  // must be unique including its parents' names, so a name in this set
  // is reported as `duplicate-param-name`.
  usedNames?: Iterable<string>;
}

// Parameter values by name. Values are decoded strings.
export type RouteParams = Record<string, string>;

export interface SegmentMatch {
  params: RouteParams;
  // The index of the first request segment after the matched ones.
  end: number;
}

const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VALID_LITERAL = /^(?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+$/;
const UNRESERVED = /[A-Za-z0-9._~-]/;

/**
 * Parses a request path pattern such as `/posts/:slug` or `/c/:category`.
 *
 * The pattern starts with `/`. `/` alone has no segments. A single
 * trailing slash is ignored, the same way `splitRequestPath` ignores it,
 * so `/posts/:slug/` parses as `/posts/:slug`.
 *
 * Returns a structured error for an invalid pattern; it never throws.
 */
export function parseRoutePathPattern(
  source: string,
  options: ParseRoutePatternOptions = {},
): ParseRoutePatternResult<RoutePathPattern> {
  if (!source.startsWith('/')) {
    return fail('invalid-start', 'Route path must start with /');
  }
  let result = parseSegments(stripTrailingSlash(source.slice(1)), options);
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    pattern: { kind: 'path', source, ...result.parsed },
  };
}

/**
 * Parses a card id pattern such as `./Person/:person_id`.
 *
 * Anchoring: a card id pattern is relative to the realm and is written
 * with a leading `./`. It describes the whole card id below the realm
 * URL: it is anchored at the realm's root and at the end of the id, and
 * never matches a prefix or a suffix of an id. `../`, `/` and absolute
 * URLs are rejected, so a pattern can only name cards in its own realm.
 * A card id has no `.json` extension, so the pattern has none either.
 *
 * Returns a structured error for an invalid pattern; it never throws.
 */
export function parseCardIdPattern(
  source: string,
  options: ParseRoutePatternOptions = {},
): ParseRoutePatternResult<CardIdPattern> {
  if (!source.startsWith('./')) {
    return fail('invalid-start', 'Card id pattern must start with ./');
  }
  let rest = source.slice(2);
  if (rest === '') {
    return fail('empty-segment', 'Card id pattern must name a card after ./');
  }
  let result = parseSegments(rest, options);
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    pattern: { kind: 'card-id', source, ...result.parsed },
  };
}

/**
 * Splits a request pathname into decoded segments.
 *
 * `/` gives no segments. A single trailing slash is ignored, so
 * `/posts/a/` gives the same segments as `/posts/a`; redirecting to the
 * canonical form is the caller's job. Returns `undefined` for a path
 * that doesn't start with `/`, that has an empty segment (`/a//b`), or
 * that has a malformed percent-encoding, so such a path matches nothing.
 *
 * The path is a pathname: strip the query string and fragment first.
 */
export function splitRequestPath(path: string): string[] | undefined {
  if (!path.startsWith('/')) {
    return undefined;
  }
  return splitAndDecode(stripTrailingSlash(path.slice(1)));
}

/**
 * Matches a whole request path against a path pattern. Returns the
 * decoded parameter values, or `undefined` when the path doesn't match.
 */
export function matchRoutePathPattern(
  pattern: RoutePathPattern,
  path: string,
): RouteParams | undefined {
  let segments = splitRequestPath(path);
  if (!segments) {
    return undefined;
  }
  let match = matchPatternSegments(pattern, segments);
  return match && match.end === segments.length ? match.params : undefined;
}

/**
 * Matches a pattern against decoded request segments (from
 * `splitRequestPath`), starting at `offset`. The pattern must match the
 * segments from `offset` onwards, but it may stop before the last one:
 * `end` says where the match stopped, so a parent route can match a
 * prefix and a child route can go on from `end`. A whole-path match is
 * one whose `end` is `segments.length`.
 */
export function matchPatternSegments(
  pattern: RoutePathPattern | CardIdPattern,
  segments: readonly string[],
  offset = 0,
): SegmentMatch | undefined {
  if (offset < 0 || offset + pattern.segments.length > segments.length) {
    return undefined;
  }
  let params: RouteParams = {};
  for (let i = 0; i < pattern.segments.length; i++) {
    let patternSegment = pattern.segments[i]!;
    let value = segments[offset + i]!;
    if (patternSegment.kind === 'literal') {
      if (value !== patternSegment.value) {
        return undefined;
      }
    } else {
      if (!isValidParamValue(value)) {
        return undefined;
      }
      params[patternSegment.name] = value;
    }
  }
  return { params, end: offset + pattern.segments.length };
}

/**
 * Fills a path pattern from parameter values and returns the path, each
 * value percent-encoded with the canonical encoding. Names the pattern
 * doesn't use are ignored. Returns `undefined` when a value is missing,
 * empty, `.` or `..` (which a URL parser would treat as a relative
 * step, not a segment).
 */
export function fillRoutePathPattern(
  pattern: RoutePathPattern,
  params: RouteParams,
): string | undefined {
  let segments = fillSegments(pattern, params);
  return segments === undefined ? undefined : '/' + segments.join('/');
}

/**
 * Fills a card id pattern from parameter values and returns the card
 * id: the realm URL followed by the filled segments, each value
 * percent-encoded with the canonical encoding. `realmURL` must end with
 * `/`. Returns `undefined` under the same conditions as
 * `fillRoutePathPattern`.
 */
export function fillCardIdPattern(
  pattern: CardIdPattern,
  params: RouteParams,
  realmURL: string,
): string | undefined {
  if (!realmURL.endsWith('/')) {
    return undefined;
  }
  let segments = fillSegments(pattern, params);
  return segments === undefined ? undefined : realmURL + segments.join('/');
}

/**
 * Matches a card id against a card id pattern, the reverse of
 * `fillCardIdPattern`, and returns the decoded parameter values.
 *
 * The card id must start with `realmURL` (which ends with `/`), and the
 * rest of it must match the pattern as a whole (see
 * `parseCardIdPattern` for the anchoring). An id that doesn't fit is no
 * match: one in another realm, one with a query or fragment, one with
 * more or fewer segments than the pattern (a value never spans two
 * segments), or one whose segments differ from the literals.
 */
export function matchCardIdPattern(
  pattern: CardIdPattern,
  cardId: string,
  realmURL: string,
): RouteParams | undefined {
  if (!realmURL.endsWith('/') || !cardId.startsWith(realmURL)) {
    return undefined;
  }
  let rest = cardId.slice(realmURL.length);
  if (rest.includes('?') || rest.includes('#')) {
    return undefined;
  }
  let segments = splitAndDecode(rest);
  if (!segments) {
    return undefined;
  }
  let match = matchPatternSegments(pattern, segments);
  return match && match.end === segments.length ? match.params : undefined;
}

/**
 * Percent-encodes one segment value with the canonical encoding: every
 * UTF-8 byte outside the RFC 3986 unreserved set (`A-Z a-z 0-9 - . _ ~`)
 * becomes `%XX` with upper-case hex digits. Unlike `encodeURIComponent`,
 * it also encodes `! ' ( ) *`, so the result passes the host routing
 * path validator. Throws a `URIError` for a string with a lone UTF-16
 * surrogate, which has no UTF-8 encoding.
 */
export function encodeRouteSegment(value: string): string {
  let out = '';
  for (let char of value) {
    if (UNRESERVED.test(char)) {
      out += char;
    } else {
      // encodeURIComponent gives upper-case hex for everything it
      // encodes; the five it leaves alone are all ASCII.
      let encoded = encodeURIComponent(char);
      out +=
        encoded === char
          ? '%' + char.charCodeAt(0).toString(16).toUpperCase()
          : encoded;
    }
  }
  return out;
}

function parseSegments(
  rest: string,
  options: ParseRoutePatternOptions,
):
  | {
      ok: true;
      parsed: { segments: RoutePatternSegment[]; paramNames: string[] };
    }
  | { ok: false; error: RoutePatternError } {
  let usedNames = new Set(options.usedNames ?? []);
  let segments: RoutePatternSegment[] = [];
  let paramNames: string[] = [];
  let rawSegments = rest === '' ? [] : rest.split('/');
  for (let [index, raw] of rawSegments.entries()) {
    if (raw === '') {
      return fail('empty-segment', 'Route pattern has an empty segment', {
        segmentIndex: index,
      });
    }
    if (raw.startsWith(':')) {
      let name = raw.slice(1);
      if (name === '') {
        return fail('empty-param-name', 'A : must be followed by a name', {
          segmentIndex: index,
        });
      }
      if (name.includes(':')) {
        return fail(
          'misplaced-colon',
          'A : may only appear at the start of a segment',
          { segmentIndex: index },
        );
      }
      if (!PARAM_NAME.test(name)) {
        return fail(
          'invalid-param-name',
          `Segment name "${name}" may only contain letters, numbers and _, and must not start with a number`,
          { segmentIndex: index, name },
        );
      }
      if (usedNames.has(name)) {
        return fail(
          'duplicate-param-name',
          `Segment name "${name}" is used more than once`,
          { segmentIndex: index, name },
        );
      }
      usedNames.add(name);
      paramNames.push(name);
      segments.push({ kind: 'param', name });
      continue;
    }
    if (raw.includes(':')) {
      return fail(
        'misplaced-colon',
        'A : may only appear at the start of a segment',
        { segmentIndex: index },
      );
    }
    let value = VALID_LITERAL.test(raw) ? safeDecode(raw) : undefined;
    if (value === undefined || value === '.' || value === '..') {
      return fail(
        'invalid-literal',
        'Route pattern segments may only contain letters, numbers, -, _, ., ~, or %XX-encoded characters, and may not be . or ..',
        { segmentIndex: index },
      );
    }
    segments.push({ kind: 'literal', value });
  }
  return { ok: true, parsed: { segments, paramNames } };
}

function fillSegments(
  pattern: RoutePathPattern | CardIdPattern,
  params: RouteParams,
): string[] | undefined {
  let out: string[] = [];
  for (let segment of pattern.segments) {
    if (segment.kind === 'literal') {
      out.push(encodeRouteSegment(segment.value));
      continue;
    }
    let value = Object.prototype.hasOwnProperty.call(params, segment.name)
      ? params[segment.name]
      : undefined;
    if (typeof value !== 'string' || !isValidParamValue(value)) {
      return undefined;
    }
    try {
      out.push(encodeRouteSegment(value));
    } catch {
      // A lone UTF-16 surrogate has no UTF-8 encoding.
      return undefined;
    }
  }
  return out;
}

// `.` and `..` are relative steps to a URL parser, not segments, so a
// value can't be either: a URL that carried one would be normalized
// away before it reached the matcher.
function isValidParamValue(value: string): boolean {
  return value !== '' && value !== '.' && value !== '..';
}

function stripTrailingSlash(rest: string): string {
  return rest.endsWith('/') && rest !== '/' ? rest.slice(0, -1) : rest;
}

function splitAndDecode(rest: string): string[] | undefined {
  if (rest === '') {
    return [];
  }
  let out: string[] = [];
  for (let raw of rest.split('/')) {
    if (raw === '') {
      return undefined;
    }
    let decoded = safeDecode(raw);
    if (decoded === undefined) {
      return undefined;
    }
    out.push(decoded);
  }
  return out;
}

function safeDecode(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

function fail(
  code: RoutePatternErrorCode,
  message: string,
  extra: { segmentIndex?: number; name?: string } = {},
): { ok: false; error: RoutePatternError } {
  return { ok: false, error: { code, message, ...extra } };
}
