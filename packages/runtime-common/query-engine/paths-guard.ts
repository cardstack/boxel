// Whether a filter, a policy's grant filter or a query anywhere holds a
// `paths` node (a policy grant narrowed by realm path, or a caller's own path
// filter). Such a search stays on the general read: the value store's
// narrowing, counts and facets, the store's reading of a policy's grants, and
// the one-statement union over several realms each decide which rows a search
// may return without the per-row path test, so none of them takes it.
// Owns: the one test every store path and the union ask.
// Must not: decide what a path matches (filter-compiler.ts's `pathsCondition`).
export function mentionsPaths(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(mentionsPaths);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, child]) =>
        (key === 'paths' && Array.isArray(child)) || mentionsPaths(child),
    );
  }
  return false;
}
