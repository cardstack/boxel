import { catalogRealm } from '../constants';

const CATALOG_PREFIX = '@cardstack/catalog/';

export function canonicalURL(url: string, relativeTo?: string): string {
  if (url.startsWith(CATALOG_PREFIX)) {
    url = catalogRealm.url + url.slice(CATALOG_PREFIX.length);
  }
  try {
    let parsed = new URL(url, relativeTo);
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch (_e) {
    let stripped = url.split('#')[0] ?? url;
    return stripped.split('?')[0] ?? stripped;
  }
}
