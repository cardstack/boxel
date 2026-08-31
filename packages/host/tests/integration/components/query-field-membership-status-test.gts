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
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-cards.gts': { Person, Host },
        'Person/one.json': new Person({ name: 'Anchor' }),
        'Person/two.json': new Person({ name: 'Anchor' }),
        // Deliberately outside the query. A live search can never return this
        // card, so its presence in the field is proof a seed put it there.
        'Person/three.json': new Person({ name: 'Different' }),
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

  test('a document fetched after the field resolved hands it the fresher result set', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState, updateFromSerialized } = cardApi;
    let network = getService('network');
    let host = await loadHost();

    assert.strictEqual(
      getRelationshipMembershipState(host, 'matches').membership?.length,
      2,
      'the field resolves to the two cards the query matches',
    );

    // Start from the document the realm actually serves — the server resolves
    // query fields at read time, so this carries `matches` already resolved —
    // and splice in a third member. The spliced card claims a name the query
    // matches, while the copy the realm indexed does not, so a search can never
    // return it: the field can only hold it if this document put it there.
    // (It has to claim a matching name because the resource reconciles its
    // result set against the filter and drops rows that fail it.)
    let asJSON = async (url: string) =>
      await (
        await network.authedFetch(url, {
          headers: { Accept: 'application/vnd.card+json' },
        })
      ).json();
    let hostDoc = await asJSON(HOST_URL);

    // Clone a member the document already carries and repoint it at the third
    // card, so the spliced entry and its relationship reference are spelled the
    // way this document spells every other one.
    let template = hostDoc.included.find((resource: { id: string }) =>
      resource.id.endsWith('Person/one'),
    );
    let spliced = JSON.parse(JSON.stringify(template));
    spliced.id = template.id.replace('Person/one', 'Person/three');
    hostDoc.included.push(spliced);
    hostDoc.data.relationships.matches.data.push({
      type: 'card',
      id: spliced.id,
    });

    await updateFromSerialized(host as any, hostDoc);
    await settled();

    let matches = getRelationshipMembershipState(host, 'matches');
    assert.strictEqual(
      matches.membership?.length,
      3,
      'the newer document supersedes the result set the resource was holding',
    );
    assert.true(
      matches.membership?.some(
        (member) =>
          member.kind === 'present' &&
          member.reference.endsWith('Person/three'),
      ),
      'including the card no live search for this query could return',
    );
  });
});
