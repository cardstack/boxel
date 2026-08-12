// Utility-only GTS modules are valid source files even when they contain no CardDef.
export function humanizeSlug(value: string): string { // Single callable export exercises the no-schema summary state
  return value
    .split('-')
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}
