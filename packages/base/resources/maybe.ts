import { associateDestroyableChild, destroy } from '@ember/destroyable';

import { getOwner, setOwner } from '@ember/owner';

import { resource } from 'ember-resources';

/**
 * This resource is meant for consumers to instantiate resources when some asynchronous
 * conditions are met (e.g. if argument already exists, context exists). Otherwise,
 * it will still exist as a resource that returns undefined.
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
