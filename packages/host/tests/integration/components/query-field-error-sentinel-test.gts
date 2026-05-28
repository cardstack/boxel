import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';
import { settled, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  PermissionsContextName,
  SupportedMimeType,
  type Permissions,
  type SerializedError,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type NetworkService from '@cardstack/host/services/network';

import RealmService from '@cardstack/host/services/realm';

import type { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';
import type { RelationshipState } from 'https://cardstack.com/base/card-api';
import type * as FieldSupportModule from 'https://cardstack.com/base/field-support';

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

// Resolves to the in-process test realm so the runtime treats the cards we
// build below as belonging to it. Without this stub the query field tries to
// resolve `$this.cardTitle` against a realm the test harness doesn't know
// about and gives up before the failing fetch is reached.
class StubRealmService extends RealmService {
  realmOf(_input: URL | string) {
    return testRealmURL;
  }
}

function singularState(
  state: RelationshipState | RelationshipState[],
): RelationshipState {
  if (Array.isArray(state)) {
    throw new Error('expected singular relationship state');
  }
  return state;
}

function pluralState(
  state: RelationshipState | RelationshipState[],
): RelationshipState[] {
  if (!Array.isArray(state)) {
    throw new Error('expected plural relationship states');
  }
  return state;
}

module(
  'Integration | query-field linksTo/linksToMany error sentinel',
  function (hooks) {
    let loader: Loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
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
      cardApi = await loader.import(`${baseRealm.url}card-api`);
      string = await loader.import(`${baseRealm.url}string`);
      fieldSupport = await loader.import<typeof FieldSupportModule>(
        `${baseRealm.url}field-support`,
      );
    });

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    // Build a host card with a singular query-field `favorite` and a plural
    // query-field `matches`, both targeting `Person.name === $this.cardTitle`.
    // The query side resolves through `_federated-search` — failure on that
    // endpoint is what drives the sentinel-planting paths under test.
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
          'Person/anchor.json': new Person({ name: 'Anchor' }),
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
        undefined,
      )) as CardDefType;
    }

    // Mount a temporary network handler that fails every `_federated-search`
    // request. Returns the unmount fn so the test can restore the network.
    function failFederatedSearchWith(
      status: number,
      message: string,
    ): () => void {
      let network = getService('network') as NetworkService;
      let handler = async (req: Request) => {
        let url = new URL(req.url);
        if (url.pathname.endsWith('/_federated-search')) {
          return new Response(JSON.stringify({ errors: [{ message }] }), {
            status,
            headers: { 'Content-Type': SupportedMimeType.CardJson },
          });
        }
        return null;
      };
      network.virtualNetwork.mount(handler, { prepend: true });
      return () => network.virtualNetwork.unmount(handler);
    }

    test('a 5xx federated-search failure plants a link-error sentinel on a singular query field', async function (this: RenderingTestContext, assert) {
      await setupRealm();
      let host = (await makeHost('Nonexistent')) as CardDefType & {
        favorite: unknown;
      };
      let { getDataBucket, getRelationship } = cardApi;
      let { isLinkError } = fieldSupport;

      let unmount = failFederatedSearchWith(500, 'realm exploded');
      try {
        // reading the field kicks off the search through the failing handler
        void host.favorite;
        await waitUntil(() => isLinkError(getDataBucket(host).get('favorite')));

        assert.true(
          isLinkError(getDataBucket(host).get('favorite')),
          'bucket holds a link-error sentinel after the search failure',
        );
        assert.strictEqual(
          host.favorite,
          undefined,
          'the singular query-field getter surfaces the sentinel as undefined',
        );

        let state = singularState(getRelationship(host, 'favorite'));
        assert.strictEqual(
          state.kind,
          'error',
          "getRelationship kind === 'error'",
        );
        if (state.kind === 'error') {
          assert.true(state.isError);
          assert.strictEqual(state.value, undefined);
          assert.strictEqual(
            state.errorDoc.status,
            500,
            'errorDoc carries the upstream status',
          );
          assert.strictEqual(
            typeof state.reference,
            'string',
            'errored relationship state reference is a string',
          );
          assert.ok(
            state.reference.length > 0,
            'errored relationship state reference is non-empty',
          );
        }
      } finally {
        unmount();
      }
    });

    test('a 404 federated-search failure plants a link-not-found sentinel on a singular query field', async function (this: RenderingTestContext, assert) {
      await setupRealm();
      let host = (await makeHost('Nonexistent')) as CardDefType & {
        favorite: unknown;
      };
      let { getDataBucket, getRelationship } = cardApi;
      let { isLinkNotFound } = fieldSupport;

      let unmount = failFederatedSearchWith(404, 'missing');
      try {
        void host.favorite;
        await waitUntil(() =>
          isLinkNotFound(getDataBucket(host).get('favorite')),
        );

        let state = singularState(getRelationship(host, 'favorite'));
        assert.strictEqual(state.kind, 'not-found');
        if (state.kind === 'not-found') {
          assert.strictEqual(state.errorDoc.status, 404);
          assert.strictEqual(host.favorite, undefined);
        }
      } finally {
        unmount();
      }
    });

    test('a failing federated-search plants a single resource-level sentinel on a plural query field', async function (this: RenderingTestContext, assert) {
      await setupRealm();
      let host = (await makeHost('Nonexistent')) as CardDefType & {
        matches: unknown;
      };
      let { getDataBucket, getRelationship } = cardApi;
      let { isLinkError } = fieldSupport;

      let unmount = failFederatedSearchWith(500, 'realm exploded');
      try {
        void host.matches;
        await waitUntil(() => isLinkError(getDataBucket(host).get('matches')));

        assert.true(
          isLinkError(getDataBucket(host).get('matches')),
          'bucket holds a single whole-field sentinel — the search fails as a unit, not per element',
        );

        let bucketEntry = getDataBucket(host).get('matches');
        assert.strictEqual(
          (bucketEntry as { type: string }).type,
          'link-error',
          'the bucket entry is a scalar sentinel, not an array of sentinels',
        );

        let arrayValue = host.matches as unknown as unknown[];
        assert.ok(Array.isArray(arrayValue), 'array accessor returns an array');
        assert.strictEqual(
          arrayValue.length,
          0,
          'the array accessor surfaces an empty array consistent with the resource-level failure',
        );

        let states = pluralState(getRelationship(host, 'matches'));
        assert.strictEqual(
          states.length,
          1,
          'getRelationship returns a one-element array describing the resource-level error',
        );
        let [resourceState] = states;
        assert.strictEqual(resourceState.kind, 'error');
        if (resourceState.kind === 'error') {
          assert.strictEqual(resourceState.errorDoc.status, 500);
        }
      } finally {
        unmount();
      }
    });

    test('successful query-field resolution does not plant a sentinel', async function (this: RenderingTestContext, assert) {
      await setupRealm();
      let host = (await makeHost('Anchor')) as CardDefType & {
        favorite: { name?: string } | undefined;
        matches: Array<{ name?: string }>;
      };
      let { getDataBucket } = cardApi;
      let { isLinkError, isLinkNotFound } = fieldSupport;

      void host.favorite;
      void host.matches;
      await settled();

      let favoriteBucket = getDataBucket(host).get('favorite');
      let matchesBucket = getDataBucket(host).get('matches');

      assert.false(
        isLinkError(favoriteBucket),
        'singular query-field bucket holds no link-error sentinel on a successful search',
      );
      assert.false(
        isLinkNotFound(favoriteBucket),
        'singular query-field bucket holds no link-not-found sentinel on a successful search',
      );
      assert.false(
        isLinkError(matchesBucket),
        'plural query-field bucket holds no link-error sentinel on a successful search',
      );
      assert.false(
        isLinkNotFound(matchesBucket),
        'plural query-field bucket holds no link-not-found sentinel on a successful search',
      );

      // Also assert the search actually resolved to the realm's Anchor card
      // so a regression that returned empty for every query (which would
      // also pass the no-sentinel assertions above) is caught.
      assert.strictEqual(
        host.favorite?.name,
        'Anchor',
        'singular query field resolved to the realm-backed Anchor instance',
      );
      assert.strictEqual(
        host.matches.length,
        1,
        'plural query field resolved to exactly the realm-backed Anchor instance',
      );
      assert.strictEqual(
        host.matches[0]?.name,
        'Anchor',
        'plural query-field result is the Anchor card',
      );
    });

    test('the singular query-field getter recognizes a hand-planted link-error sentinel', async function (this: RenderingTestContext, assert) {
      await setupRealm();
      let host = (await makeHost('Anchor')) as CardDefType & {
        favorite: unknown;
      };
      let { getDataBucket, getRelationship } = cardApi;
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
        'a hand-planted link-error sentinel surfaces as undefined through the query branch',
      );
      assert.true(isLinkError(getDataBucket(host).get('favorite')));

      let state = singularState(getRelationship(host, 'favorite'));
      assert.strictEqual(state.kind, 'error');
      if (state.kind === 'error') {
        assert.strictEqual(state.errorDoc, errorDoc);
      }
    });

    test('the plural query-field getter recognizes a hand-planted link-error sentinel and yields an empty array', async function (this: RenderingTestContext, assert) {
      await setupRealm();
      let host = (await makeHost('Anchor')) as CardDefType & {
        matches: unknown;
      };
      let { getDataBucket, getRelationship } = cardApi;
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
        'array accessor returns an empty array',
      );
      assert.true(isLinkError(getDataBucket(host).get('matches')));

      let states = pluralState(getRelationship(host, 'matches'));
      assert.strictEqual(states.length, 1);
      assert.strictEqual(states[0].kind, 'error');
      if (states[0].kind === 'error') {
        assert.strictEqual(states[0].errorDoc, errorDoc);
      }
    });

    test('getBrokenLinks skips query-field findings even when the resource has errored', async function (this: RenderingTestContext, assert) {
      // Query-backed `linksTo` / `linksToMany` fields participate in the
      // tolerance state machine via `getRelationship`, but they intentionally
      // do not flow through `getBrokenLinks`. The legacy broken-link scan
      // converts findings into render errors (instance-error) at the indexer,
      // which would mis-classify cards whose query failed for soft reasons
      // (cross-realm assertions, federated partial failures) — outcomes the
      // query branch must surface as state, not as render failure.
      await setupRealm();
      let host = (await makeHost('Nonexistent')) as CardDefType & {
        favorite: unknown;
      };
      let { getBrokenLinks, getDataBucket, getRelationship } = cardApi;
      let { isLinkError } = fieldSupport;

      let unmount = failFederatedSearchWith(500, 'realm exploded');
      try {
        void host.favorite;
        await waitUntil(() => isLinkError(getDataBucket(host).get('favorite')));

        let findings = getBrokenLinks(host);
        let favoriteFinding = findings.find((f) => f.fieldName === 'favorite');
        assert.notOk(
          favoriteFinding,
          'getBrokenLinks does NOT report query-field findings',
        );

        // The structured state is still observable through getRelationship —
        // that is the public surface query-field consumers branch on.
        let state = singularState(getRelationship(host, 'favorite'));
        assert.strictEqual(state.kind, 'error');
      } finally {
        unmount();
      }
    });
  },
);
