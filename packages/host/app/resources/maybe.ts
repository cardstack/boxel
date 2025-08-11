import { associateDestroyableChild, destroy } from '@ember/destroyable';

import { getOwner, setOwner } from '@ember/owner';

import { resource } from 'ember-resources';

/**
 * A resource abstraction for handling optionally available context.
 *
 * This utility is designed for scenarios where you need to access context
 * that may not always be available, typically in getter functions or components
 * where the context depends on external conditions or lifecycle state.
 *
 * Usage patterns:
 * - Conditional service access based on route context
 * - Optional feature availability depending on configuration
 * - Graceful degradation when dependencies are unavailable
 *
 * @example
 * ```typescript
 * // In a component or getter where analytics might not be available
 * const analyticsResource = maybe(this, (context) => {
 *   try {
 *     return getOwner(context)?.lookup('service:analytics');
 *   } catch {
 *     return undefined; // Gracefully handle missing service
 *   }
 * });
 *
 * // Later access with safety
 * analyticsResource.current?.track('event');
 * ```
 *
 * @param parent - The parent object that owns this resource (must have an owner)
 * @param resourceBuilder - Function that attempts to build the resource, returning undefined if unavailable
 * @returns Resource with `current` property that may be undefined
 */
export function maybe<T>(
  parent: object,
  resourceBuilder: (context: object) => T | undefined,
): { current: T | undefined } {
  return resource(parent, ({ on }) => {
    let context = {};
    let owner = getOwner(parent);
    if (!owner) {
      throw new Error(
        'bug: maybe() needs an owned object as its first argument',
      );
    }
    setOwner(context, owner);
    associateDestroyableChild(parent, context);
    on.cleanup(() => destroy(context));
    return {
      current: (resourceBuilder(context) ?? undefined) as T | undefined,
    };
  });
}
