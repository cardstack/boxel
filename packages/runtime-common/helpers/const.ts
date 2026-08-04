import {
  rri,
  type RealmIdentifier,
  type RealmResourceIdentifier,
} from '../realm-identifiers.ts';
import type { RealmInfo } from '../index.ts';
export const testRealmURL = 'http://test-realm/test/' as RealmIdentifier;
export const testHostModeRealmURL =
  'http://test-realm/user/test/' as RealmIdentifier;

/**
 * Build a `RealmResourceIdentifier` for a path inside the default test realm.
 * Equivalent to `` rri(`${testRealmURL}${path}`) `` but shorter at call sites.
 */
export function testRRI(path: string): RealmResourceIdentifier {
  return rri(`${testRealmURL}${path}`);
}

export const testRealmInfo: RealmInfo = {
  name: 'Unnamed Workspace',
  backgroundURL: null,
  iconURL: null,
  showAsCatalog: null,
  visibility: 'public',
  realmUserId: '@realm_server:localhost',
  publishable: null,
  lastPublishedAt: null,
  includePrerenderedDefaultRealmIndex: null,
};

// `/_federated-info` serves `testRealmInfo`'s shape plus these realm-lifecycle
// timestamps (see `Realm#getDetailedRealmInfo`); the per-realm `/_info` does
// not. Their values depend on wall-clock time, so a fixture can't pin them —
// split them off and assert them on their own terms.
//
// Index counts are NOT here: they have their own route,
// `/_federated-index-counts`, and their own shape.
export const realmInfoExtraKeys = ['createdAt', 'updatedAt'] as const;

export function withoutRealmInfoExtras(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  let rest = { ...attributes };
  for (let key of realmInfoExtraKeys) {
    delete rest[key];
  }
  return rest;
}
