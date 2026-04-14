/**
 * A card instance ID or module reference that may be either a full URL
 * (e.g. "http://localhost:4201/base/card-api") or a registered prefix form
 * (e.g. "@cardstack/base/card-api"). Use `resolveCardReference()` to safely convert
 * to a URL — do NOT pass directly to `new URL()`.
 */
export type RealmResourceIdentifier = string & { __rriBrand: unknown };

/**
 * A realm URL that may be either a full HTTP URL
 * (e.g. "http://localhost:4201/base/") or a registered prefix form
 * (e.g. "@cardstack/base/"). Use `resolveCardReference()` to safely convert
 * to a URL — do NOT pass directly to `new URL()`.
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

export function resolveRRI(
  reference: RealmResourceIdentifier,
  relativeTo?: RealmResourceIdentifier,
): RealmResourceIdentifier {
  // ("@cardstack/base/string") → @cardstack/base/string
  // ("./string", "@cardstack/base") → @cardstack/base/string
  // ("/string", "@cardstack/base/fields") → invalid
  // ("~/card", "@cardstack/base/") → invalid
  // ("$thisRealm/string", "@cardstack/base/") → @cardstack/base/string
  // ("@cardstack/base/string", "@cardstack/catalog") → @cardstack/base/string
  // ("http://localhost:4201/realm/card") → http://localhost:4201/realm/card
  // ("http://localhost:4201/realm/card", "@cardstack/base") → http://localhost:4201/realm/card
  // ("./card", "http://localhost:4201/realm/") → http://localhost:4201/realm/card
  // ("../card", "http://localhost:4201/realm/directory/") → http://localhost:4201/realm/card
  // ("/card", "http://localhost:4201/realm/directory/") → invalid
  // ("~/card", "http://localhost:4201/realm/directory/") → invalid
  // ("/card", "https://home.boxel.ai/contact/users") → invalid
  // ("$thisRealm/card", "https://home.boxel.ai/contact/users/") → https://home.boxel.ai/contact/card
  // ("card", "@cardstack/base") → @cardstack/base/card
  // ("card", "http://localhost:4201/realm/") → http://localhost:4201/realm/card

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
  for (let [prefix] of prefixMappings) {
    if (relativeTo.startsWith(prefix)) {
      let baseURL = toNetworkURL(relativeTo);
      let resolved = new URL(reference, baseURL);
      return fromNetworkURL(resolved);
    }
  }

  throw new Error(
    `Cannot resolve "${reference}" — relativeTo "${relativeTo}" has no matching prefix mapping`,
  );
}

export function toNetworkURL(
  reference: RealmResourceIdentifier,
  relativeTo?: RealmResourceIdentifier,
): URL {
  for (let [prefix, target] of prefixMappings) {
    if (reference.startsWith(prefix)) {
      return new URL(reference.slice(prefix.length), target);
    }
  }

  if (!isUrlLikeReference(reference)) {
    throw new Error(
      `Cannot resolve bare package specifier "${reference}" — no matching prefix mapping registered`,
    );
  }

  if (reference.startsWith('http://') || reference.startsWith('https://')) {
    return new URL(reference);
  }

  let relativeToUrl = relativeTo ? toNetworkURL(relativeTo) : undefined;
  return new URL(reference, relativeToUrl);
}

// Reverse of resolveCardReference: converts a resolved URL back to
// its registered prefix form if one matches.
// e.g. "http://localhost:4201/catalog/foo" → "@cardstack/catalog/foo"
export function fromNetworkURL(
  resolvedURL: string | URL,
): RealmResourceIdentifier {
  let urlString = resolvedURL instanceof URL ? resolvedURL.href : resolvedURL;
  for (let [prefix, target] of prefixMappings) {
    if (urlString.startsWith(target)) {
      return (prefix +
        urlString.slice(target.length)) as RealmResourceIdentifier;
    }
  }
  return urlString as RealmResourceIdentifier;
}
