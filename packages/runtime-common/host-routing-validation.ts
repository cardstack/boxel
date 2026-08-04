// Shared vocabulary for host routing rules: the rule union type the
// resolved routing map is made of, plus advisory validators for the
// rule editor. The validators do not reject input — they produce a
// human-readable warning the UI shows next to the offending rule.
// Server-side enforcement lives in `Realm.getHostRoutingMap`, which
// drops rules the validators here would warn about.

const VALID_PATH_PATTERN = /^\/(?:[A-Za-z0-9._~/-]|%[0-9A-Fa-f]{2})*$/;

// Only 301/302 are offered: routed paths serve GET/HEAD page requests
// exclusively (card mutations live on the JSON API, not these URLs), so
// the method-preserving codes (307/308) would behave identically to
// their plain counterparts and just clutter the choice.
// The host app's own query params — the routing state it reads off the
// URL, as declared by its index controller. Shared so a redirect rule
// can tell this internal state apart from foreign params that merely
// ride along (`utm_source` and friends): a redirect carries the foreign
// ones onto its target and drops these, on both the server's 3xx and the
// SPA's in-app navigation.
//
// Two reasons they are dropped. Some are sensitive — `sid` and
// `clientSecret` are password-reset tokens — and a redirect target may
// be an external site, which would receive them in its own URL. The
// rest are meaningless off the page that owns them. The client has a
// third reason: its router hydrates every declared param onto the
// transition using the controller's default, so forwarding blind would
// append values that were never in the URL at all.
export const HOST_APP_QUERY_PARAMS = [
  'authRedirect',
  'hostModeOrigin',
  'hostModeStack',
  'operatorModeState',
  // `sid` and `clientSecret` come from the email verification process to
  // reset a password
  'sid',
  'clientSecret',
  'card',
  'cardPath',
  'debug',
];

/**
 * Strips the host app's own query params from `search`, returning the
 * remainder as a query string without its leading `?` (empty when
 * nothing survives). Values round-trip through `URLSearchParams`, so
 * repeated keys are preserved as repeated keys and encoding is
 * normalized to its standard form.
 */
export function foreignQueryParams(search: string): string {
  let params = new URLSearchParams(search);
  for (let key of HOST_APP_QUERY_PARAMS) {
    params.delete(key);
  }
  return params.toString();
}

export const REDIRECT_STATUS_CODES = [301, 302] as const;
export type RedirectStatusCode = (typeof REDIRECT_STATUS_CODES)[number];

// Temporary (302) is the safe default: a realm config is hand-editable
// and iterated on, and a permanent 301 is cached by browsers with no
// practical way to roll back once a visitor has seen it. Authors opt
// into permanence explicitly via `statusCode`.
export const DEFAULT_REDIRECT_STATUS: RedirectStatusCode = 302;

// A resolved routing rule maps a path within the realm either to a card
// to render at that path, or to a redirect target. `redirectTo` is
// either a realm-relative path ('/terms', resolved against the realm's
// mount pathname just like `path` is) or an absolute http(s) URL —
// external targets are allowed.
export type HostRoutingServeRule = { path: string; id: string };
export type HostRoutingRedirectRule = {
  path: string;
  redirectTo: string;
  statusCode: RedirectStatusCode;
};
export type HostRoutingRule = HostRoutingServeRule | HostRoutingRedirectRule;

export function isRedirectRoutingRule(
  rule: HostRoutingRule,
): rule is HostRoutingRedirectRule {
  return 'redirectTo' in rule;
}

/**
 * Canonical form of a routing rule path: a trailing slash is stripped so
 * `/pricing/` and `/pricing` compare and match identically, with the realm
 * root `/` preserved. This is the single source of truth for that
 * normalization across every place a route path is compared:
 * `Realm.getHostRoutingMap` uses it to build the map, `findDuplicateRoutingPaths`
 * / `validateRoutingPath` use it so the editor's collision detection and
 * advisories agree with how routes resolve, and the host's
 * `HostModeService.resolveRoutedPath` uses it to match the injected map keys
 * against the browser path. Callers that care about surrounding whitespace
 * should `trim()` first.
 */
export function normalizeRoutingPath(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}

/**
 * Returns a warning message for a routing rule path that is non-empty
 * but malformed. Empty / whitespace-only / null / undefined input
 * returns `undefined` so an in-progress rule never shows the warning.
 *
 * Rules:
 * - Must start with `/`.
 * - Otherwise composed of the unreserved character set
 *   (letters, numbers, `-`, `_`, `.`, `~`), `/` separators, or
 *   percent-encoded `%XX` sequences (`X` is a hex digit).
 * - A trailing slash is stripped when the route is matched, so it is
 *   advised against (with the normalized form shown) rather than
 *   rejected. The realm root `/` is exempt.
 */
export function validateRoutingPath(
  path: string | null | undefined,
): string | undefined {
  if (path == null) return undefined;
  let trimmed = path.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('/')) {
    return 'Path must start with /';
  }
  if (!VALID_PATH_PATTERN.test(trimmed)) {
    return 'Path may only contain letters, numbers, /, -, _, ., ~, or %XX-encoded characters';
  }
  // A trailing slash is stripped when the route is matched (see
  // Realm.getHostRoutingMap), so '/pricing/' behaves exactly like
  // '/pricing'. Surface that instead of silently normalizing the author's
  // input. The root '/' is the realm root, not a trailing slash, so it is
  // exempt.
  if (trimmed !== '/' && trimmed.endsWith('/')) {
    return `Trailing slash is ignored; this route matches "${normalizeRoutingPath(
      trimmed,
    )}"`;
  }
  return undefined;
}

const ABSOLUTE_URL_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * Returns a warning message for a redirect target that is non-empty but
 * malformed; empty / whitespace-only / null / undefined input returns
 * `undefined` so an in-progress rule never shows the warning.
 *
 * Accepted forms:
 * - A realm-relative path starting with a single `/` (resolved against
 *   the realm's mount pathname, like a rule's `path`). Unlike `path`,
 *   the character set is not restricted — a target may carry a query
 *   string.
 * - An absolute `http:`/`https:` URL; external hosts are allowed. Other
 *   schemes (`javascript:`, `data:`, …) are rejected.
 *
 * A protocol-relative target (`//example.com/x`) warns rather than
 * silently becoming the realm path `/example.com/x` (extra leading
 * slashes are collapsed when the redirect resolves).
 */
export function validateRedirectTarget(
  target: string | null | undefined,
): string | undefined {
  if (target == null) return undefined;
  let trimmed = target.trim();
  if (!trimmed) return undefined;
  if (ABSOLUTE_URL_PATTERN.test(trimmed)) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(trimmed);
    } catch {
      parsed = undefined;
    }
    if (
      !parsed ||
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    ) {
      return 'Redirect target must be a path starting with / or a full http(s) URL';
    }
    return undefined;
  }
  if (!trimmed.startsWith('/')) {
    return 'Redirect target must be a path starting with / or a full http(s) URL';
  }
  if (trimmed.startsWith('//')) {
    return 'Redirect target must start with a single /; use a full http(s) URL for an external target';
  }
  return undefined;
}

/**
 * Coerces an authored `statusCode` value to one of the supported
 * redirect codes. Accepts a number or a numeric string; anything else
 * (including unsupported codes like 307 or 308) returns `undefined` so
 * the caller can fall back to `DEFAULT_REDIRECT_STATUS`.
 */
export function parseRedirectStatusCode(
  value: unknown,
): RedirectStatusCode | undefined {
  let candidate =
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return (REDIRECT_STATUS_CODES as readonly unknown[]).includes(candidate)
    ? (candidate as RedirectStatusCode)
    : undefined;
}

/**
 * Returns the paths whose redirect rules chain back on themselves, in
 * the order the cycles were discovered — a self-redirect
 * (`/tos` → `/tos`) or a longer ring (`/a` → `/b` → `/a`). Left
 * unguarded, each one answers a redirect to a URL that matches the same
 * rule again, so the client bounces until it gives up
 * (`ERR_TOO_MANY_REDIRECTS`) — and a permanent 301 keeps doing so from
 * cache after the rule is fixed.
 *
 * Only realm-relative targets form edges: an external `http(s)` target
 * leaves the realm, so it ends the chain. Targets are compared by
 * pathname in normalized form, so a query string or a trailing slash on
 * the target doesn't disguise a loop. Paths that merely *lead into* a
 * cycle are not reported — dropping the ring itself is enough to make
 * them resolve.
 *
 * A realm cannot reach its own paths through an external URL as far as
 * this can tell (the published host isn't known here), so a target
 * spelled as a full URL back to the same site stays undetected.
 */
export function findRedirectCycles(
  rules:
    | ReadonlyArray<{ path?: string | null; redirectTo?: string | null }>
    | null
    | undefined,
): string[] {
  if (!rules) return [];
  // path -> the path it redirects to. Duplicate paths keep the first
  // rule, matching how the routing map's `.find()` resolves them.
  let edges = new Map<string, string>();
  for (let rule of rules) {
    let path = rule?.path?.trim();
    let target = rule?.redirectTo?.trim();
    if (!path || !target || ABSOLUTE_URL_PATTERN.test(target)) continue;
    let from = normalizeRoutingPath(path);
    if (edges.has(from)) continue;
    // Compare pathnames only: the target's own query/fragment doesn't
    // change which rule the redirected request matches.
    let targetPath = target.split('#')[0].split('?')[0];
    edges.set(from, normalizeRoutingPath(targetPath));
  }

  let cyclic: string[] = [];
  let seenCyclic = new Set<string>();
  for (let start of edges.keys()) {
    // Walk the chain from `start`, recording visit order, until it ends
    // (no outgoing edge) or revisits a node on this walk.
    let positions = new Map<string, number>();
    let chain: string[] = [];
    let node: string | undefined = start;
    while (node !== undefined && !positions.has(node)) {
      positions.set(node, chain.length);
      chain.push(node);
      node = edges.get(node);
    }
    if (node === undefined) continue; // chain terminated, no loop
    for (let i = positions.get(node)!; i < chain.length; i++) {
      if (!seenCyclic.has(chain[i])) {
        seenCyclic.add(chain[i]);
        cyclic.push(chain[i]);
      }
    }
  }
  return cyclic;
}

/**
 * Returns the set of non-empty paths that appear on more than one
 * routing rule, in insertion order. Empty paths are ignored — they
 * represent rules whose path field hasn't been filled in yet.
 *
 * Paths are compared in their normalized form, so `/pricing` and
 * `/pricing/` collide — matching how the routing map resolves them (both
 * become `/pricing`, and the map's `.find()` would otherwise make the
 * second target silently unreachable). The reported path is the normalized
 * one.
 */
export function findDuplicateRoutingPaths(
  rules: ReadonlyArray<{ path?: string | null }> | null | undefined,
): string[] {
  if (!rules) return [];
  let counts = new Map<string, number>();
  for (let rule of rules) {
    let trimmed = rule?.path?.trim();
    if (!trimmed) continue;
    let path = normalizeRoutingPath(trimmed);
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  let dups: string[] = [];
  for (let [path, count] of counts) {
    if (count > 1) dups.push(path);
  }
  return dups;
}
