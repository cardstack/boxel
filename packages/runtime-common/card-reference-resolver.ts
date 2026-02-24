const prefixMappings = new Map<string, string>();

export function registerCardReferencePrefix(
  prefix: string,
  targetURL: string,
): void {
  prefixMappings.set(prefix, targetURL);
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
  return new URL(reference, relativeTo).href;
}
