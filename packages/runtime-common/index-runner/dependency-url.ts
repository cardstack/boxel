import {
  resolveCardReference,
  unresolveCardReference,
  isRegisteredPrefix,
} from '../card-reference-resolver';

export function canonicalURL(url: string, relativeTo?: string): string {
  try {
    // If the URL is already a registered prefix (e.g. @cardstack/catalog/foo),
    // keep it in that form — it's already canonical.
    if (isRegisteredPrefix(url)) {
      let stripped = url.split('#')[0] ?? url;
      return stripped.split('?')[0] ?? stripped;
    }
    let resolved = resolveCardReference(url, relativeTo);
    let parsed = new URL(resolved);
    parsed.search = '';
    parsed.hash = '';
    // Convert resolved URLs back to prefix form if possible
    return unresolveCardReference(parsed.href);
  } catch (_e) {
    let stripped = url.split('#')[0] ?? url;
    return stripped.split('?')[0] ?? stripped;
  }
}
