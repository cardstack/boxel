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

  // element zero for both is "/" because they always start with a slash check
  // element 1, if those differ, our nears common ancestor is the root of the
  // origin. In the case where the relativeTo is a entry in the origin, favor
  // using "./" to express the relative path.
  if (ourParts[1] !== theirParts[1] && theirParts.length > 2) {
    return url.pathname;
  }

  while (
    ourParts[0] === theirParts[0] &&
    ourParts.length > 0 &&
    theirParts.length > 0
  ) {
    ourParts.shift();
    theirParts.shift();
  }
  if (theirParts.length > 1) {
    theirParts.shift();
    return [...theirParts.map(() => '..'), ...ourParts].join('/');
  } else {
    return ['.', ...ourParts].join('/');
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
