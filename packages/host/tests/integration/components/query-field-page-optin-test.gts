import { settled, type RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  PermissionsContextName,
  resetSearchBoundsForTests,
  setSearchBoundsForTests,
} from '@cardstack/runtime-common';
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

// The real ceilings are 500 and 2000, so exercising them honestly would mean
// indexing thousands of cards. These stand in at the same shape: a default low
// enough that a field taking it truncates, a maximum a few rows above it, and
// a match count that overruns both.
const DEFAULT_CEILING = 1;
const ABSOLUTE_MAX = 5;
const MATCH_COUNT = 7;

module('Integration | query-field page opt-in', function (hooks) {
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
    // Before the realm is indexed: the indexer's expansion reads these, and the
    // seed it writes is what the assertions below read back.
    setSearchBoundsForTests({
      serverMaxPageSize: DEFAULT_CEILING,
      serverAbsoluteMaxPageSize: ABSOLUTE_MAX,
    });

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
      // Declares no page, so it takes the default ceiling.
      @field capped = linksToMany(() => Person, {
        query: { filter: { eq: { name: '$this.cardTitle' } } },
      });
      // Declares one, which is the opt-in.
      @field optedIn = linksToMany(() => Person, {
        query: {
          filter: { eq: { name: '$this.cardTitle' } },
          page: { size: ABSOLUTE_MAX - 2 },
        },
      });
      // Declares more than the absolute maximum allows.
      @field overAsking = linksToMany(() => Person, {
        query: {
          filter: { eq: { name: '$this.cardTitle' } },
          page: { size: ABSOLUTE_MAX + 100 },
        },
      });
    }

    let people = Object.fromEntries(
      Array.from({ length: MATCH_COUNT }, (_v, i) => [
        `Person/${i}.json`,
        new Person({ name: 'Anchor' }),
      ]),
    );

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Host },
        ...people,
        'Host/anchor.json': new Host({ cardTitle: 'Anchor' }),
      },
    });
    await getService('realm').login(testRealmURL);
  });

  hooks.afterEach(function () {
    resetSearchBoundsForTests();
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

  test('a field declaring no page takes the default ceiling', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState } = cardApi;
    let status = getRelationshipMembershipState(await loadHost(), 'capped');

    assert.strictEqual(
      status.membership?.length,
      DEFAULT_CEILING,
      'it holds the default page',
    );
    assert.strictEqual(
      status.totalMatchCount,
      MATCH_COUNT,
      'while reporting every match behind it',
    );
    assert.true(status.isPartial, 'so it says it is holding a prefix');
  });

  test('a field declaring a larger page gets it', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState } = cardApi;
    let status = getRelationshipMembershipState(await loadHost(), 'optedIn');

    // The whole opt-in: the declared page is honored rather than clamped back
    // to the default, so the field holds more than a field that said nothing.
    assert.strictEqual(
      status.membership?.length,
      ABSOLUTE_MAX - 2,
      'the declared page size is what it holds',
    );
    assert.true(
      (status.membership?.length ?? 0) > DEFAULT_CEILING,
      'which is more than the default ceiling would have allowed',
    );
    assert.strictEqual(status.totalMatchCount, MATCH_COUNT);
    assert.true(
      status.isPartial,
      'still short of the full match set, and still saying so',
    );
  });

  test('a field declaring more than the maximum is clamped, and still indexes', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState } = cardApi;
    let status = getRelationshipMembershipState(await loadHost(), 'overAsking');

    // Clamped rather than rejected, for two reasons. The page is authored once
    // and read on every index of every instance, so rejecting it would make the
    // card unindexable instead of failing one request. And the same page is
    // applied by three separate legs — this expansion, a peer realm's
    // `_search`, and the client's live refresh — so a rejection on one of them
    // and a clamp on another is how a field resolves from its seed and then
    // fails the first time it refreshes.
    assert.strictEqual(
      status.membership?.length,
      ABSOLUTE_MAX,
      'it holds the maximum, not the size it asked for',
    );
    assert.strictEqual(status.totalMatchCount, MATCH_COUNT);
    assert.true(status.isPartial, 'and reports the shortfall');
  });
});
