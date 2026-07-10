import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  PermissionsContextName,
  type Permissions,
  type SerializedError,
} from '@cardstack/runtime-common';
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

import type {
  RelationshipState,
  RelationshipStatus,
} from '@cardstack/base/card-api';
import type { CardDef as CardDefType } from '@cardstack/base/card-api';
import type * as FieldSupportModule from '@cardstack/base/field-support';

// Resolves to the in-process test realm so the runtime treats the cards we
// build below as belonging to it. Without this stub the query field tries to
// resolve `$this.cardTitle` against a realm the test harness doesn't know
// about.
class StubRealmService extends RealmService {
  realmOf(_input: URL | string) {
    return testRealmURL;
  }
}

function singularState(rel: RelationshipStatus): RelationshipState {
  let membership = rel.membership;
  if (!membership || membership.length !== 1) {
    throw new Error('expected singular relationship state');
  }
  return membership[0];
}

function pluralState(rel: RelationshipStatus): RelationshipState[] {
  if (!rel.membership) {
    throw new Error('expected plural relationship states');
  }
  return rel.membership;
}

module(
  'Integration | query-field linksTo/linksToMany error sentinel',
  function (hooks) {
    let loader: Loader;
    let cardApi: typeof import('@cardstack/base/card-api');
    let string: typeof import('@cardstack/base/string');
    let fieldSupport: typeof FieldSupportModule;

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
      fieldSupport = await loader.import<typeof FieldSupportModule>(
        '@cardstack/base/field-support',
      );
    });

    setupCardLogs(
      hooks,
      async () => await loader.import('@cardstack/base/card-api'),
    );

    // These tests pin down the *recognizer* side of the tolerance machine for
    // query-field linksTo / linksToMany: hand-plant a sentinel into the bucket
    // and assert the getters surface `undefined` / `emptyValue`, that
    // `getRelationshipMembershipState` exposes the typed failure state, and that
    // `getBrokenLinks` keeps its declared-`linksTo`-only contract by skipping
    // query-field findings. The producer side (`ensureQueryFieldSearchResource`
    // mirroring `searchResource.errors` onto the bucket on a real fetch
    // failure) is exercised end-to-end through the realm-server-tests
    // `card-endpoints-test.ts` query-backed scenarios and
    // `indexing-test.ts > additive writes > does not capture deps from
    // query-backed relationships` — those run the actual indexer + prerender
    // pipeline so the surface plant + recognizer round-trip in a real render.
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
      }

      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'test-cards.gts': { Person, Host },
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

    test('singular getter recognizes a hand-planted link-error sentinel and surfaces undefined', async function (this: RenderingTestContext, assert) {
      await setupRealm();
      let host = (await makeHost('Anchor')) as CardDefType & {
        favorite: unknown;
      };
      let { getDataBucket, getRelationshipMembershipState } = cardApi;
      let { isLinkError } = fieldSupport;

      let errorDoc: SerializedError = {
        status: 500,
        message: 'planted resource-level failure',
        additionalErrors: null,
      };
      let sentinel = {
        type: 'link-error' as const,
        reference: `${host.id ?? 'unsaved'}#favorite`,
        errorDoc,
      };
      getDataBucket(host).set('favorite', sentinel);

      assert.strictEqual(
        host.favorite,
        undefined,
        'singular query-field getter surfaces the sentinel as undefined',
      );
      assert.true(isLinkError(getDataBucket(host).get('favorite')));

      let state = singularState(
        getRelationshipMembershipState(host, 'favorite'),
      );
      assert.strictEqual(
        state.kind,
        'error',
        "getRelationshipMembershipState kind === 'error'",
      );
      if (state.kind === 'error') {
        assert.strictEqual(state.value, undefined);
        assert.strictEqual(state.errorDoc, errorDoc);
      }
    });

    test('singular getter recognizes a hand-planted link-not-found sentinel', async function (this: RenderingTestContext, assert) {
      await setupRealm();
      let host = (await makeHost('Anchor')) as CardDefType & {
        favorite: unknown;
      };
      let { getDataBucket, getRelationshipMembershipState } = cardApi;
      let { isLinkNotFound } = fieldSupport;

      let errorDoc: SerializedError = {
        status: 404,
        message: 'planted not-found',
        additionalErrors: null,
      };
      let sentinel = {
        type: 'link-not-found' as const,
        reference: `${host.id ?? 'unsaved'}#favorite`,
        errorDoc,
      };
      getDataBucket(host).set('favorite', sentinel);

      assert.strictEqual(host.favorite, undefined);
      assert.true(isLinkNotFound(getDataBucket(host).get('favorite')));

      let state = singularState(
        getRelationshipMembershipState(host, 'favorite'),
      );
      assert.strictEqual(state.kind, 'not-found');
      if (state.kind === 'not-found') {
        assert.strictEqual(state.errorDoc, errorDoc);
        assert.strictEqual(state.errorDoc.status, 404);
      }
    });

    test('plural getter recognizes a hand-planted whole-field sentinel and yields an empty array', async function (this: RenderingTestContext, assert) {
      await setupRealm();
      let host = (await makeHost('Anchor')) as CardDefType & {
        matches: unknown;
      };
      let { getDataBucket, getRelationshipMembershipState } = cardApi;
      let { isLinkError } = fieldSupport;

      let errorDoc: SerializedError = {
        status: 502,
        message: 'planted whole-field failure',
        additionalErrors: null,
      };
      let sentinel = {
        type: 'link-error' as const,
        reference: `${host.id ?? 'unsaved'}#matches`,
        errorDoc,
      };
      getDataBucket(host).set('matches', sentinel);

      let value = host.matches as unknown as unknown[];
      assert.ok(Array.isArray(value), 'array accessor returns an array');
      assert.strictEqual(
        value.length,
        0,
        'array accessor returns an empty array consistent with the resource-level failure',
      );
      assert.true(isLinkError(getDataBucket(host).get('matches')));

      let states = pluralState(getRelationshipMembershipState(host, 'matches'));
      assert.strictEqual(
        states.length,
        1,
        'getRelationshipMembershipState returns a one-element array describing the resource-level error',
      );
      assert.strictEqual(states[0].kind, 'error');
      if (states[0].kind === 'error') {
        assert.strictEqual(states[0].errorDoc, errorDoc);
      }
    });

    test('getBrokenLinks skips query-field sentinels (declared-linksTo-only contract)', async function (this: RenderingTestContext, assert) {
      // Query-backed `linksTo` / `linksToMany` participate in the tolerance
      // state machine via `getRelationshipMembershipState`, but they intentionally do NOT
      // flow through `getBrokenLinks`. The scan is for the declared-`linksTo`
      // path; including query-field findings would mis-classify cards whose
      // query failed for soft reasons (cross-realm assertions, federated
      // partial failures) as broken-link findings.
      await setupRealm();
      let host = (await makeHost('Anchor')) as CardDefType & {
        favorite: unknown;
      };
      let { getBrokenLinks, getDataBucket, getRelationshipMembershipState } =
        cardApi;

      let errorDoc: SerializedError = {
        status: 500,
        message: 'planted resource-level failure',
        additionalErrors: null,
      };
      let sentinel = {
        type: 'link-error' as const,
        reference: `${host.id ?? 'unsaved'}#favorite`,
        errorDoc,
      };
      getDataBucket(host).set('favorite', sentinel);

      let findings = getBrokenLinks(host);
      let favoriteFinding = findings.find((f) => f.fieldName === 'favorite');
      assert.notOk(
        favoriteFinding,
        'getBrokenLinks does NOT report query-field findings',
      );

      // The structured state is still observable through getRelationshipMembershipState —
      // that is the public surface query-field consumers branch on.
      let state = singularState(
        getRelationshipMembershipState(host, 'favorite'),
      );
      assert.strictEqual(state.kind, 'error');
    });
  },
);
