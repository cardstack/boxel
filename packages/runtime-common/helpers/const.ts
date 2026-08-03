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

// The info endpoints (`/_info`, `/_federated-info`) serve `testRealmInfo`'s
// shape plus these — realm-lifecycle timestamps and index counts, whose values
// depend on realm contents and wall-clock time (see
// `Realm#getDetailedRealmInfo`). A fixture can't pin them, so split them off
// and assert them on their own terms.
export const realmInfoExtraKeys = [
  'createdAt',
  'updatedAt',
  'cardCount',
  'fileCount',
  'definitionCount',
] as const;

export function withoutRealmInfoExtras(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  let rest = { ...attributes };
  for (let key of realmInfoExtraKeys) {
    delete rest[key];
  }
  return rest;
}
