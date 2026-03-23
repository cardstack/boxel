import { trimExecutableExtension } from '../index';
import {
  isRegisteredPrefix,
  resolveCardReference,
} from '../card-reference-resolver';
import { canonicalURL } from './dependency-url';

export function isExtensionlessPath(url: URL): boolean {
  let lastSegment = url.pathname.split('/').pop() ?? '';
  return !lastSegment.includes('.');
}

export function normalizeStoredDependency(
  dep: string,
  relativeTo: URL,
): string {
  return canonicalURL(dep, relativeTo.href);
}

export function normalizeRelationshipDependency(
  dep: string,
  relativeTo: URL,
  realmURL: URL,
): string {
  let canonical = canonicalURL(dep, relativeTo.href);
  // Prefix-form deps (e.g. @cardstack/catalog/foo) are already canonical.
  // Resolve to check realm membership and add .json if needed.
  if (isRegisteredPrefix(canonical)) {
    let resolved = resolveCardReference(canonical, undefined);
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
): boolean {
  try {
    let resolved = isRegisteredPrefix(dep)
      ? resolveCardReference(dep, undefined)
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
): string {
  let canonical = canonicalURL(dep, relativeTo.href);
  // For registered prefix deps (e.g. @cardstack/catalog/foo.gts),
  // trim executable extensions without URL parsing
  if (isRegisteredPrefix(canonical)) {
    return canonical.replace(/\.(gts|ts|js|gjs)$/, '');
  }
  try {
    return trimExecutableExtension(new URL(canonical)).href;
  } catch (_err) {
    return canonical;
  }
}
