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
  linksTo,
  linksToMany,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';

const HOST_URL = `${testRealmURL}Host/anchor`;

module('Integration | query-field relationship status', function (hooks) {
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
    // Two people share the name the host queries for, so a singular
    // query-backed field has a result set larger than the one slot it surfaces.
    class Host extends CardDef {
      static displayName = 'Host';
      @field cardTitle = contains(StringField);
      @field favorite = linksTo(() => Person, {
        query: { filter: { eq: { name: '$this.cardTitle' } } },
      });
      @field matches = linksToMany(() => Person, {
        query: { filter: { eq: { name: '$this.cardTitle' } } },
      });
      @field deferred = linksToMany(() => Person, {
        query: { filter: { eq: { name: '$this.cardTitle' } } },
        eager: false,
      });
      // A page smaller than the match count, which is what a query field over
      // the server's ceiling reduces to: the field holds a prefix of what it
      // matched. One row against two matches exercises that without indexing
      // the several hundred cards the real ceiling would need.
      @field firstMatch = linksToMany(() => Person, {
        query: {
          filter: { eq: { name: '$this.cardTitle' } },
          page: { size: 1 },
        },
      });
      @field declared = linksToMany(() => Person);
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

  async function loadHost(): Promise<CardDefType> {
    let host = (await getService('store').get(HOST_URL)) as CardDefType;
    await settled();
    return host;
  }

  test('a singular query-backed field reports the one slot it surfaces, not the whole result set', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState } = cardApi;
    let host = (await loadHost()) as CardDefType & { favorite: unknown };

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
    let { getRelationshipMembershipState } = cardApi;
    let host = await loadHost();

    // `deferred` opts out of resolving with its owner, so nothing has resolved
    // it: it reports neither loading nor loaded, the state `isLoading` alone
    // cannot tell apart from a settled empty result.
    let deferred = getRelationshipMembershipState(host, 'deferred');
    assert.false(deferred.isLoading, 'an unresolved field is not loading');
    assert.false(deferred.isLoaded, 'and it is not loaded either');
    assert.strictEqual(
      deferred.membership,
      undefined,
      'an unresolved field has no membership',
    );

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
    let { getRelationshipMembershipState } = cardApi;
    let host = (await loadHost()) as CardDefType & { deferred: unknown[] };

    assert.false(
      getRelationshipMembershipState(host, 'deferred').isLoaded,
      'loading the owner does not resolve a field that opted out',
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
  test('isLoaded never claims a result set the seed has not applied yet', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState } = cardApi;
    // Deliberately unsettled: the owner's document has arrived and its seed is
    // being applied, which is the window where the resource holds an empty
    // result set it is about to replace.
    let host = (await getService('store').get(HOST_URL)) as CardDefType;

    let status = getRelationshipMembershipState(host, 'matches');
    let claimsAnIncompleteSet =
      status.isLoaded && status.membership?.length !== 2;
    assert.false(
      claimsAnIncompleteSet,
      'isLoaded is claimed only once the membership is the real one',
    );

    await settled();
    let settledStatus = getRelationshipMembershipState(host, 'matches');
    assert.true(settledStatus.isLoaded, 'and it is claimed once settled');
    assert.strictEqual(settledStatus.membership?.length, 2);
  });

  test('a field whose page cuts its result set short reports the shortfall', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState } = cardApi;
    let host = await loadHost();

    let status = getRelationshipMembershipState(host, 'firstMatch');
    assert.true(status.isLoaded, 'the field settled');
    assert.strictEqual(
      status.membership?.length,
      1,
      'and holds the one row its page allowed',
    );
    assert.strictEqual(
      status.totalMatchCount,
      2,
      'while reporting what the query actually matched',
    );
    assert.true(
      status.isPartial,
      'so a rollup reducing over the rows is short by one',
    );
  });

  test('a field holding its whole result set reports no shortfall', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState } = cardApi;
    let host = await loadHost();

    let status = getRelationshipMembershipState(host, 'matches');
    assert.strictEqual(status.membership?.length, 2);
    assert.strictEqual(
      status.totalMatchCount,
      2,
      'the count agrees with the membership',
    );
    assert.false(status.isPartial, 'so nothing was cut short');
  });

  test('an unresolved field claims no shortfall', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState } = cardApi;
    let host = await loadHost();

    // `deferred` opts out of resolving with its owner. `isPartial` asserts a
    // membership falls short of a known total, and neither is known here.
    let status = getRelationshipMembershipState(host, 'deferred');
    assert.strictEqual(status.totalMatchCount, undefined);
    assert.false(status.isPartial);
  });

  test('a singular query-backed field reports no match count', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState } = cardApi;
    let host = await loadHost();

    // Its query is forced to one row and it surfaces that first match by
    // design, so the two matches behind it are the field working as declared —
    // reporting them would make every singular query field look truncated.
    let status = getRelationshipMembershipState(host, 'favorite');
    assert.strictEqual(status.membership?.length, 1);
    assert.strictEqual(status.totalMatchCount, undefined);
    assert.false(status.isPartial);
  });

  test('a declared linksToMany reports no match count', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState } = cardApi;
    let host = await loadHost();

    // It holds exactly the targets its document names — no query behind it, so
    // no page that could cut one short.
    let status = getRelationshipMembershipState(host, 'declared');
    assert.true(status.isLoaded);
    assert.strictEqual(status.totalMatchCount, undefined);
    assert.false(status.isPartial);
  });
});
