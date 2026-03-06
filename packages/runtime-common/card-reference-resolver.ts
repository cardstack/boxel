const prefixMappings = new Map<string, string>();

export function registerCardReferencePrefix(
  prefix: string,
  targetURL: string,
): void {
  prefixMappings.set(prefix, targetURL);
}

function isUrlLikeReference(ref: string): boolean {
  return (
    ref.startsWith('.') ||
    ref.startsWith('/') ||
    ref.startsWith('http://') ||
    ref.startsWith('https://') ||
    ref.startsWith('cardstack://')
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
