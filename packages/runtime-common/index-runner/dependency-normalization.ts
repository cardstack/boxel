import { rri } from '../realm-identifiers.ts';
import { hasExecutableExtension, trimExecutableExtension } from '../index.ts';
import { urlNamesFile } from '../file-def-code-ref.ts';
import type { VirtualNetwork } from '../virtual-network.ts';
import { canonicalURL, type CanonicalURLMemo } from './dependency-url.ts';

function isExtensionlessPath(url: URL): boolean {
  let lastSegment = url.pathname.split('/').pop() ?? '';
  return !lastSegment.includes('.');
}

// Which resource a dependency URL names: a card instance, whose index row lives
// at `<id>.json`, or a file, whose row lives at the file's own URL. A known
// extension — one a file link resolves a FileDef subtype through, or an
// executable extension a module is served under — settles it, and a last
// segment with no dot at all settles it the other way, because an instance's
// `.json` is stripped from its id.
//
// Nothing settles the rest. A dotted last segment is a card id (`hello.test`
// beside the `hello.test.gts` module, a `ModelConfiguration/claude-sonnet-4.6`
// instance) as readily as a file whose extension is outside the FileDef
// registry (a `report.pdf` attachment), so those come back as 'either'.
type NamedResource = 'file' | 'instance' | 'either';

function namedResource(url: URL): NamedResource {
  if (urlNamesFile(url) || hasExecutableExtension(url.pathname)) {
    return 'file';
  }
  return isExtensionlessPath(url) ? 'instance' : 'either';
}

export function normalizeStoredDependency(
  dep: string,
  relativeTo: URL,
  virtualNetwork: VirtualNetwork,
  memo?: CanonicalURLMemo,
): string {
  return canonicalURL(dep, relativeTo.href, virtualNetwork, memo);
}

// Every stored form an in-realm relationship dependency can take. Invalidation
// matches a dep against a row URL by exact string, so a dep recorded in the
// wrong form matches nothing and writing the target never invalidates this
// consumer. Where `namedResource` can't tell a card id from a file, both
// candidate forms are recorded rather than one guessed: an unmatched dep costs
// a string, a missing one costs the consumer its invalidation.
export function relationshipDependencyForms(
  dep: string,
  relativeTo: URL,
  realmURL: URL,
  virtualNetwork: VirtualNetwork,
  memo?: CanonicalURLMemo,
): string[] {
  let canonical = canonicalURL(dep, relativeTo.href, virtualNetwork, memo);
  // Prefix-form deps (e.g. @cardstack/catalog/foo) are already canonical.
  // Resolve to check realm membership and add .json if needed.
  if (virtualNetwork.isRegisteredPrefix(canonical)) {
    let resolved = virtualNetwork.toURL(canonical).href;
    try {
      let parsed = new URL(resolved);
      if (parsed.href.startsWith(realmURL.href)) {
        return formsFor(canonical, `${canonical}.json`, namedResource(parsed));
      }
    } catch (_err) {
      // fall through
    }
    return [canonical];
  }
  try {
    let normalized = new URL(canonical);
    if (normalized.href.startsWith(realmURL.href)) {
      let instance = new URL(normalized.href);
      instance.pathname = `${instance.pathname}.json`;
      return formsFor(
        normalized.href,
        instance.href,
        namedResource(normalized),
      );
    }
    return [normalized.href];
  } catch (_err) {
    return [canonical];
  }
}

function formsFor(
  fileForm: string,
  instanceForm: string,
  named: NamedResource,
): string[] {
  switch (named) {
    case 'file':
      return [fileForm];
    case 'instance':
      return [instanceForm];
    case 'either':
      return [fileForm, instanceForm];
  }
}

// Traversal follows a dep to the index row named by that exact URL, so it takes
// every dep that could name one. An extensionless dep never does: it is a module
// reference in node-resolution form, whose errors reach a consumer through the
// definition cache instead. A dep that turns out to name no row is read as a
// miss and traversal stops there, so admitting one costs a lookup — which is why
// the ambiguous dotted names `namedResource` won't classify are admitted here.
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
