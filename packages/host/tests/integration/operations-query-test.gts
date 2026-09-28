import { render, settled, waitUntil } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { provide } from 'ember-provide-consume-context';

import { module, test } from 'qunit';

import {
  CardSearchDefaultRealmContextName,
  GetCardContextName,
  type getCard as GetCardType,
  type Realm,
  type SearchEntries,
  type NamedSearchWireQuery,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import CardContextSearchResults from '@cardstack/host/components/search/card-context-search-results';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

import type { CardContext, CardDef } from '@cardstack/base/card-api';
import type * as OperationsModule from '@cardstack/base/operations';

// ============================================================================
// A saved search: `operations(Report).openReports()`.
//
// A `query` operation is declared next to a card type's other operations and
// carried out nowhere near them — the search engine plans and runs it, so a
// call answers with the same live entries resource every other search on the
// host answers with, and `.query()` answers the wire query behind it for a
// card that renders the rows itself.
//
// The realm under test is the in-browser one and the searches here are real:
// what a declared query matches is what the realm's index answers, and the
// caller a query compares against is the session's own user.
// ============================================================================

const testRealm2URL = 'http://test-realm/test2/';
const CALLER = '@testuser:localhost';

// The declarations are realm source, compiled by the realm and lowered by the
// in-browser indexer, so the queries under test are the ones an author writes.
const REPORT_MODULE = `
  import {
    contains,
    field,
    CardDef,
    Component,
  } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, actor, params } from "@cardstack/base/operations";

  export class Report extends CardDef {
    @field headline = contains(StringField);
    @field status = contains(StringField);
    @field postedBy = contains(StringField);

    @operation static openReports = {
      base: 'query',
      query: {
        filter: { on: () => Report, eq: { status: 'open' } },
        sort: [{ on: () => Report, by: 'headline', direction: 'asc' }],
      },
    };

    @operation static myReports = {
      base: 'query',
      query: { filter: { on: () => Report, eq: { postedBy: actor() } } },
    };

    @operation static byStatus = {
      base: 'query',
      params: { status: StringField },
      query: {
        filter: { on: () => Report, eq: { status: params('status') } },
      },
    };

    static isolated = class Isolated extends Component<typeof this> {
      <template><h1 data-test-report><@fields.headline /></h1></template>
    }
    static embedded = class Embedded extends Component<typeof this> {
      <template><h1 data-test-report><@fields.headline /></h1></template>
    }
    static fitted = class Fitted extends Component<typeof this> {
      <template><h1 data-test-report><@fields.headline /></h1></template>
    }
  }
`;

// A type no report is, for a filter that could never match one.
const MEMO_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Memo extends CardDef {
    @field body = contains(StringField);
  }
`;

function reportRef() {
  return { module: testRRI('report'), name: 'Report' };
}

function reportFile(attributes: {
  headline: string;
  status: string;
  postedBy?: string;
}) {
  return {
    data: {
      type: 'card',
      attributes: { postedBy: CALLER, ...attributes },
      meta: { adoptsFrom: reportRef() },
    },
  };
}

// The full card `@context` the host hands a card, so a template renders the
// rows exactly as a card author would.
class CardSearchContext extends GlimmerComponent<{
  Blocks: { default: [CardContext] };
}> {
  @provide(GetCardContextName)
  get getCardFn() {
    return getCard;
  }

  @provide(CardSearchDefaultRealmContextName)
  get cardSearchDefaultRealm(): () => string | undefined {
    return () => testRealmURL;
  }

  get context(): CardContext {
    let store = getService('store');
    return {
      getCard: getCard as unknown as GetCardType,
      getCards: store.getSearchResource.bind(store),
      getCardCollection,
      store,
      searchResultsComponent: CardContextSearchResults,
    };
  }

  <template>{{yield this.context}}</template>
}

module('Integration | operations query', function (hooks) {
  let loader: Loader;
  let operations: (typeof OperationsModule)['operations'];
  let Report: typeof CardDef;
  let realm: Realm;

  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  setupCardLogs(hooks, async () =>
    getService('loader-service').loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: CALLER,
    activeRealms: [testRealmURL, testRealm2URL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    ({ realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'report.gts': REPORT_MODULE,
        'memo.gts': MEMO_MODULE,
        'reports/open-1.json': reportFile({
          headline: 'Air quality',
          status: 'open',
        }),
        'reports/open-2.json': reportFile({
          headline: 'Boiler noise',
          status: 'open',
        }),
        'reports/closed.json': reportFile({
          headline: 'Closed one',
          status: 'closed',
        }),
        'reports/someone-elses.json': reportFile({
          headline: 'Not yours',
          status: 'open',
          postedBy: '@someone-else:localhost',
        }),
      },
    }));
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealm2URL,
      contents: {
        'reports/elsewhere.json': reportFile({
          headline: 'Another realm',
          status: 'open',
        }),
      },
    });
    // Imported after the realms are up, and through the loader their instances
    // were built by: `operations()` reads a def's declarations off the class,
    // and a copy of the module from an earlier loader carries none of them.
    loader = getService('loader-service').loader;
    ({ operations } = await loader.import<typeof OperationsModule>(
      '@cardstack/base/operations',
    ));
    ({ Report } = await loader.import<{ Report: typeof CardDef }>(
      `${testRealmURL}report`,
    ));
    await getService('realm').login(testRealmURL);
    // Looking the service up is what arms the bridge a card reads the session
    // back through, the same as the app's own boot does.
    getService('operations');
  });

  function saved(name: string) {
    return (operations(Report as never) as any)[name];
  }

  async function settledEntries(search: SearchEntries): Promise<string[]> {
    await waitUntil(() => !search.isLoading, { timeout: 10_000 });
    return search.entries.map((entry) => entry.id).sort();
  }

  test('a declared query answers the cards its filter matches', async function (assert) {
    let reports = saved('openReports')() as SearchEntries;

    assert.deepEqual(
      await settledEntries(reports),
      [
        `${testRealmURL}reports/open-1`,
        `${testRealmURL}reports/open-2`,
        `${testRealmURL}reports/someone-elses`,
      ],
      'every open report in the realm, and nothing the filter excludes',
    );
    assert.strictEqual(
      reports.meta.page.total,
      3,
      'and the search reports what it found',
    );
  });

  test('the caller is what a query compares against', async function (assert) {
    let mine = saved('myReports')() as SearchEntries;

    assert.deepEqual(
      await settledEntries(mine),
      [
        `${testRealmURL}reports/closed`,
        `${testRealmURL}reports/open-1`,
        `${testRealmURL}reports/open-2`,
      ],
      'the actor marker resolved to the signed-in user, so the report posted by somebody else is not a match',
    );
    assert.deepEqual(
      saved('myReports').query().filter,
      { 'item.on': reportRef(), eq: { 'item.postedBy': CALLER } },
      'which is what the query the search ran compares',
    );
  });

  test('a payload fills the markers its declaration names', async function (assert) {
    let closed = saved('byStatus')({ status: 'closed' }) as SearchEntries;

    assert.deepEqual(
      await settledEntries(closed),
      [`${testRealmURL}reports/closed`],
      'the payload member the declaration names is what the filter compares against',
    );
  });

  test('the wire query a call resolves to is the one the search component takes', async function (assert) {
    let query = saved('openReports').query() as NamedSearchWireQuery;

    assert.deepEqual(
      query,
      {
        filter: { 'item.on': reportRef(), eq: { 'item.status': 'open' } },
        sort: [
          {
            by: 'item.headline',
            'item.on': reportRef(),
            direction: 'asc',
          },
        ],
        realms: [testRealmURL],
        operation: 'openReports',
        on: reportRef(),
      },
      'the classes became the type they name, the card-rooted query became the entry-addressed one, and the request names the operation the realm resolves it from',
    );

    await render(
      <template>
        <CardSearchContext as |context|>
          <context.searchResultsComponent @query={{query}} @mode='hover' />
        </CardSearchContext>
      </template>,
    );
    await waitUntil(() =>
      Boolean(document.querySelector('[data-test-search-result]')),
    );

    assert
      .dom(`[data-test-search-result="${testRealmURL}reports/open-1"]`)
      .exists('a card hands the resolved query over and renders the rows');
    assert
      .dom(`[data-test-search-result="${testRealmURL}reports/closed"]`)
      .doesNotExist('and the rows are the ones the saved search matched');
  });

  test('a search covers the realm holding its type until the call names others', async function (assert) {
    let here = saved('openReports')() as SearchEntries;
    assert.deepEqual(
      await settledEntries(here),
      [
        `${testRealmURL}reports/open-1`,
        `${testRealmURL}reports/open-2`,
        `${testRealmURL}reports/someone-elses`,
      ],
      'a declaration and a call that both named no realm search the one the type is defined in',
    );

    let across = saved('openReports')(undefined, {
      realms: [testRealmURL, testRealm2URL],
    }) as SearchEntries;
    assert.deepEqual(
      await settledEntries(across),
      [
        `${testRealmURL}reports/open-1`,
        `${testRealmURL}reports/open-2`,
        `${testRealmURL}reports/someone-elses`,
        `${testRealm2URL}reports/elsewhere`,
      ],
      'and a call that names realms fans the same saved search out across them',
    );
  });

  test('the search re-runs as the realms it covers index', async function (assert) {
    let reports = saved('openReports')() as SearchEntries;
    assert.strictEqual((await settledEntries(reports)).length, 3);

    await realm.write(
      'reports/open-3.json',
      JSON.stringify(
        reportFile({ headline: 'Filed just now', status: 'open' }),
      ),
    );
    await waitUntil(() => reports.entries.length === 4, { timeout: 10_000 });

    assert.ok(
      reports.entries.find(
        (entry) => entry.id === `${testRealmURL}reports/open-3`,
      ),
      'the report written after the search started joined it when the realm indexed it — a query is as fresh as the index',
    );
  });

  test('a search the realm resolves by name re-runs on writes its own filter cannot see', async function (assert) {
    // What a host holding a stale definition sends: the named operation, and
    // beside it a lowering of that operation which no longer matches what the
    // realm resolves it to. The realm answers with its own resolution, so the
    // carried filter cannot be what decides which writes the search skips.
    let stale = {
      ...(saved('openReports').query() as NamedSearchWireQuery),
      filter: { 'item.on': { module: testRRI('memo'), name: 'Memo' } },
    };
    let reports = getService('operations').search.entries(() => stale);
    assert.strictEqual(
      (await settledEntries(reports)).length,
      3,
      'the realm answered with the open reports its declaration matches',
    );

    // The gate resolves its anchors off the first typed event, which takes the
    // re-run it would have taken anyway, and judges the ones after it. A
    // closed report moves nothing here, so it only primes the gate.
    await realm.write(
      'reports/closed-2.json',
      JSON.stringify(
        reportFile({ headline: 'Closed again', status: 'closed' }),
      ),
    );
    await settled();
    assert.strictEqual(
      (await settledEntries(reports)).length,
      3,
      'a closed report is not one the realm’s declaration matches',
    );

    await realm.write(
      'reports/open-4.json',
      JSON.stringify(
        reportFile({
          headline: 'Filed under a stale definition',
          status: 'open',
        }),
      ),
    );
    await waitUntil(() => reports.entries.length === 4, { timeout: 10_000 });

    assert.ok(
      reports.entries.find(
        (entry) => entry.id === `${testRealmURL}reports/open-4`,
      ),
      'the report joined the search though the filter it carries could never match one',
    );
  });

  test('a render has no viewer, so a search that compares against one answers none', async function (assert) {
    // The prerender app authenticates as itself so it can render any card, and
    // what it produces is served to everyone. A saved search that resolved the
    // caller there would put one identity's rows into shared HTML.
    (globalThis as any).__boxelPrerenderApp = true;
    try {
      assert.strictEqual(
        saved('myReports').query(),
        undefined,
        'the actor-scoped search answers no query, which the search surface reads as an idle search',
      );
      assert.ok(
        saved('openReports').query(),
        'and a saved search that does not read the caller is unaffected',
      );
    } finally {
      delete (globalThis as any).__boxelPrerenderApp;
    }

    assert.ok(
      saved('myReports').query(),
      'outside a render the same search resolves against the signed-in user',
    );
  });

  test('a saved search is invoked on the class that declares it', async function (assert) {
    let card = await getService('store').get<CardDef>(
      `${testRealmURL}reports/open-1`,
    );
    await settled();

    assert.strictEqual(
      (operations(card as never) as any).openReports,
      undefined,
      'a saved search reads a collection of a type, so one card carries no member for it',
    );
  });
});
