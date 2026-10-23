import { isExactVersionRRI } from '@cardstack/deck';

import { rri, type RealmResourceIdentifier } from './realm-identifiers.ts';

export interface ExactVersionTransport {
  identifier: RealmResourceIdentifier;
  mutableURL: URL;
  packageURL: URL;
}

/**
 * Decode Deck's official `/<scope>/<name>@<version>/<path>` transport shape.
 * The origin and any path prefix are delivery details; package identity stays
 * in the returned RRI.
 */
export function parseExactVersionTransportURL(
  input: string | URL,
): ExactVersionTransport | undefined {
  let transportURL: URL;
  try {
    transportURL = new URL(input);
  } catch {
    return undefined;
  }
  transportURL.search = '';
  transportURL.hash = '';
  let segments = transportURL.pathname.split('/').filter(Boolean);
  let packageIndex = segments.findIndex((segment, index) => {
    if (index === 0) {
      return false;
    }
    let separator = segment.lastIndexOf('@');
    return separator > 0 && /^\d/.test(segment.slice(separator + 1));
  });
  if (packageIndex < 1) {
    return undefined;
  }
  let packageAndVersion = segments[packageIndex];
  let separator = packageAndVersion.lastIndexOf('@');
  let scope = segments[packageIndex - 1];
  let name = packageAndVersion.slice(0, separator);
  let version = packageAndVersion.slice(separator + 1);
  let path = segments.slice(packageIndex + 1).join('/');
  let identifier = `@${scope}/${name}@${version}/${path}`;
  if (!isExactVersionRRI(identifier)) {
    return undefined;
  }
  let mutableURL = new URL(transportURL);
  mutableURL.pathname = `/${[...segments.slice(0, packageIndex), name].join(
    '/',
  )}/`;
  let packageURL = new URL(transportURL);
  packageURL.pathname = `/${segments.slice(0, packageIndex + 1).join('/')}/`;
  return { identifier: rri(identifier), mutableURL, packageURL };
}
