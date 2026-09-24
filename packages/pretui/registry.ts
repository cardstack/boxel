// Pretui — registry merge with a duplicate-key guard.
//
// The demo and example registries are each one object built from ~70 bundles.
// With object spread, a later bundle silently overwrites an earlier one, so
// extracting a component into its own folder and forgetting to delete its old
// territory entry produces a page that renders the stale demo while every gate
// stays green: `missingDemoNames` checks that a key exists, not which module
// supplied it. Merging through here turns that into a module-eval error that
// names both bundles.

/**
 * Merge registry bundles into one lookup, throwing if two bundles claim the
 * same component name. Pass the bundles as a record so the error can name
 * them: `mergeRegistry({ DEMOS_CONTROLS, DEMOS_BUTTON })`.
 */
export function mergeRegistry<T>(
  bundles: Record<string, Record<string, T>>,
): Record<string, T> {
  let merged: Record<string, T> = Object.create(null);
  let claimedBy: Record<string, string> = Object.create(null);
  for (let [bundleName, bundle] of Object.entries(bundles)) {
    if (!bundle) {
      throw new Error(
        `Pretui registry bundle ${bundleName} is undefined — check for an import cycle or a renamed export.`,
      );
    }
    for (let [key, value] of Object.entries(bundle)) {
      let owner = claimedBy[key];
      if (owner) {
        throw new Error(
          `Pretui registry conflict: "${key}" is provided by both ${owner} and ${bundleName}. ` +
            `A component's entry belongs in exactly one bundle — if it moved to components/, delete the old one.`,
        );
      }
      claimedBy[key] = bundleName;
      merged[key] = value;
    }
  }
  return merged;
}
