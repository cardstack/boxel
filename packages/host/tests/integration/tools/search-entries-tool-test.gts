import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { type Query, rri } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import SearchEntriesTool, {
  composeSearchEntriesQuery,
} from '@cardstack/host/tools/search-entries';

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

const longReadMe = `# Author card\n\n${'The Author card models a writer with biographical fields. '.repeat(20)}`;

module('Integration | tools | search-entries', function (hooks) {
  setupRenderingTest(hooks);

  const realmName = 'Search Entries Workspace';
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

  function runSearch(input: {
    query: Query;
    realms?: string[];
    scope?: string;
    limit?: number;
  }) {
    let toolService = getService('tool-service');
    let tool = new SearchEntriesTool(toolService.toolContext);
    return tool.execute(input);
  }

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    let cardApi: typeof import('@cardstack/base/card-api');
    let string: typeof import('@cardstack/base/string');
    let spec: typeof import('@cardstack/base/spec');

    cardApi = await loader.import('@cardstack/base/card-api');
    string = await loader.import('@cardstack/base/string');
    spec = await loader.import('@cardstack/base/spec');

    let { field, contains, CardDef } = cardApi;
    let { default: StringField } = string;
    let { Spec } = spec;

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

    let authorInstances: Record<string, unknown> = {};
    for (let i = 1; i <= 12; i++) {
      authorInstances[`Author/author-${i}.json`] = new Author({
        firstName: `Author${i}`,
        lastName: 'Example',
        bio: `Prolific example writer number ${i}.`,
      });
    }

    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'author.gts': { Author },
          ...authorInstances,
          'Author/mark.json': new Author({
            firstName: 'Mark',
            lastName: 'Jackson',
            bio: 'Novelist specializing in xylophone-themed mystery fiction.',
          }),
          'Spec/author.json': new Spec({
            cardTitle: 'Author',
            cardDescription: 'Spec for the Author card definition',
            specType: 'card',
            readMe: longReadMe,
            ref: {
              module: `${testRealmURL}author`,
              name: 'Author',
            },
          }),
          'notes.md': '# Workspace notes\n\nA plain markdown file fixture.',
          'realm.json': realmConfigCardJSON({
            name: realmName,
            iconURL: 'https://boxel-images.boxel.ai/icons/Letter-o.png',
          }),
        },
      });
    });
  });

  test('basic typed query returns entry summaries, not instances', async function (assert) {
    let result = await runSearch({
      query: {
        filter: {
          eq: { firstName: 'Mark' },
          on: { module: rri(`${testRealmURL}author`), name: 'Author' },
        },
      },
    });
    assert.strictEqual(result.results.length, 1);
    let row = result.results[0];
    assert.strictEqual(row.url, `${testRealmURL}Author/mark`);
    assert.strictEqual(row.kind, 'card');
    assert.strictEqual(row.cardTitle, 'Mark Jackson');
    assert.strictEqual(result.total, 1);
    assert.false(
      result.incomplete,
      'every searched realm answered, so the result is complete',
    );
  });

  test('spec rows carry ref, specType, and the full readMe', async function (assert) {
    let result = await runSearch({
      query: {
        filter: {
          on: { module: rri('https://cardstack.com/base/spec'), name: 'Spec' },
          eq: { specType: 'card', cardTitle: 'Author' },
        },
      },
    });
    assert.strictEqual(result.results.length, 1);
    let row = result.results[0];
    assert.strictEqual(row.url, `${testRealmURL}Spec/author`);
    assert.strictEqual(row.specType, 'card');
    assert.deepEqual(
      { module: row.ref?.module, name: row.ref?.name },
      { module: `${testRealmURL}author`, name: 'Author' },
    );
    assert.strictEqual(
      row.readMe,
      longReadMe,
      'readMe rides the result in full, untruncated',
    );
    assert.strictEqual(
      row.cardDescription,
      'Spec for the Author card definition',
    );
  });

  test('scope narrows to files or cards', async function (assert) {
    // `_title` is the kind-neutral title key (a card's cardTitle, a file's
    // name), so one spelling filters both scopes.
    let filesResult = await runSearch({
      query: { filter: { contains: { _title: 'notes' } } },
      scope: 'files',
    });
    assert.ok(
      filesResult.results.some(
        (r: { url: string }) => r.url === `${testRealmURL}notes.md`,
      ),
      'files scope surfaces the plain file',
    );
    assert.ok(
      filesResult.results.every((r: { kind: string }) => r.kind === 'file'),
      'files scope returns only file rows',
    );
    let notesRow = filesResult.results.find(
      (r: { url: string }) => r.url === `${testRealmURL}notes.md`,
    );
    assert.strictEqual(
      notesRow?.name,
      'notes.md',
      'a file row carries its name as the display handle',
    );

    let cardsResult = await runSearch({
      query: { filter: { contains: { _title: 'notes' } } },
      scope: 'cards',
    });
    assert.ok(
      cardsResult.results.every((r: { kind: string }) => r.kind === 'card'),
      'cards scope returns only card rows',
    );
  });

  test('invalid scope is rejected with the legal values', async function (assert) {
    await assert.rejects(
      runSearch({
        query: { filter: { matches: 'xylophone' } },
        scope: 'modules',
      }),
      /cards.*files.*all/,
    );
  });

  test('default scope deduplicates a card against its own file row', async function (assert) {
    let result = await runSearch({
      query: { filter: { matches: 'xylophone' } },
    });
    let markRows = result.results.filter((r: { url: string }) =>
      r.url.startsWith(`${testRealmURL}Author/mark`),
    );
    assert.strictEqual(
      markRows.length,
      1,
      'the matching card appears once, not once per index row',
    );
  });

  test('matches query yields relevance-sorted rows; non-matches yields none', async function (assert) {
    let withMatches = await runSearch({
      query: { filter: { matches: 'xylophone' } },
    });
    assert.ok(withMatches.results.length >= 1);
    let relevances = withMatches.results.map(
      (r: { matchRelevance?: number }) => r.matchRelevance,
    );
    assert.ok(
      relevances.every((r: number | undefined) => typeof r === 'number'),
      'every row carries a numeric matchRelevance',
    );
    let sorted = [...relevances].sort((a, b) => b! - a!);
    assert.deepEqual(relevances, sorted, 'rows are sorted by relevance desc');

    let withoutMatches = await runSearch({
      query: {
        filter: {
          eq: { firstName: 'Mark' },
          on: { module: rri(`${testRealmURL}author`), name: 'Author' },
        },
      },
    });
    assert.ok(
      withoutMatches.results.every(
        (r: { matchRelevance?: number }) => r.matchRelevance == null,
      ),
      'no relevance without a matches term (and no 400 from the sort)',
    );
  });

  test('limit defaults to 5, is honored, and clamps at 10', async function (assert) {
    let query: Query = {
      filter: {
        on: { module: rri(`${testRealmURL}author`), name: 'Author' },
        contains: { lastName: 'Example' },
      },
    };
    let defaulted = await runSearch({ query });
    assert.strictEqual(defaulted.results.length, 5, 'default limit is 5');
    assert.strictEqual(defaulted.total, 12, 'total reports the real count');

    let three = await runSearch({ query, limit: 3 });
    assert.strictEqual(three.results.length, 3);

    let clamped = await runSearch({ query, limit: 50 });
    assert.strictEqual(clamped.results.length, 10, 'limit clamps to 10');
  });

  test('realms input targets the given realm', async function (assert) {
    let result = await runSearch({
      query: {
        filter: {
          eq: { firstName: 'Mark' },
          on: { module: rri(`${testRealmURL}author`), name: 'Author' },
        },
      },
      realms: [testRealmURL],
    });
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.results[0].url, `${testRealmURL}Author/mark`);
  });

  test('the tool module has a default export (skill declarations use name: default)', function (assert) {
    // The top-of-file `import SearchEntriesTool from ...` is a default import;
    // it resolving to the class is the declaration-shape guard.
    assert.ok(SearchEntriesTool, 'default export exists');
  });

  module('query composition', function () {
    test('mixed-scope dedup wraps a non-narrowing filter', function (assert) {
      let { query: composed } = composeSearchEntriesQuery(
        { filter: { matches: 'xylophone' } },
        'all',
      );
      assert.ok(
        'every' in (composed.filter ?? {}),
        'filter is wrapped with the card-instance-file exclusion',
      );
    });

    test('a narrowing positive type anchor skips the dedup wrap', function (assert) {
      let filter: Query['filter'] = {
        on: { module: rri(`${testRealmURL}author`), name: 'Author' },
        eq: { firstName: 'Mark' },
      };
      let { query: composed } = composeSearchEntriesQuery({ filter }, 'all');
      assert.deepEqual(composed.filter, filter, 'filter passes through as-is');
    });

    test('an any-filter narrows only when every branch does', function (assert) {
      let authorAnchor = {
        on: { module: rri(`${testRealmURL}author`), name: 'Author' },
        eq: { firstName: 'Mark' },
      };
      // One unanchored branch: the disjunction can still match both a card's
      // instance row and its `.json` file row, so the dedup wrap applies.
      let { query: mixed } = composeSearchEntriesQuery(
        { filter: { any: [authorAnchor, { matches: 'xylophone' }] } },
        'all',
      );
      assert.ok(
        'every' in (mixed.filter ?? {}),
        'a partially-anchored any gains the dedup wrap',
      );

      let allNarrowing: Query['filter'] = {
        any: [
          authorAnchor,
          { type: { module: rri(`${testRealmURL}author`), name: 'Author' } },
        ],
      };
      let { query: narrowed } = composeSearchEntriesQuery(
        { filter: allNarrowing },
        'all',
      );
      assert.deepEqual(
        narrowed.filter,
        allNarrowing,
        'an any whose every branch narrows passes through as-is',
      );
    });

    test('explicit cards scope skips the dedup wrap', function (assert) {
      let { query: composed } = composeSearchEntriesQuery(
        { filter: { matches: 'xylophone' } },
        'cards',
      );
      assert.deepEqual(composed.filter, { matches: 'xylophone' });
    });

    test('a matches filter with no sort gains the relevance sort', function (assert) {
      let { query: composed, addedRelevanceSort } = composeSearchEntriesQuery(
        { filter: { matches: 'xylophone' } },
        'cards',
      );
      assert.deepEqual(composed.sort, [
        { by: '_matchRelevance', direction: 'desc' },
      ]);
      assert.true(
        addedRelevanceSort,
        'the addition is reported so the tool re-sorts the merged rows',
      );
    });

    test('an explicit sort and a matches-free filter stay untouched', function (assert) {
      let { query: sorted, addedRelevanceSort } = composeSearchEntriesQuery(
        {
          filter: { matches: 'xylophone' },
          sort: [{ by: 'cardTitle', direction: 'asc' }],
        },
        'cards',
      );
      assert.deepEqual(sorted.sort, [{ by: 'cardTitle', direction: 'asc' }]);
      assert.false(
        addedRelevanceSort,
        'a caller-chosen sort is never re-imposed client-side',
      );

      let { query: noMatches } = composeSearchEntriesQuery(
        { filter: { eq: { firstName: 'Mark' } } },
        'cards',
      );
      assert.strictEqual(
        noMatches.sort,
        undefined,
        'no relevance sort without a positive matches term',
      );
    });

    test('a caller sort naming _matchRelevance is not re-imposed by the tool', function (assert) {
      let { query: composed, addedRelevanceSort } = composeSearchEntriesQuery(
        {
          filter: { matches: 'xylophone' },
          sort: [
            { by: 'cardTitle', direction: 'asc' },
            { by: '_matchRelevance', direction: 'asc' },
          ],
        },
        'cards',
      );
      assert.deepEqual(composed.sort, [
        { by: 'cardTitle', direction: 'asc' },
        { by: '_matchRelevance', direction: 'asc' },
      ]);
      assert.false(
        addedRelevanceSort,
        'relevance riding the rows must not trigger the client re-sort',
      );
    });

    test('a negated matches term does not trigger the relevance sort', function (assert) {
      let { query: composed } = composeSearchEntriesQuery(
        {
          filter: {
            every: [
              { eq: { firstName: 'Mark' } },
              { not: { matches: 'xylophone' } },
            ],
          },
        },
        'cards',
      );
      assert.strictEqual(composed.sort, undefined);
    });
  });
});
