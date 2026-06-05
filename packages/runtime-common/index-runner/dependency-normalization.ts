import { rri } from '../realm-identifiers';
import { trimExecutableExtension } from '../index';
import type { VirtualNetwork } from '../virtual-network';
import { canonicalURL } from './dependency-url';

export function isExtensionlessPath(url: URL): boolean {
  let lastSegment = url.pathname.split('/').pop() ?? '';
  return !lastSegment.includes('.');
}

export function normalizeStoredDependency(
  dep: string,
  relativeTo: URL,
  virtualNetwork: VirtualNetwork,
): string {
  return canonicalURL(dep, relativeTo.href, virtualNetwork);
}

export function normalizeRelationshipDependency(
  dep: string,
  relativeTo: URL,
  realmURL: URL,
  virtualNetwork: VirtualNetwork,
): string {
  let canonical = canonicalURL(dep, relativeTo.href, virtualNetwork);
  // Prefix-form deps (e.g. @cardstack/catalog/foo) are already canonical.
  // Resolve to check realm membership and add .json if needed.
  if (virtualNetwork.isRegisteredPrefix(canonical)) {
    let resolved = virtualNetwork.toURL(canonical).href;
    try {
      let parsed = new URL(resolved);
      if (
        parsed.href.startsWith(realmURL.href) &&
        isExtensionlessPath(parsed)
      ) {
        return `${canonical}.json`;
      }
    } catch (_err) {
      // fall through
    }
    return canonical;
  }
  try {
    let normalized = new URL(canonical);
    if (
      normalized.href.startsWith(realmURL.href) &&
      isExtensionlessPath(normalized)
    ) {
      normalized.pathname = `${normalized.pathname}.json`;
    }
    return normalized.href;
  } catch (_err) {
    return canonical;
  }
}

export function canTraverseRelationshipDependency(
  dep: string,
  realmURL: URL,
  virtualNetwork: VirtualNetwork,
): boolean {
  try {
    let resolved = virtualNetwork.isRegisteredPrefix(dep)
      ? virtualNetwork.toURL(dep).href
      : dep;
    let parsed = new URL(resolved);
    if (!parsed.href.startsWith(realmURL.href)) {
      return false;
    }
    return !isExtensionlessPath(parsed);
  } catch (_err) {
    return false;
  }
}

export function normalizeDependencyForLookup(
  dep: string,
  relativeTo: URL,
  virtualNetwork: VirtualNetwork,
): string {
  let canonical = canonicalURL(dep, relativeTo.href, virtualNetwork);
  return trimExecutableExtension(rri(canonical));
}
