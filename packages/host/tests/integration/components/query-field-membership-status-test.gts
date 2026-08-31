import { getOwner } from '@ember/owner';
import { settled, type RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, PermissionsContextName } from '@cardstack/runtime-common';
import type { Permissions } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import RealmService from '@cardstack/host/services/realm';

import {
  provideConsumeContext,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

// Resolves to the in-process test realm so the runtime treats the cards built
// below as belonging to it, which is what lets `$this.cardTitle` interpolate.
class StubRealmService extends RealmService {
  realmOf(_input: URL | string) {
    return testRealmURL;
  }
}

module('Integration | query-field relationship status', function (hooks) {
  let loader: Loader;
  let cardApi: typeof import('@cardstack/base/card-api');
  let string: typeof import('@cardstack/base/string');

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
    getOwner(this)!.register('service:realm', StubRealmService);

    loader = getService('loader-service').loader;
    cardApi = await loader.import('@cardstack/base/card-api');
    string = await loader.import('@cardstack/base/string');
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  // Two people share the name the host queries for, so a singular
  // query-backed field has a result set larger than the one slot it surfaces.
  async function setupRealm() {
    let { contains, field, CardDef, linksTo, linksToMany } = cardApi;
    let { default: StringField } = string;

    class Person extends CardDef {
      static displayName = 'Person';
      @field name = contains(StringField);
    }
    class Host extends CardDef {
      static displayName = 'Host';
      @field cardTitle = contains(StringField);
      @field favorite = linksTo(() => Person, {
        query: {
          filter: { eq: { name: '$this.cardTitle' } },
        },
      });
      @field matches = linksToMany(() => Person, {
        query: {
          filter: { eq: { name: '$this.cardTitle' } },
        },
      });
      @field deferred = linksToMany(() => Person, {
        query: {
          filter: { eq: { name: '$this.cardTitle' } },
        },
        eager: false,
      });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Host },
        'Person/one.json': new Person({ name: 'Anchor' }),
        'Person/two.json': new Person({ name: 'Anchor' }),
      },
    });

    return { Host, Person };
  }

  async function makeHost(cardTitle: string): Promise<CardDefType> {
    let { createFromSerialized } = cardApi;
    let resource = {
      attributes: { cardTitle },
      meta: {
        adoptsFrom: { module: testRRI('test-cards'), name: 'Host' },
      },
    };
    return (await createFromSerialized(
      resource as any,
      { data: resource } as any,
      new URL(testRealmURL),
    )) as CardDefType;
  }

  test('a singular query-backed field reports the one slot it surfaces, not the whole result set', async function (this: RenderingTestContext, assert) {
    await setupRealm();
    let { getRelationshipMembershipState } = cardApi;
    let host = (await makeHost('Anchor')) as CardDefType & {
      favorite: unknown;
      matches: unknown[];
    };
    await settled();

    let plural = getRelationshipMembershipState(host, 'matches');
    assert.strictEqual(
      plural.membership?.length,
      2,
      'the query matches both people, so the plural field holds both',
    );

    let singular = getRelationshipMembershipState(host, 'favorite');
    assert.strictEqual(
      singular.membership?.length,
      1,
      'the singular field reports one slot even though the query matched two',
    );
    assert.strictEqual(
      singular.membership?.[0].kind,
      'present',
      'that slot holds the result the getter surfaces',
    );
    assert.strictEqual(
      singular.membership?.[0].value,
      host.favorite,
      'membership and the field getter agree on which result it is',
    );
  });

  test('isLoaded separates an unresolved field from a settled one', async function (this: RenderingTestContext, assert) {
    await setupRealm();
    let { getRelationshipMembershipState } = cardApi;
    let host = (await makeHost('Anchor')) as CardDefType;

    // `deferred` opts out of resolving with its owner, so nothing has
    // resolved it and it reports neither loading nor loaded — the state
    // `isLoading` alone cannot tell from a settled empty result.
    let deferred = getRelationshipMembershipState(host, 'deferred');
    assert.false(deferred.isLoading, 'an unresolved field is not loading');
    assert.false(deferred.isLoaded, 'and it is not loaded either');
    assert.strictEqual(
      deferred.membership,
      undefined,
      'an unresolved field has no membership',
    );

    await settled();

    let matches = getRelationshipMembershipState(host, 'matches');
    assert.false(matches.isLoading, 'a settled field is not loading');
    assert.true(matches.isLoaded, 'and it is loaded');
    assert.strictEqual(
      matches.membership?.length,
      2,
      'a loaded field carries its membership',
    );
  });

  test('a field that opts out of eager resolution resolves on first read', async function (this: RenderingTestContext, assert) {
    await setupRealm();
    let { getRelationshipMembershipState } = cardApi;
    let host = (await makeHost('Anchor')) as CardDefType & {
      deferred: unknown[];
    };
    await settled();

    assert.false(
      getRelationshipMembershipState(host, 'deferred').isLoaded,
      'settling the owner does not resolve a field that opted out',
    );

    // Reading the field is what starts its search.
    host.deferred;
    await settled();

    let deferred = getRelationshipMembershipState(host, 'deferred');
    assert.true(deferred.isLoaded, 'reading the field resolves it');
    assert.strictEqual(
      deferred.membership?.length,
      2,
      'and it carries the same membership as its eager twin',
    );
  });
});
