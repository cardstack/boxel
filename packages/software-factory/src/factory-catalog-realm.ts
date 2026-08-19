/**
 * Derive the catalog realm URL from the target realm URL. The catalog realm
 * is served on the same origin as the target, at path `/catalog/`. Used by
 * the system prompt template so the agent doesn't guess production/staging
 * catalog URLs from memory.
 *
 * Kept in its own module (no runtime-common imports) so that test harnesses
 * which transpile via Babel can pull it into prompt-builder paths without
 * dragging in the realm-server index-writer's `declare`-field syntax.
 */
export function deriveCatalogRealmUrl(targetRealmUrl: string): string {
  return new URL('/catalog/', targetRealmUrl).href;
}
