import {
  resolveCardReference,
  unresolveCardReference,
  isRegisteredPrefix,
} from '../card-reference-resolver';
import type { VirtualNetwork } from '../virtual-network';

export function canonicalURL(
  url: string,
  relativeTo?: string,
  virtualNetwork?: VirtualNetwork,
): string {
  try {
    // If the URL is already a registered prefix (e.g. @cardstack/catalog/foo),
    // keep it in that form — it's already canonical.
    if (
      virtualNetwork
        ? virtualNetwork.isRegisteredPrefix(url)
        : isRegisteredPrefix(url)
    ) {
      let stripped = url.split('#')[0] ?? url;
      return stripped.split('?')[0] ?? stripped;
    }
    let parsed = virtualNetwork
      ? virtualNetwork.resolveURL(url, relativeTo)
      : new URL(resolveCardReference(url, relativeTo));
    parsed.search = '';
    parsed.hash = '';
    // Convert resolved URLs back to prefix form if possible
    return virtualNetwork
      ? virtualNetwork.unresolveURL(parsed.href)
      : unresolveCardReference(parsed.href);
  } catch (_e) {
    let stripped = url.split('#')[0] ?? url;
    return stripped.split('?')[0] ?? stripped;
  }
}
