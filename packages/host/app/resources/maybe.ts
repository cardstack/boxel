import { associateDestroyableChild, destroy } from '@ember/destroyable';
import { resource } from 'ember-resources';
import { getOwner, setOwner } from '@ember/owner';

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
