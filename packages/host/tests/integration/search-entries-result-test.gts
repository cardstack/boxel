import { click } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import { setupCardLogs } from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { BaseDef } from '@cardstack/base/card-api';

type SearchEntryResultModule =
  typeof import('@cardstack/base/commands/search-entry-result');

interface RowSpec {
  url: string;
  kind?: string;
  cardTitle?: string;
  name?: string;
  matchRelevance?: number;
}

let loader: Loader;

module('Integration | search-entries-result', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupMockMatrix(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  async function renderEntriesResult(args: {
    rows: RowSpec[];
    total: number;
    incomplete?: boolean;
  }) {
    let mod = (await loader.import(
      '@cardstack/base/commands/search-entry-result',
    )) as SearchEntryResultModule;
    let { SearchEntriesResult, SearchEntrySummaryField } = mod;
    let result = new SearchEntriesResult({
      results: args.rows.map((row) => new SearchEntrySummaryField(row)),
      total: args.total,
      incomplete: args.incomplete ?? false,
    });
    await renderCard(loader, result as BaseDef, 'embedded');
  }

  test('renders a styled row per entry with the total count', async function (assert) {
    await renderEntriesResult({
      rows: [
        {
          url: 'http://test/Author/1',
          kind: 'card',
          cardTitle: 'Ada Lovelace',
        },
        { url: 'http://test/Author/2', kind: 'card', cardTitle: 'Alan Turing' },
      ],
      total: 2,
    });

    assert.dom('[data-test-search-entries-result]').exists();
    assert
      .dom('[data-test-search-entries-count]')
      .containsText('2 of 2 results');
    assert.dom('[data-test-result-list] [data-test-result-entry]').exists({
      count: 2,
    });
    assert
      .dom('[data-test-result-entry="http://test/Author/1"]')
      .containsText('Ada Lovelace');
    assert
      .dom('[data-test-result-entry="http://test/Author/2"]')
      .containsText('Alan Turing');
    assert.dom('[data-test-toggle-show-button]').doesNotExist();
  });

  test('renders file entries by their name', async function (assert) {
    await renderEntriesResult({
      rows: [{ url: 'http://test/notes.md', kind: 'file', name: 'notes.md' }],
      total: 1,
    });

    assert
      .dom('[data-test-result-entry="http://test/notes.md"]')
      .containsText('notes.md');
  });

  test('paginates to five and toggles the rest into view', async function (assert) {
    let rows: RowSpec[] = [];
    for (let i = 1; i <= 6; i++) {
      rows.push({
        url: `http://test/Author/${i}`,
        kind: 'card',
        cardTitle: `Author ${i}`,
      });
    }
    await renderEntriesResult({ rows, total: 6 });

    assert
      .dom('[data-test-result-entry]')
      .exists({ count: 5 }, 'only the first page is shown');
    assert
      .dom('[data-test-toggle-show-button]')
      .containsText('Show 1 more results');

    await click('[data-test-toggle-show-button]');
    assert
      .dom('[data-test-result-entry]')
      .exists({ count: 6 }, 'all rows are shown after expanding');
    assert.dom('[data-test-toggle-show-button]').containsText('See Less');
  });

  test('surfaces match relevance and the incomplete signal', async function (assert) {
    await renderEntriesResult({
      rows: [
        {
          url: 'http://test/Author/1',
          kind: 'card',
          cardTitle: 'Ada Lovelace',
          matchRelevance: 0.6073,
        },
      ],
      total: 4,
      incomplete: true,
    });

    assert
      .dom('[data-test-entry-relevance="http://test/Author/1"]')
      .hasText('0.61');
    assert
      .dom('[data-test-search-entries-count]')
      .containsText('(incomplete: a realm failed)');
  });
});
