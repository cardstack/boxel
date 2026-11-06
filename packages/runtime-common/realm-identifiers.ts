/**
 * A card instance ID, module path, or any resource reference in a realm.
 * May be either a scoped identifier (e.g. `@cardstack/base/card-api`)
 * or a full URL (e.g. `https://my-realm.com/cards/person`).
 *
 * Do NOT pass directly to `new URL()` — use {@link VirtualNetwork.toURL}.
 */
export type RealmResourceIdentifier = string & { __rriBrand: unknown };

/**
 * A realm identifier — always has a trailing slash.
 * May be either a scoped identifier (e.g. `@cardstack/base/`)
 * or a full URL (e.g. `https://my-realm.com/foo/`).
 *
 * Do NOT pass directly to `new URL()` — use {@link VirtualNetwork.toURL}.
 */
export type RealmIdentifier = string & { __riBrand: unknown };

/**
 * Brand a string as a `RealmResourceIdentifier`. Thin wrapper around
 * `as RealmResourceIdentifier` — use at boundaries where you know a string
 * is a valid RRI (e.g. literal modules, already-resolved URLs).
 */
export function rri(s: string): RealmResourceIdentifier {
  return s as RealmResourceIdentifier;
}

/**
 * Brand a string as a `RealmIdentifier`. Thin wrapper around
 * `as RealmIdentifier` — use at boundaries where you know a string is a
 * valid realm identifier (e.g. trailing-slash URLs).
 */
export function ri(s: string): RealmIdentifier {
  return s as RealmIdentifier;
}

/**
 * Whether an identifier is in prefix form (`@scope/name/…`, such as
 * `@cardstack/base/card-api`) rather than URL form. This is the one test of an
 * identifier's form: a URL parser answers it wrongly, because a prefix-form
 * identifier is absolute but does not parse as a URL.
 *
 * It reads the spelling only, so it answers for a prefix whether or not that
 * prefix is registered.
 */
export function isPrefixForm(identifier: string): boolean {
  return identifier.startsWith('@');
}

/**
 * Whether an identifier is absolute: an `http:`/`https:` URL or prefix form.
 * A relative reference, a bare package specifier and any other scheme
 * (`data:`, `blob:`, …) are not.
 *
 * Like `isPrefixForm`, it reads the spelling only.
 */
export function isAbsoluteIdentifier(identifier: string): boolean {
  return (
    identifier.startsWith('http://') ||
    identifier.startsWith('https://') ||
    isPrefixForm(identifier)
  );
}

// Synthetic origin used to borrow the URL parser's path-normalization for
// prefix-form RRI bases. The host is invalid-by-construction so it can never
// collide with a real realm URL.
const RRI_SYNTHETIC_ORIGIN = 'https://rri.invalid';

// Resolve a (possibly relative) reference against `relativeTo`, in RRI space,
// without consulting realm mappings — the inverse of `relativeReference` in
// `url.ts`. Identifiers are already in canonical RRI form once they reach here
// (a card's own id / a relationship `links.self`), so this is pure
// form-preserving path math:
//   - an absolute reference (any `<scheme>:` URL, or `@scope/name` prefix form)
//     is already canonical — returned unchanged;
//   - a relative reference is joined onto the base. A URL-form base uses the
//     native URL parser; a prefix-form base borrows the parser via a synthetic
//     origin, then the `@scope/name` namespace is restored.
//   - a `$REALM/`-rooted reference resolves against the realm root. Mapping-free,
//     the realm root is derivable only from a prefix-form base, where it is the
//     `@scope/name` namespace. (A URL-form base implies an unmapped realm, where
//     resolving the realm root requires realm mappings — `resolveRRI` likewise
//     has no realm root to resolve against there.)
// Falls back to the reference unchanged when there is no usable base.
export function resolveRRIReference(
  reference: string,
  relativeTo: RealmResourceIdentifier | URL | undefined,
): string {
  if (
    isPrefixForm(reference) ||
    // Any absolute-URL scheme (`http:`/`https:`, but also `data:`, `blob:`,
    // `mailto:`, …) is already canonical — return it unchanged rather than
    // treating it as a relative reference to join against the base. Matches an
    // RFC 3986 scheme (`ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )`) followed
    // by `:`; relative refs (`./`, `../`, `/`, bare names) have no scheme.
    /^[a-z][a-z0-9+.-]*:/i.test(reference)
  ) {
    return reference;
  }
  if (relativeTo == null) {
    return reference;
  }
  let base = relativeTo instanceof URL ? relativeTo.href : relativeTo;
  // `$REALM/` — resolve against the realm root (the `@scope/name` namespace of a
  // prefix-form base). Must run before ordinary path joining, which would treat
  // `$REALM` as a path segment.
  if (reference.startsWith('$REALM/')) {
    let path = reference.slice('$REALM/'.length);
    let parts = base.split('/');
    if (parts.length >= 2 && isPrefixForm(base)) {
      return `${parts[0]}/${parts[1]}/${path}`;
    }
    return reference;
  }
  if (base.startsWith('http://') || base.startsWith('https://')) {
    return new URL(reference, base).href;
  }
  // Prefix-form RRI base. The namespace is the first two segments
  // (`@scope/name`), matching `sharedNamespace`; the remainder is the in-realm
  // path the reference resolves against.
  let parts = base.split('/');
  if (parts.length >= 2 && isPrefixForm(base)) {
    let namespace = `${parts[0]}/${parts[1]}`;
    let path = base.slice(namespace.length) || '/';
    let resolved = new URL(reference, `${RRI_SYNTHETIC_ORIGIN}${path}`);
    return `${namespace}${resolved.pathname}${resolved.search}${resolved.hash}`;
  }
  return reference;
}

/**
 * The path segments of an identifier in either form, without its query or
 * fragment: `['r', 'photo.jpg']` for `https://example.test/r/photo.jpg` and
 * `['r', 'photo.jpg']` for `@cardstack/catalog/r/photo.jpg`. Empty segments
 * are dropped, so a trailing slash is ignored. A URL's origin and a prefix's
 * `@scope/name` namespace are not path segments, so a URL with no path and a
 * bare prefix have none.
 *
 * It reads the spelling only, so a prefix-form identifier never goes through
 * a URL parser. Segments keep any percent-encoding they were written with.
 */
export function pathSegmentsOfIdentifier(identifier: string): string[] {
  let path = identifier
    .split(/[?#]/, 1)[0]
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  let segments = path.split('/').filter(Boolean);
  return isPrefixForm(identifier) ? segments.slice(2) : segments;
}

/**
 * The last of `pathSegmentsOfIdentifier`: `photo.jpg` for both
 * `https://example.test/r/photo.jpg` and `@cardstack/catalog/photo.jpg`, or ''
 * when the identifier has no path segments.
 */
export function lastSegmentOfIdentifier(identifier: string): string {
  let segments = pathSegmentsOfIdentifier(identifier);
  return segments[segments.length - 1] ?? '';
}

/**
 * `lastSegmentOfIdentifier`, percent-decoded for display. A segment holding
 * an escape that is not valid UTF-8 is returned as written.
 */
export function decodedLastSegmentOfIdentifier(identifier: string): string {
  let segment = lastSegmentOfIdentifier(identifier);
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Build a `{ module, name }` code ref by resolving `relativePath` against
 * `baseUrl` (typically `import.meta.url`) and branding the result as a
 * `RealmResourceIdentifier`.
 *
 * Card definitions in `.gts` realm modules use this to point at sibling cards
 * without sprinkling `as RealmResourceIdentifier` casts on every call site.
 */
export function codeRef(
  baseUrl: string,
  relativePath: string,
  name: string,
): { module: RealmResourceIdentifier; name: string } {
  return {
    module: new URL(relativePath, baseUrl).href as RealmResourceIdentifier,
    name,
  };
}
