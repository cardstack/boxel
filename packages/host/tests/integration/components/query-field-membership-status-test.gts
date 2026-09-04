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
        // Deliberately outside the query. A live search can never return this
        // card, so its presence in the field is proof a document put it there.
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

  // The document the realm serves for the host card, which carries every
  // query-backed field resolved as of that read.
  async function fetchHostDoc(): Promise<any> {
    let response = await getService('network').authedFetch(HOST_URL, {
      headers: { Accept: 'application/vnd.card+json' },
    });
    return await response.json();
  }

  // Add `Person/three` to the host document's `matches`, spelled the way the
  // realm spells the members it already carries: the resolved instance in
  // `included`, an id in the umbrella relationship's `data`, a per-member
  // `matches.N` entry (which is what the deserializer reads), and a match total
  // covering all three, so the document describes three matches rather than
  // contradicting itself.
  function spliceThirdMember(hostDoc: any): void {
    let relationships = hostDoc.data.relationships;
    let template = hostDoc.included.find((resource: { id: string }) =>
      resource.id.endsWith('Person/one'),
    );
    let spliced = JSON.parse(JSON.stringify(template));
    spliced.id = template.id.replace('Person/one', 'Person/three');
    hostDoc.included.push(spliced);

    let umbrella = relationships.matches;
    umbrella.data.push({ type: 'card', id: spliced.id });
    umbrella.meta = { ...umbrella.meta, total: umbrella.data.length };
    relationships[`matches.${umbrella.data.length - 1}`] = {
      links: { self: spliced.id },
      data: { type: 'card', id: spliced.id },
    };
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

  test('a document fetched after the field resolved hands it the fresher result set', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState, updateFromSerialized } = cardApi;
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
    // return it: the field can only hold it if this document put it there. (It
    // has to claim a matching name because the resource reconciles its result
    // set against the filter and drops rows that fail it.)
    let hostDoc = await fetchHostDoc();
    spliceThirdMember(hostDoc);

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

  test('a document reporting a higher match count refreshes a page-clamped field', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState, updateFromSerialized } = cardApi;
    let host = await loadHost();

    let before = getRelationshipMembershipState(host, 'firstMatch');
    assert.strictEqual(before.totalMatchCount, 2, 'two matches are reported');

    // `firstMatch` holds one row whatever its query matches, so a match count
    // that moves leaves its rows and its query URL untouched — the count is the
    // only thing that changed, and it is what says the rows fall short.
    let hostDoc = await fetchHostDoc();
    hostDoc.data.relationships.firstMatch.meta = { total: 3 };

    await updateFromSerialized(host as any, hostDoc);
    await settled();

    let after = getRelationshipMembershipState(host, 'firstMatch');
    assert.strictEqual(
      after.membership?.length,
      1,
      'the field still holds the one row its page allowed',
    );
    assert.strictEqual(
      after.totalMatchCount,
      3,
      'against the count the newer document reports',
    );
    assert.true(after.isPartial, 'so the shortfall is still reported');

    // The field tracks whichever document arrived last rather than latching on
    // the identities it has seen, so a count that moves back is applied too.
    await updateFromSerialized(host as any, await fetchHostDoc());
    await settled();
    assert.strictEqual(
      getRelationshipMembershipState(host, 'firstMatch').totalMatchCount,
      2,
      'and a document restoring the earlier count is applied in turn',
    );
  });

  test('a document that did not resolve the field cannot displace a result set', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState, updateFromSerialized } = cardApi;
    let host = await loadHost();

    // `links.search` is written only where the indexer resolved the field, so
    // its absence marks a relationship this document is not authoritative
    // about — a raw source file's own `data`, say. Stripping it while narrowing
    // the field to a single member makes displacement unmistakable: a field
    // that took this document's word for its membership would drop to one.
    let hostDoc = await fetchHostDoc();
    let relationships = hostDoc.data.relationships;
    delete relationships.matches.links.search;
    relationships.matches.data = [relationships.matches.data[0]];
    relationships.matches.meta = { total: 1 };
    delete relationships['matches.1'];

    await updateFromSerialized(host as any, hostDoc);
    await settled();

    assert.strictEqual(
      getRelationshipMembershipState(host, 'matches').membership?.length,
      2,
      'the field keeps the result set the indexer resolved',
    );
  });

  test('a document reporting an unreachable realm sends the field back to a live query', async function (this: RenderingTestContext, assert) {
    let { getRelationshipMembershipState, updateFromSerialized } = cardApi;
    let network = getService('network');
    let host = await loadHost();
    assert.strictEqual(
      getRelationshipMembershipState(host, 'matches').membership?.length,
      2,
      'the field resolves from the document without querying',
    );

    let searchRequests: string[] = [];
    let spy = async (request: Request) => {
      if (new URL(request.url).pathname.endsWith('/_federated-search')) {
        searchRequests.push(request.url);
      }
      // Fall through to the realm-server mock.
      return null;
    };
    network.virtualNetwork.mount(spy, { prepend: true });
    try {
      // A realm that failed contributes its error and no rows, so what this
      // document carries is a floor rather than an answer. Resolving from it
      // and stopping there would leave the field short with nothing scheduled
      // to correct it.
      let hostDoc = await fetchHostDoc();
      let matches = hostDoc.data.relationships.matches;
      matches.meta = {
        ...matches.meta,
        errors: [
          {
            realm: 'http://unreachable-realm/test/',
            type: 'realm-unreachable',
            message: 'realm did not answer',
          },
        ],
      };

      await updateFromSerialized(host as any, hostDoc);
      await settled();

      assert.strictEqual(
        searchRequests.length,
        1,
        'the field runs the query the failed realm left unanswered',
      );
    } finally {
      network.virtualNetwork.unmount(spy);
    }
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
