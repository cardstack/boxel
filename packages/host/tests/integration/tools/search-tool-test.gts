import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseFileRef,
  baseRef,
  lowerQuery,
  type Query,
  type ResolvedCodeRef,
  rri,
  type SearchEntryScope,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import { searchCacheKey } from '@cardstack/host/lib/search-cache-key';
import {
  SearchCardsByQueryTool,
  SearchCardsByTypeAndTitleTool,
} from '@cardstack/host/tools/search-cards';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  realmConfigCardJSON,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | tools | search', function (hooks) {
  setupRenderingTest(hooks);

  const realmName = 'Operator Mode Workspace';
  let loader: Loader;

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  function runTypeTitleSearch(input: {
    cardType: string | undefined;
    cardTitle: string | undefined;
    type?: ResolvedCodeRef;
  }) {
    let toolService = getService('tool-service');
    let searchCommand = new SearchCardsByTypeAndTitleTool(
      toolService.toolContext,
    );
    return searchCommand.execute(input);
  }

  function runQuerySearch(query: Query) {
    let toolService = getService('tool-service');
    let searchCommand = new SearchCardsByQueryTool(toolService.toolContext);
    return searchCommand.execute({ query });
  }

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    let cardApi: typeof import('@cardstack/base/card-api');
    let string: typeof import('@cardstack/base/string');

    cardApi = await loader.import('@cardstack/base/card-api');
    string = await loader.import('@cardstack/base/string');

    let { field, contains, CardDef } = cardApi;
    let { default: StringField } = string;

    class Author extends CardDef {
      static displayName = 'Author';
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field bio = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Author) {
          return [this.firstName, this.lastName].filter(Boolean).join(' ');
        },
      });
    }
    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'author.gts': { Author },
          'Author/r2.json': new Author({
            firstName: 'R2-D2',
            bio: 'Astromech droid who communicates in beeps and whistles.',
          }),
          'Author/mark.json': new Author({
            firstName: 'Mark',
            lastName: 'Jackson',
            bio: 'Novelist specializing in xylophone-themed mystery fiction.',
          }),
          'realm.json': realmConfigCardJSON({
            name: realmName,
            iconURL: 'https://boxel-images.boxel.ai/icons/Letter-o.png',
          }),
        },
      });
    });
  });

  test('search for a title', async function (assert) {
    let result = await runTypeTitleSearch({
      cardTitle: 'Mark Jackson',
      cardType: undefined,
    });
    assert.strictEqual(result.cardIds.length, 1);
    assert.strictEqual(result.cardIds[0], 'http://test-realm/test/Author/mark');
  });

  test('search for a card type', async function (assert) {
    let result = await runTypeTitleSearch({
      cardType: 'Author',
      cardTitle: undefined,
    });
    assert.ok(result.cardIds.length > 0, 'Should return at least one result');
    assert.ok(
      result.cardIds.every((id) => id.includes('Author')),
      'All results should be Author cards',
    );
  });

  test('search for a title and a card type together', async function (assert) {
    let result = await runTypeTitleSearch({
      cardTitle: 'Mark Jackson',
      cardType: 'Author',
    });
    assert.strictEqual(result.cardIds.length, 1);
    assert.strictEqual(result.cardIds[0], 'http://test-realm/test/Author/mark');
  });

  test('search for a title and a card type with a type ref', async function (assert) {
    let result = await runTypeTitleSearch({
      cardTitle: 'R2-D2',
      cardType: 'Author',
      type: { module: rri('http://test-realm/test/author'), name: 'Author' },
    });
    assert.strictEqual(result.cardIds.length, 1);
    assert.strictEqual(result.cardIds[0], 'http://test-realm/test/Author/r2');
  });

  test('search with a query', async function (assert) {
    let result = await runQuerySearch({
      filter: {
        eq: { firstName: 'R2-D2' },
        on: {
          module: rri('http://test-realm/test/author'),
          name: 'Author',
        },
      },
    });
    assert.strictEqual(result.cardIds.length, 1);
    assert.strictEqual(result.cardIds[0], 'http://test-realm/test/Author/r2');
  });

  test('search with a matches filter', async function (assert) {
    let result = await runQuerySearch({
      filter: { matches: 'xylophone' },
    });
    assert.strictEqual(
      result.cardIds.length,
      1,
      'only mark.json has "xylophone" in its markdown',
    );
    assert.strictEqual(result.cardIds[0], 'http://test-realm/test/Author/mark');
  });

  test('search with matches composed inside every + eq', async function (assert) {
    let result = await runQuerySearch({
      filter: {
        on: {
          module: rri('http://test-realm/test/author'),
          name: 'Author',
        },
        every: [{ matches: 'droid' }, { eq: { firstName: 'R2-D2' } }],
      },
    });
    assert.strictEqual(
      result.cardIds.length,
      1,
      'composed matches + eq returns r2.json',
    );
    assert.strictEqual(result.cardIds[0], 'http://test-realm/test/Author/r2');
  });

  // The newer spelling reaches the tool when a model writes it. Before the
  // query is wired it is lowered, as the HTTP path lowers it.
  test('a query with a top-level type finds the cards of that type', async function (assert) {
    let result = await runQuerySearch({
      type: { module: rri('http://test-realm/test/author'), name: 'Author' },
      filter: { eq: { firstName: 'Mark' } },
    } as unknown as Query);
    assert.deepEqual(result.cardIds, ['http://test-realm/test/Author/mark']);
  });

  test('missing and exists find the cards without and with a value', async function (assert) {
    let type = {
      module: rri('http://test-realm/test/author'),
      name: 'Author',
    };
    let missing = await runQuerySearch({
      type,
      filter: { missing: 'lastName' },
    } as unknown as Query);
    assert.deepEqual(
      missing.cardIds,
      ['http://test-realm/test/Author/r2'],
      'r2 has no last name',
    );
    let exists = await runQuerySearch({
      type,
      filter: { exists: 'lastName' },
    } as unknown as Query);
    assert.deepEqual(
      exists.cardIds,
      ['http://test-realm/test/Author/mark'],
      'mark has one',
    );
  });

  // A refusal goes back through the tool's error path with its code and
  // rewrite; only a query that ran and matched nothing is an empty result.
  test('a refused query is an error; no match is an empty result', async function (assert) {
    let type = {
      module: rri('http://test-realm/test/author'),
      name: 'Author',
    };
    // Newer spelling (it names its total) whose type is the top filter's
    // `on`, the older way: refused with the rewrite. With a top-level `type`
    // beside it, an `on` on the top node narrows that node and is accepted.
    await assert.rejects(
      runQuerySearch({
        filter: { on: type, eq: { firstName: 'Mark' } },
        page: { size: 10, total: 'exact' },
      } as unknown as Query),
      (e: any) =>
        e?.code === 'mixed-spelling' &&
        /Put the type at the top and drop "on"/.test(e.message),
      'mixed-spelling, with the rewrite',
    );
    let none = await runQuerySearch({
      type,
      filter: { eq: { firstName: 'Nobody' } },
    } as unknown as Query);
    assert.deepEqual(none.cardIds, [], 'no match is a successful empty result');
  });

  // ADR 022 §1.7: beside a newer member, an `on` on the top filter node is
  // the older way of naming the query's type, refused before the search.
  test('an on anchor beside a newer member is refused with the rewrite', async function (assert) {
    let type = {
      module: rri('http://test-realm/test/author'),
      name: 'Author',
    };
    await assert.rejects(
      runQuerySearch({
        filter: { on: type, eq: { firstName: 'Mark' } },
        facets: [{ by: 'firstName' }],
      } as unknown as Query),
      (e: any) =>
        e?.code === 'mixed-spelling' &&
        /filter\.on/.test(e.message) &&
        /"facets"/.test(e.message) &&
        e.message.includes(`{ "type": ${JSON.stringify(type)}`),
      'mixed-spelling, with the rewrite',
    );
  });

  // The tool hands the store the query as the model wrote it; the store
  // resolves its wire scope (and the cache key, which carries that scope)
  // from it, and the wire translator lowers it as it wires it.
  module('wire scope', function () {
    type ScopeResolver = {
      resolveWireScope(
        query: Query,
        explicitScope?: SearchEntryScope,
      ): SearchEntryScope | undefined;
    };
    function resolveWireScope(
      query: unknown,
      explicitScope?: SearchEntryScope,
    ) {
      let store = getService('store') as unknown as ScopeResolver;
      return store.resolveWireScope(query as Query, explicitScope);
    }
    const author = {
      module: rri('http://test-realm/test/author'),
      name: 'Author',
    };

    test('a top-level type selects its kind, as the lowered query does', function (assert) {
      for (let query of [
        { type: author },
        { type: author, filter: { eq: { firstName: 'Mark' } } },
        { type: 'http://test-realm/test/author#Author' },
        { type: baseFileRef },
        { type: baseRef },
        { type: baseRef, filter: { type: author } },
        { type: author, filter: { not: { type: author } } },
      ]) {
        let lowered = lowerQuery(query as Record<string, any>).query;
        assert.strictEqual(
          resolveWireScope(query),
          resolveWireScope(lowered),
          `${JSON.stringify(query)} resolves as its lowering does`,
        );
      }
      assert.strictEqual(
        resolveWireScope({ type: author }),
        undefined,
        'a card type passes through with the default scope',
      );
      assert.strictEqual(
        resolveWireScope({ type: baseRef }),
        'cards',
        'BaseDef selects no kind, so it is pinned to cards',
      );
    });

    test('a top-level type keys the cache with the scope it resolves to', function (assert) {
      let query = { type: author } as unknown as Query;
      let key = searchCacheKey(
        'job',
        'http://test-realm/test/',
        query,
        resolveWireScope(query),
      );
      assert.strictEqual(
        key,
        searchCacheKey(
          'job',
          'http://test-realm/test/',
          query,
          resolveWireScope(query, 'all'),
        ),
        'the same key as the explicit all scope',
      );
      assert.notStrictEqual(
        key,
        searchCacheKey('job', 'http://test-realm/test/', query, 'cards'),
        'not the key of a cards-scoped search',
      );
    });
  });
});
