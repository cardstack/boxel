import { afterEach, describe, expect } from 'vitest';
import {
  createExperimentalPermissionedRealmTest,
  type ExperimentalPermissionedRealmFixture,
} from '../helpers';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms';

type ExperimentalRealmTest = {
  concurrent: (
    name: string,
    fn: (context: {
      realm: ExperimentalPermissionedRealmFixture;
    }) => Promise<void>,
  ) => void;
};

const test = createExperimentalPermissionedRealmTest({
  realmURL: new URL('http://test-realm-types/test/'),
  serverURL: new URL('http://127.0.0.1:0/test/'),
  permissions: {
    '*': ['read', 'write'],
    '@node-test_realm:localhost': ['read', 'write', 'realm-owner'],
  },
}) as ExperimentalRealmTest;

afterEach(() => resetCatalogRealms());

describe('types-endpoint-test.ts', function () {
  describe('Realm-specific Endpoints | GET _types', function () {
    test.concurrent('can fetch card type summary', async ({ realm }) => {
      let response = await realm.request
        .get('/_types')
        .set('Accept', 'application/json');
      let iconHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="lucide lucide-captions" viewBox="0 0 24 24"><rect width="18" height="14" x="3" y="5" rx="2" ry="2"></rect><path d="M7 15h4m4 0h2M7 11h2m4 0h4"></path></svg>';
      let chessIconHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="lucide lucide-rectangle-ellipsis" viewBox="0 0 24 24"><rect width="20" height="12" x="2" y="6" rx="2"></rect><path d="M12 12h.01M17 12h.01M7 12h.01"></path></svg>';
      let sortCardTypeSummaries = (summaries: any[]) =>
        [...summaries].sort((a, b) => {
          let aName = a.attributes.displayName;
          let bName = b.attributes.displayName;
          if (aName === bName) {
            return a.id.localeCompare(b.id);
          }
          return aName.localeCompare(bName);
        });

      expect(response.status).toBe(200);
      let expectedData = [
        {
          type: 'card-type-summary',
          id: `${realm.testRealm.url}chess-gallery/ChessGallery`,
          attributes: {
            displayName: 'Chess Gallery',
            total: 3,
            iconHTML: chessIconHTML,
          },
        },
        {
          type: 'card-type-summary',
          id: `${realm.testRealm.url}family_photo_card/FamilyPhotoCard`,
          attributes: {
            displayName: 'Family Photo Card',
            total: 2,
            iconHTML,
          },
        },
        {
          type: 'card-type-summary',
          id: `${realm.testRealm.url}friend/Friend`,
          attributes: {
            displayName: 'Friend',
            total: 2,
            iconHTML,
          },
        },
        {
          type: 'card-type-summary',
          id: 'http://localhost:4202/node-test/friend-with-used-link/FriendWithUsedLink',
          attributes: {
            displayName: 'FriendWithUsedLink',
            total: 2,
            iconHTML,
          },
        },
        {
          type: 'card-type-summary',
          id: `${realm.testRealm.url}home/Home`,
          attributes: {
            displayName: 'Home',
            total: 1,
            iconHTML,
          },
        },
        {
          type: 'card-type-summary',
          id: `${realm.testRealm.url}person/Person`,
          attributes: {
            displayName: 'Person',
            total: 3,
            iconHTML,
          },
        },
        {
          type: 'card-type-summary',
          id: `${realm.testRealm.url}person-with-error/PersonCard`,
          attributes: {
            displayName: 'Person',
            total: 4,
            iconHTML,
          },
        },
        {
          type: 'card-type-summary',
          id: `${realm.testRealm.url}timers-card/TimersCard`,
          attributes: {
            displayName: 'TimersCard',
            total: 1,
            iconHTML,
          },
        },
      ];
      expect(sortCardTypeSummaries(response.body.data)).toEqual(
        sortCardTypeSummaries(expectedData),
      );
    });
  });
});
