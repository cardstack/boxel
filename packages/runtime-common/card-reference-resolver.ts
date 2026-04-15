/**
 * A card instance ID, module path, or any resource reference in a realm.
 * May be either a scoped identifier (e.g. `@cardstack/base/card-api`)
 * or a full URL (e.g. `https://my-realm.com/cards/person`).
 *
 * Do NOT pass directly to `new URL()` — use `resolveRRI()` (forthcoming).
 */
export type RealmResourceIdentifier = string & { __rriBrand: unknown };

/**
 * A realm identifier — always has a trailing slash.
 * May be either a scoped identifier (e.g. `@cardstack/base/`)
 * or a full URL (e.g. `https://my-realm.com/foo/`).
 *
 * Do NOT pass directly to `new URL()` — use realm-aware utilities
 * for safe resolution (forthcoming).
 */
export type RealmIdentifier = string & { __riBrand: unknown };

const prefixMappings = new Map<string, string>();

export function registerCardReferencePrefix(
  prefix: string,
  targetURL: string,
): void {
  prefixMappings.set(prefix, targetURL);
}

export function unregisterCardReferencePrefix(prefix: string): void {
  prefixMappings.delete(prefix);
}

export function isRegisteredPrefix(reference: string): boolean {
  for (let [prefix] of prefixMappings) {
    if (reference.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function isUrlLikeReference(ref: string): boolean {
  return (
    ref.startsWith('.') ||
    ref.startsWith('/') ||
    ref.startsWith('http://') ||
    ref.startsWith('https://')
  );
}

export function resolveCardReference(
  reference: string,
  relativeTo: URL | string | undefined,
): string {
  for (let [prefix, target] of prefixMappings) {
    if (reference.startsWith(prefix)) {
      return new URL(reference.slice(prefix.length), target).href;
    }
  }
  if (!isUrlLikeReference(reference)) {
    throw new Error(
      `Cannot resolve bare package specifier "${reference}" — no matching prefix mapping registered`,
    );
  }
  if (reference.startsWith('http://') || reference.startsWith('https://')) {
    return new URL(reference).href;
  }
  // If relativeTo is a prefix-form ID (e.g. @cardstack/skills/Foo/bar),
  // resolve it to a real URL before using it as a base.
  if (typeof relativeTo === 'string') {
    for (let [prefix, target] of prefixMappings) {
      if (relativeTo.startsWith(prefix)) {
        relativeTo = new URL(relativeTo.slice(prefix.length), target).href;
        break;
      }
    }
    // If relativeTo is still a non-URL-like string after attempting prefix
    // resolution, provide a more actionable error instead of allowing
    // new URL(reference, relativeTo) to throw a generic TypeError.
    if (typeof relativeTo === 'string' && !isUrlLikeReference(relativeTo)) {
      throw new Error(
        `Cannot resolve "${reference}" relative to "${relativeTo}" — no matching prefix mapping registered for the base`,
      );
    }
  }
  return new URL(reference, relativeTo).href;
}

// Reverse of resolveCardReference: converts a resolved URL back to
// its registered prefix form if one matches.
// e.g. "http://localhost:4201/catalog/foo" → "@cardstack/catalog/foo"
export function unresolveCardReference(resolvedURL: string): string {
  for (let [prefix, target] of prefixMappings) {
    if (resolvedURL.startsWith(target)) {
      return prefix + resolvedURL.slice(target.length);
    }
  }
  return resolvedURL;
}

// Converts a card instance ID (which may be a registered prefix like
// @cardstack/catalog/foo or a regular URL) to a URL object by resolving
// the prefix to a real URL when needed.
export function cardIdToURL(id: string): URL {
  return new URL(resolveCardReference(id, undefined));
}

// ---------------------------------------------------------------------------
// RRI (RealmResourceIdentifier) resolution — Phase 0 additions
// ---------------------------------------------------------------------------

/**
 * Resolve a reference to an absolute `RealmResourceIdentifier`.
 *
 * Resolution rules:
 * - Absolute URL or registered prefix → return as-is
 * - Relative (`./`, `../`, bare name) → resolve against `relativeTo`
 * - `$thisRealm/` → resolve against the realm root of `relativeTo`
 * - `/` or `~/` prefixed → throw (not valid RRI forms)
 */
export function resolveRRI(
  reference: RealmResourceIdentifier,
  relativeTo?: RealmResourceIdentifier,
): RealmResourceIdentifier {
  // Absolute URL — already resolved
  if (reference.startsWith('http://') || reference.startsWith('https://')) {
    return reference;
  }

  // Starts with a registered prefix — already resolved
  if (isRegisteredPrefix(reference)) {
    return reference;
  }

  // "/" and "~/" are not valid RRI reference forms
  if (reference.startsWith('/') || reference.startsWith('~/')) {
    throw new Error(
      `Invalid RRI reference "${reference}" — "/" and "~/" prefixes are not supported`,
    );
  }

  if (!relativeTo) {
    throw new Error(`Cannot resolve "${reference}" without a relativeTo`);
  }

  let isUrlRelativeTo =
    relativeTo.startsWith('http://') || relativeTo.startsWith('https://');

  // $thisRealm/ — resolve against the realm root
  if (reference.startsWith('$thisRealm/')) {
    let path = reference.slice('$thisRealm/'.length);
    if (isUrlRelativeTo) {
      for (let [, target] of prefixMappings) {
        if (relativeTo.startsWith(target)) {
          return new URL(path, target).href as RealmResourceIdentifier;
        }
      }
      throw new Error(
        `Cannot resolve "$thisRealm/" — no realm root found for "${relativeTo}"`,
      );
    }
    for (let [prefix] of prefixMappings) {
      if (relativeTo.startsWith(prefix)) {
        return (
          prefix.endsWith('/') ? prefix + path : prefix + '/' + path
        ) as RealmResourceIdentifier;
      }
    }
    throw new Error(
      `Cannot resolve "${reference}" — relativeTo "${relativeTo}" has no matching prefix mapping`,
    );
  }

  // relativeTo is a URL — standard URL resolution
  if (isUrlRelativeTo) {
    return new URL(reference, relativeTo).href as RealmResourceIdentifier;
  }

  // relativeTo starts with a registered prefix — resolve in prefix space
  // by round-tripping through URL space: prefix→URL, resolve, URL→prefix
  for (let [prefix, target] of prefixMappings) {
    if (relativeTo.startsWith(prefix)) {
      let baseURL = new URL(relativeTo.slice(prefix.length), target);
      let resolved = new URL(reference, baseURL);
      // Convert back to scoped form if the resolved URL matches a mapping
      for (let [p, t] of prefixMappings) {
        if (resolved.href.startsWith(t)) {
          return (p + resolved.href.slice(t.length)) as RealmResourceIdentifier;
        }
      }
      return resolved.href as RealmResourceIdentifier;
    }
  }

  throw new Error(
    `Cannot resolve "${reference}" — relativeTo "${relativeTo}" has no matching prefix mapping`,
  );
}
