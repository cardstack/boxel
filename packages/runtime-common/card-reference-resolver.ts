import { catalogRealm } from './constants';

const CATALOG_PREFIX = '@cardstack/catalog/';

export function resolveCardReference(
  reference: string,
  relativeTo: URL | string | undefined,
): string {
  if (reference.startsWith(CATALOG_PREFIX)) {
    return catalogRealm.url + reference.slice(CATALOG_PREFIX.length);
  }
  return new URL(reference, relativeTo).href;
}
