const prefixMappings = new Map<string, string>();

export function registerCardReferencePrefix(
  prefix: string,
  targetURL: string,
): void {
  prefixMappings.set(prefix, targetURL);
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
