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
