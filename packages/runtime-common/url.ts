import type { LooseCardResource, FileMetaResource } from './index';
import { relationshipEntries } from './relationship-utils';
import { RealmPaths } from './paths';

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
    return (new URL(value).pathname.split('/').pop() ?? '').includes('.');
  } catch {
    return value.includes('.');
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
