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
 * The last path segment of an identifier in either form, without its query or
 * fragment: `photo.jpg` for both `https://example.test/r/photo.jpg` and
 * `@cardstack/catalog/photo.jpg`. A trailing slash is ignored. A URL's origin
 * and a prefix's `@scope/name` namespace are not path segments, so a URL with
 * no path and a bare prefix have none.
 *
 * It reads the spelling only, so a prefix-form identifier never goes through
 * a URL parser. The segment keeps any percent-encoding it was written with.
 */
export function lastSegmentOfIdentifier(identifier: string): string {
  let path = identifier
    .split(/[?#]/, 1)[0]
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  let segments = path.split('/').filter(Boolean);
  if (isPrefixForm(identifier)) {
    segments = segments.slice(2);
  }
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
