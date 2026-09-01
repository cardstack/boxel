import { settled, type RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, PermissionsContextName } from '@cardstack/runtime-common';
import type { Permissions } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  provideConsumeContext,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import {
  CardDef,
  contains,
  field,
  linksToMany,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

const HOST_URL = `${testRealmURL}Host/anchor`;
// A realm nothing serves. `.invalid` is reserved never to resolve, so the
// query's request to it fails rather than reaching some other host.
const UNREACHABLE_REALM_URL = 'https://example.invalid/offline/';

// A realm that fails contributes its error and no rows, so a field spanning it
// settles holding only what the reachable realms returned. That set is short,
// and by exactly the amount the failure withheld — which is why no count comes
// back with it. Kept in its own module because resolving the field makes a
// request that is meant to fail.
module('Integration | query-field unreachable realm', function (hooks) {
  let loader: Loader;
  let cardApi: typeof import('@cardstack/base/card-api');

  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    let permissions: Permissions = { canWrite: true, canRead: true };
    provideConsumeContext(PermissionsContextName, permissions);
    loader = getService('loader-service').loader;
    cardApi = await loader.import('@cardstack/base/card-api');

    class Person extends CardDef {
      static displayName = 'Person';
      @field name = contains(StringField);
    }
    class Host extends CardDef {
      static displayName = 'Host';
      @field cardTitle = contains(StringField);
      // Spans a realm that answers and one that cannot.
      @field crossRealmMatches = linksToMany(() => Person, {
        query: {
          filter: { eq: { name: '$this.cardTitle' } },
          realms: [testRealmURL, UNREACHABLE_REALM_URL],
        },
      });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Host },
        'Person/one.json': new Person({ name: 'Anchor' }),
        'Person/two.json': new Person({ name: 'Anchor' }),
        'Host/anchor.json': new Host({ cardTitle: 'Anchor' }),
      },
    });
    await getService('realm').login(testRealmURL);
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  test('a field missing a realm reports a shortfall it cannot measure', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState } = cardApi;
    let host = (await getService('store').get(HOST_URL)) as CardDefType;
    await settled();

    let status = getRelationshipMembershipState(host, 'crossRealmMatches');
    assert.true(status.isLoaded, 'the field settled on what it could reach');
    assert.strictEqual(
      status.membership?.length,
      2,
      "holding the reachable realm's matches",
    );
    assert.strictEqual(
      status.totalMatchCount,
      undefined,
      'with no count, because the failed realm never reported its share',
    );
    // Without this the field reads `isLoaded: true, isPartial: false` over a
    // set missing an entire realm — settled, and claiming to be whole, which
    // is the reading a rollup treats as final.
    assert.true(
      status.isPartial,
      'and still saying the rows are not the whole match set',
    );
  });
});
