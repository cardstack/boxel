import { getOwner } from '@ember/owner';

// Copies code of `getProvider` from @ember-provide-consume-context
// Inspects the context at the class property level
export function inspectContext(owner: any, contextKey: string) {
  const appOwner = getOwner(owner);

  if (!appOwner) {
    return null;
  }

  const renderer = appOwner.lookup('renderer:-dom') as any;

  if (!renderer) {
    return null;
  }

  // Handle both Ember 6+ and older versions
  const env = renderer._runtime?.env ?? renderer._context?.env;
  const container = env?.provideConsumeContextContainer;

  if (!container) {
    return null;
  }

  const contexts = container.contextsFor(owner);
  const provider = contexts?.[contextKey];

  return provider
    ? {
        value: provider.instance[provider.key],
        instance: provider.instance,
        key: provider.key,
      }
    : null;
}
