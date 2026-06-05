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
