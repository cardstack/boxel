import { click, waitFor } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { provide } from 'ember-provide-consume-context';
import { module, test } from 'qunit';

import { CardContextName } from '@cardstack/runtime-common';
import type { getCard as GetCardType } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../helpers';
import {
  CardDef,
  StringField,
  contains,
  field,
  setupBaseRealm,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard, renderComponent } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { BaseDef, CardContext } from '@cardstack/base/card-api';

type SearchEntryResultModule =
  typeof import('@cardstack/base/commands/search-entry-result');

interface RowSpec {
  url: string;
  kind?: string;
  cardTitle?: string;
  name?: string;
  matchRelevance?: number;
}

// Supplies the CardContext the operator-mode container provides in production,
// pared down to the store reads the search-entries rows consume. Tests that
// render without this wrapper exercise the context-less fallback rendering.
class StoreContextProvider extends GlimmerComponent<{
  Blocks: { default: [] };
}> {
  @provide(CardContextName)
  // @ts-ignore "context" is declared but not used
  private get context(): Partial<CardContext> {
    return {
      // the same cast the operator-mode container applies: the resource's
      // `card` is BaseDef-wide to cover file-meta reads
      getCard: getCard as unknown as GetCardType,
      getCardCollection,
    };
  }

  <template>
    {{! template-lint-disable no-yield-only }}
    {{yield}}
  </template>
}

let loader: Loader;

module('Integration | search-entries-result', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  hooks.beforeEach(async function () {
    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'pet.gts': { Pet },
        'Pet/mango.json': new Pet({ name: 'Mango' }),
        'hello.txt': 'Hello, world!',
      },
    });
  });

  async function makeEntriesResult(args: {
    rows: RowSpec[];
    total: number;
    incomplete?: boolean;
  }) {
    let mod = (await loader.import(
      '@cardstack/base/commands/search-entry-result',
    )) as SearchEntryResultModule;
    let { SearchEntriesResult, SearchEntrySummaryField } = mod;
    return new SearchEntriesResult({
      results: args.rows.map((row) => new SearchEntrySummaryField(row)),
      total: args.total,
      incomplete: args.incomplete ?? false,
    });
  }

  async function renderEntriesResult(args: {
    rows: RowSpec[];
    total: number;
    incomplete?: boolean;
  }) {
    let result = await makeEntriesResult(args);
    await renderCard(loader, result as BaseDef, 'embedded');
  }

  async function renderEntriesResultWithStore(args: {
    rows: RowSpec[];
    total: number;
    incomplete?: boolean;
  }) {
    let result = await makeEntriesResult(args);
    let api = await loader.import<typeof import('@cardstack/base/card-api')>(
      '@cardstack/base/card-api',
    );
    let ResultComponent = api.getComponent(result as BaseDef);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <StoreContextProvider>
            <ResultComponent @format='embedded' />
          </StoreContextProvider>
        </template>
      },
    );
  }

  module('without a card context (fallback rendering)', function () {
    test('renders a styled row per entry with the total count', async function (assert) {
      await renderEntriesResult({
        rows: [
          {
            url: 'http://test/Author/1',
            kind: 'card',
            cardTitle: 'Ada Lovelace',
          },
          {
            url: 'http://test/Author/2',
            kind: 'card',
            cardTitle: 'Alan Turing',
          },
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
      assert
        .dom('[data-test-entry-error]')
        .doesNotExist('rows render the fallback label, not the error branch');
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
      assert.dom('[data-test-entry-error]').doesNotExist();
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
        .hasText('Show 1 more result');

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

  module('with a store-backed card context', function () {
    test('hydrates a card-kind row into its atom rendering', async function (assert) {
      let cardURL = `${testRealmURL}Pet/mango`;
      await renderEntriesResultWithStore({
        rows: [{ url: cardURL, kind: 'card', cardTitle: 'Mango' }],
        total: 1,
      });

      await waitFor(
        `[data-test-result-entry="${cardURL}"] .atom-default-template`,
      );
      assert
        .dom(`[data-test-result-entry="${cardURL}"] .atom-default-template`)
        .containsText('Mango', 'the live card renders in atom format');
      assert
        .dom('.entry-fallback')
        .doesNotExist('the hydrated row replaces the fallback label');
      assert.dom('[data-test-entry-error]').doesNotExist();
    });

    test('hydrates a file-kind row into the file atom', async function (assert) {
      let fileURL = `${testRealmURL}hello.txt`;
      await renderEntriesResultWithStore({
        rows: [{ url: fileURL, kind: 'file', name: 'hello.txt' }],
        total: 1,
      });

      await waitFor(
        `[data-test-result-entry="${fileURL}"] [data-test-file-atom]`,
      );
      assert
        .dom(`[data-test-result-entry="${fileURL}"] [data-test-file-atom]`)
        .containsText('hello', 'the file renders through the FileDef atom');
      assert
        .dom('.entry-fallback')
        .doesNotExist('the hydrated row replaces the fallback label');
      assert.dom('[data-test-entry-error]').doesNotExist();
    });

    test('renders the error branch when a row fails to hydrate', async function (assert) {
      let missingURL = `${testRealmURL}Pet/does-not-exist`;
      await renderEntriesResultWithStore({
        rows: [{ url: missingURL, kind: 'card', cardTitle: 'Ghost' }],
        total: 1,
      });

      await waitFor(`[data-test-entry-error="${missingURL}"]`);
      assert
        .dom(`[data-test-entry-error="${missingURL}"]`)
        .containsText('Error: cannot render Ghost');
    });
  });
});
