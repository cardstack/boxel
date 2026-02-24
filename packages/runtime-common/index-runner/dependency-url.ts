import { resolveCardReference } from '../card-reference-resolver';

export function canonicalURL(url: string, relativeTo?: string): string {
  try {
    let resolved = resolveCardReference(url, relativeTo);
    let parsed = new URL(resolved);
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch (_e) {
    let stripped = url.split('#')[0] ?? url;
    return stripped.split('?')[0] ?? stripped;
  }
}
