import type { RealmInfo } from '../index';
export const testRealmURL = `http://test-realm/test/`;
export const testHostModeRealmURL = 'http://test-realm/user/test/';

export function testRealmURLToUsername(realmURLString: string) {
  let realmURL = new URL(realmURLString);
  let realmUsername = `@realm/${realmURL.host}${realmURL.pathname
    .replace('/', '-')
    .replace(/\/$/, '')}:localhost`;

  return realmUsername;
}

export const testRealmInfo: RealmInfo = {
  name: 'Unnamed Workspace',
  backgroundURL: null,
  iconURL: null,
  showAsCatalog: null,
  interactHome: null,
  hostHome: null,
  visibility: 'public',
  realmUserId: testRealmURLToUsername(testRealmURL),
  publishable: null,
  lastPublishedAt: null,
};
