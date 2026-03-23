import type { LooseCardResource, FileMetaResource } from './index';
import { relationshipEntries } from './relationship-utils';
import { RealmPaths } from './paths';
import { unresolveCardReference } from './card-reference-resolver';

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

export function relativeURL(
  url: URL,
  relativeTo: URL,
  realmURL: URL | undefined,
): string | undefined {
  if (url.origin !== relativeTo.origin) {
    return undefined;
  }
  if (realmURL) {
    let realmPath = new RealmPaths(realmURL);
    // don't return a relative URL for URL that is outside of our realm
    if (realmPath.inRealm(relativeTo) && !realmPath.inRealm(url)) {
      return undefined;
    }
  }
  let ourParts = url.pathname.split('/');
  let theirParts = relativeTo.pathname.split('/');

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

export function maybeRelativeURL(
  url: URL,
  relativeTo: URL,
  realmURL: URL | undefined,
): string {
  let rel = relativeURL(url, relativeTo, realmURL);
  if (rel) {
    return rel;
  } else {
    return url.href;
  }
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
): void {
  if (resourceJson.id) {
    resourceJson.id = unresolveCardReference(resourceJson.id);
  }
  if (resourceJson.links) {
    let links = resourceJson.links;
    if (links.self) {
      links.self = unresolveCardReference(links.self);
    }
  }
  let relationships = resourceJson.relationships;
  if (relationships) {
    for (let { relationship } of relationshipEntries(relationships)) {
      let links = relationship.links;
      if (links && links.self) {
        links.self = unresolveCardReference(links.self);
      }
      let data = relationship.data;
      if (data && typeof data === 'object') {
        if (Array.isArray(data)) {
          for (let item of data) {
            if (item && typeof item === 'object' && 'id' in item) {
              let typedItem = item as { id?: string };
              if (typeof typedItem.id === 'string') {
                typedItem.id = unresolveCardReference(typedItem.id);
              }
            }
          }
        } else if ('id' in data) {
          let typedData = data as { id?: string };
          if (typeof typedData.id === 'string') {
            typedData.id = unresolveCardReference(typedData.id);
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
