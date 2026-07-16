import { rri } from '../realm-identifiers.ts';
import { trimExecutableExtension } from '../index.ts';
import type { VirtualNetwork } from '../virtual-network.ts';
import { canonicalURL, type CanonicalURLMemo } from './dependency-url.ts';

export function isExtensionlessPath(url: URL): boolean {
  let lastSegment = url.pathname.split('/').pop() ?? '';
  return !lastSegment.includes('.');
}

export function normalizeStoredDependency(
  dep: string,
  relativeTo: URL,
  virtualNetwork: VirtualNetwork,
  memo?: CanonicalURLMemo,
): string {
  return canonicalURL(dep, relativeTo.href, virtualNetwork, memo);
}

export function normalizeRelationshipDependency(
  dep: string,
  relativeTo: URL,
  realmURL: URL,
  virtualNetwork: VirtualNetwork,
  memo?: CanonicalURLMemo,
): string {
  let canonical = canonicalURL(dep, relativeTo.href, virtualNetwork, memo);
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
  memo?: CanonicalURLMemo,
): string {
  let canonical = canonicalURL(dep, relativeTo.href, virtualNetwork, memo);
  return trimExecutableExtension(rri(canonical));
}
