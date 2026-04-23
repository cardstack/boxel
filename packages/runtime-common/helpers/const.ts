import type { RealmIdentifier } from '../card-reference-resolver';
import type { RealmInfo } from '../index';
export const testRealmURL = 'http://test-realm/test/' as RealmIdentifier;
export const testHostModeRealmURL =
  'http://test-realm/user/test/' as RealmIdentifier;

export const testRealmInfo: RealmInfo = {
  name: 'Unnamed Workspace',
  backgroundURL: null,
  iconURL: null,
  showAsCatalog: null,
  interactHome: null,
  hostHome: null,
  visibility: 'public',
  realmUserId: '@realm_server:localhost',
  publishable: null,
  lastPublishedAt: null,
};
