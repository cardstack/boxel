import type { LooseCardResource, FileMetaResource } from './index.ts';
import { relationshipEntries } from './relationship-utils.ts';
import { RealmPaths } from './paths.ts';
import type {
  RealmIdentifier,
  RealmResourceIdentifier,
} from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';

export function maybeURL(
  possibleURL: string,
  relativeTo?: string | URL | undefined,
): URL | undefined {
  try {
    return new URL(possibleURL, relativeTo);
  } catch (e: any) {
    if (e.message.includes('Invalid URL')) {
      return undefined;
    }
    throw e;
  }
}

export function relativeReference(
  reference: RealmResourceIdentifier | URL,
  relativeTo: RealmResourceIdentifier | URL,
  realm: RealmIdentifier | URL | undefined,
): string | undefined {
  let referenceStr = reference instanceof URL ? reference.href : reference;
  let relativeToStr = relativeTo instanceof URL ? relativeTo.href : relativeTo;

  // Path math is meaningful only past a shared namespace prefix — URL origin
  // for URL pairs, `@scope/name` for scoped RRI pairs. Cross-form pairs can't
  // be relativized without resolving back to URL space (which we deliberately
  // avoid here so this module doesn't depend on prefixMappings).
  let namespace = sharedNamespace(referenceStr, relativeToStr);
  if (namespace === undefined) {
    return undefined;
  }

  if (realm) {
    // Branch so each arm resolves to one of RealmPaths' constructor
    // overloads — a union argument doesn't match either overload alone.
    let realmPath =
      realm instanceof URL ? new RealmPaths(realm) : new RealmPaths(realm);
    // don't return a relative reference for a resource that escapes our realm
    if (realmPath.inRealm(relativeTo) && !realmPath.inRealm(reference)) {
      return undefined;
    }
  }

  let ourParts = referenceStr.slice(namespace.length).split('/');
  let theirParts = relativeToStr.slice(namespace.length).split('/');

  let lastPart: string | undefined;
  while (
    ourParts[0] === theirParts[0] &&
    ourParts.length > 0 &&
    theirParts.length > 0
  ) {
    lastPart = ourParts.shift();
    theirParts.shift();
  }
  if (theirParts.length > 1) {
    theirParts.shift();
    let relative = [...theirParts.map(() => '..'), ...ourParts].join('/');
    return relative === '.' && lastPart ? `./${lastPart}` : relative;
  } else {
    let relative = ['.', ...ourParts].join('/');
    return relative === '.' && lastPart ? `./${lastPart}` : relative;
  }
}

function isURLForm(s: string): boolean {
  return s.startsWith('http://') || s.startsWith('https://');
}

function sharedNamespace(a: string, b: string): string | undefined {
  let aURL = isURLForm(a);
  let bURL = isURLForm(b);

  if (aURL && bURL) {
    try {
      let aOrigin = new URL(a).origin;
      let bOrigin = new URL(b).origin;
      if (aOrigin === bOrigin) {
        return aOrigin;
      }
    } catch {
      // fall through to undefined
    }
    return undefined;
  }

  if (!aURL && !bURL) {
    // Scoped RRIs share a namespace when their first two `/`-separated
    // segments match (e.g. both start with `@cardstack/base/`). We don't
    // consult a prefix registry here so the algorithm stays string-only.
    let aParts = a.split('/');
    let bParts = b.split('/');
    if (
      aParts.length >= 2 &&
      bParts.length >= 2 &&
      aParts[0] === bParts[0] &&
      aParts[1] === bParts[1]
    ) {
      return `${aParts[0]}/${aParts[1]}`;
    }
    return undefined;
  }

  // Mixed forms: would need cross-form resolution, which this module avoids.
  return undefined;
}

export function maybeRelativeReference(
  reference: RealmResourceIdentifier | URL,
  relativeTo: RealmResourceIdentifier | URL,
  realm: RealmIdentifier | URL | undefined,
): string {
  let rel = relativeReference(reference, relativeTo, realm);
  if (rel) {
    return rel;
  }
  // Preserve the input form on fallback: prefix-form RRIs are already in
  // canonical portable form, so return them as-is; URLs return their href.
  return reference instanceof URL ? reference.href : reference;
}

export function trimJsonExtension(str: string) {
  return str.replace(/\.json$/, '');
}

export function removeFileExtension(fileURL: string | undefined) {
  return fileURL?.replace(/\.[^/.]+$/, '');
}

export function hasExtension(value: string) {
  try {
    let pathname = new URL(value).pathname;
    let lastSegment = pathname.split('/').pop() ?? '';
    let lastDotIndex = lastSegment.lastIndexOf('.');
    return lastDotIndex > 0 && lastDotIndex < lastSegment.length - 1;
  } catch {
    let path = value.split(/[?#]/)[0];
    let lastSegment = path.split('/').pop() ?? '';
    let lastDotIndex = lastSegment.lastIndexOf('.');
    return lastDotIndex > 0 && lastDotIndex < lastSegment.length - 1;
  }
}

// Converts all instance URLs in a card resource from resolved HTTP URLs
// to registered prefix form (e.g. @cardstack/catalog/...) where applicable.
// Handles: resource.id, links.self, relationship links.self, relationship data.id/data[].id
export function unresolveResourceInstanceURLs(
  resourceJson: LooseCardResource | FileMetaResource,
  virtualNetwork: VirtualNetwork,
): void {
  if (resourceJson.id) {
    resourceJson.id = virtualNetwork.unresolveURL(resourceJson.id);
  }
  if (resourceJson.links) {
    let links = resourceJson.links;
    if (links.self) {
      links.self = virtualNetwork.unresolveURL(links.self);
    }
  }
  let relationships = resourceJson.relationships;
  if (relationships) {
    for (let { relationship } of relationshipEntries(relationships)) {
      let links = relationship.links;
      if (links && links.self) {
        links.self = virtualNetwork.unresolveURL(links.self);
      }
      let data = relationship.data;
      if (data && typeof data === 'object') {
        if (Array.isArray(data)) {
          for (let item of data) {
            if (item && typeof item === 'object' && 'id' in item) {
              let typedItem = item as { id?: string };
              if (typeof typedItem.id === 'string') {
                typedItem.id = virtualNetwork.unresolveURL(typedItem.id);
              }
            }
          }
        } else if ('id' in data) {
          let typedData = data as { id?: string };
          if (typeof typedData.id === 'string') {
            typedData.id = virtualNetwork.unresolveURL(typedData.id);
          }
        }
      }
    }
  }
}

type VisitInstanceURL = (
  instanceURL: string,
  setInstanceURL: (newURL: string) => void,
) => void;

export function visitInstanceURLs(
  resourceJson: LooseCardResource | FileMetaResource,
  visit: VisitInstanceURL,
): void {
  if (resourceJson.links) {
    let links = resourceJson.links;
    if (links.self) {
      visit(links.self, (newURL) => {
        links.self = newURL;
      });
    }
  }
  let relationships = resourceJson.relationships;
  if (relationships) {
    for (let { relationship } of relationshipEntries(relationships)) {
      let links = relationship.links;
      if (links && links.self) {
        visit(links.self, (newURL) => {
          links.self = newURL;
        });
      }
    }
  }
}
