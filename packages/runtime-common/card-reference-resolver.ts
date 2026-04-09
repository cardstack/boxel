/**
 * A card instance ID or module reference that may be either a full URL
 * (e.g. "http://localhost:4201/base/card-api") or a registered prefix form
 * (e.g. "@cardstack/base/card-api"). Use `cardIdToURL()` to safely convert
 * to a URL — do NOT pass directly to `new URL()`.
 */
export type CardOrModuleRef = string;

/**
 * A realm URL that may be either a full HTTP URL
 * (e.g. "http://localhost:4201/base/") or a registered prefix form
 * (e.g. "@cardstack/base/"). Use `cardIdToURL()` to safely convert
 * to a URL — do NOT pass directly to `new URL()`.
 */
export type RealmRef = string;

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
  reference: string | URL,
  relativeTo: URL | string | undefined,
): string {
  // Defensive: coerce URL objects to strings. This shouldn't happen but
  // something is leaking URL objects into CodeRef.module fields.
  if (reference instanceof URL) {
    reference = reference.href;
  } else if (typeof reference !== 'string') {
    throw new Error(
      `resolveCardReference expected a string but received ${typeof reference}: ${String(reference)} (constructor: ${(reference as any)?.constructor?.name})`,
    );
  }
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
export function cardIdToURL(id: CardOrModuleRef): URL {
  return new URL(resolveCardReference(id, undefined));
}
