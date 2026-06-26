import {
  type RenderingTestContext,
  click,
  fillIn,
  render,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { provide } from 'ember-provide-consume-context';

import { module, test } from 'qunit';

import {
  baseRealm,
  CardContextName,
  GetCardContextName,
  GetCardCollectionContextName,
  GetCardsContextName,
} from '@cardstack/runtime-common';

import MarkdownEmbedChooserModal from '@cardstack/host/components/markdown-embed-chooser/modal';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import type MarkdownEmbedChooserService from '@cardstack/host/services/markdown-embed-chooser';
import type StoreService from '@cardstack/host/services/store';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import {
  CardDef,
  StringField,
  contains,
  field,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

// The mini choosers consume host context via @consume — provide it here so the
// modal renders standalone in this rendering test.
class HostContextProvider extends GlimmerComponent<{
  Blocks: { default: [] };
}> {
  @provide(GetCardContextName)
  get getCardFn() {
    return getCard;
  }
  @provide(GetCardsContextName)
  get getCardsFn() {
    let store = getService('store') as StoreService;
    return store.getSearchResource.bind(store);
  }
  @provide(GetCardCollectionContextName)
  get getCardCollectionFn() {
    return getCardCollection;
  }
  @provide(CardContextName)
  get cardContext() {
    return {};
  }
  <template>
    {{! template-lint-disable no-yield-only }}
    {{yield}}
  </template>
}

module('Integration | markdown-embed-chooser-modal', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  const mango = `${testRealmURL}books/mango`;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    class Book extends CardDef {
      static displayName = 'Book';
      @field title = contains(StringField);
    }
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'book.gts': { Book },
        'books/mango.json': new Book({ title: 'Mango' }),
        'books/vincent.json': new Book({ title: 'Vincent' }),
        'notes/hello.txt': 'hello',
      },
    });
    await getService('realm').login(testRealmURL);
  });

  test('opens on the default tab and mounts both tabpanels', async function (assert) {
    await render(
      <template>
        <HostContextProvider>
          <MarkdownEmbedChooserModal />
        </HostContextProvider>
      </template>,
    );

    assert
      .dom('[data-test-markdown-embed-chooser-modal]')
      .doesNotExist('the modal is closed by default');

    let svc = getService(
      'markdown-embed-chooser',
    ) as MarkdownEmbedChooserService;
    let pending = svc.chooseCardOrFile({ defaultTab: 'card' });

    await waitFor('[data-test-markdown-embed-chooser-modal]');
    assert
      .dom('[data-test-markdown-embed-chooser-tab="card"]')
      .hasAttribute('aria-selected', 'true', 'cards tab is active');
    assert
      .dom('[data-test-markdown-embed-chooser-tab="file"]')
      .hasAttribute('aria-selected', 'false', 'files tab is inactive');
    // Both panels stay in the DOM so per-tab state survives a switch.
    assert
      .dom('[data-test-markdown-embed-chooser-tab-panel="card"]')
      .exists('card tab-panel is mounted');
    assert
      .dom('[data-test-markdown-embed-chooser-tab-panel="file"]')
      .exists('file tab-panel is mounted even while inactive');

    // Resolve to clean up the pending promise.
    svc.resolve(undefined);
    await pending;
  });

  test('the cards tab search query survives a switch to files and back', async function (assert) {
    await render(
      <template>
        <HostContextProvider>
          <MarkdownEmbedChooserModal />
        </HostContextProvider>
      </template>,
    );

    let svc = getService(
      'markdown-embed-chooser',
    ) as MarkdownEmbedChooserService;
    let pending = svc.chooseCardOrFile({ defaultTab: 'card' });
    await waitFor('[data-test-markdown-embed-chooser-modal]');

    // Type into the cards search bar (scoped to the card tab-panel).
    await fillIn(
      '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-search-field]',
      'Vinc',
    );

    await click('[data-test-markdown-embed-chooser-tab="file"]');
    assert
      .dom('[data-test-markdown-embed-chooser-tab="file"]')
      .hasAttribute('aria-selected', 'true');

    await click('[data-test-markdown-embed-chooser-tab="card"]');
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-search-field]',
      )
      .hasValue('Vinc', 'card-tab search query survived the round-trip');

    svc.resolve(undefined);
    await pending;
  });

  test('closing the modal resolves the deferred with undefined', async function (assert) {
    await render(
      <template>
        <HostContextProvider>
          <MarkdownEmbedChooserModal />
        </HostContextProvider>
      </template>,
    );

    let svc = getService(
      'markdown-embed-chooser',
    ) as MarkdownEmbedChooserService;
    let pending = svc.chooseCardOrFile();
    await waitFor('[data-test-markdown-embed-chooser-modal]');

    await click('[data-test-close-modal]');
    let result = await pending;
    assert.strictEqual(result, undefined, 'cancelling resolves with undefined');
    await waitUntil(
      () => !document.querySelector('[data-test-markdown-embed-chooser-modal]'),
    );
  });

  test('edit mode preloads the matching tab in current view', async function (assert) {
    await render(
      <template>
        <HostContextProvider>
          <MarkdownEmbedChooserModal />
        </HostContextProvider>
      </template>,
    );

    let svc = getService(
      'markdown-embed-chooser',
    ) as MarkdownEmbedChooserService;
    let pending = svc.editEmbed({
      refType: 'card',
      url: mango,
      sizeSpec: 'embedded',
    });
    await waitFor('[data-test-markdown-embed-chooser-modal]');

    // Cards tab opens in 'current' mode (the placed target tile, not the
    // chooser); the files tab still shows its chooser per Zeplin 08B.
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-markdown-embed-chooser-current]',
      )
      .exists('cards tab shows the current-target tile');
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="file"] [data-test-mini-file-chooser]',
      )
      .exists('files tab still mounts its chooser');

    // CTA seeds at DONE (initial preload, nothing edited yet).
    await waitFor('[data-test-markdown-embed-preview-cta]:not([disabled])', {
      timeout: 5000,
    });
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-markdown-embed-preview-cta]',
      )
      .hasText('DONE', 'edit-mode CTA reads DONE while the form is clean');

    svc.resolve(undefined);
    await pending;
  });

  test('Remove resolves the deferred with { remove: true }', async function (assert) {
    await render(
      <template>
        <HostContextProvider>
          <MarkdownEmbedChooserModal />
        </HostContextProvider>
      </template>,
    );

    let svc = getService(
      'markdown-embed-chooser',
    ) as MarkdownEmbedChooserService;
    let pending = svc.editEmbed({
      refType: 'card',
      url: mango,
      sizeSpec: 'embedded',
    });
    await waitFor('[data-test-markdown-embed-chooser-modal]');
    await click('[data-test-markdown-embed-chooser-remove]');
    let result = await pending;
    assert.deepEqual(
      result,
      { remove: true },
      'Remove resolves the deferred with the remove sentinel',
    );
  });

  test('Replace swaps the current-target tile back to the mini chooser', async function (assert) {
    await render(
      <template>
        <HostContextProvider>
          <MarkdownEmbedChooserModal />
        </HostContextProvider>
      </template>,
    );

    let svc = getService(
      'markdown-embed-chooser',
    ) as MarkdownEmbedChooserService;
    let pending = svc.editEmbed({
      refType: 'card',
      url: mango,
      sizeSpec: 'embedded',
    });
    await waitFor('[data-test-markdown-embed-chooser-modal]');
    await click('[data-test-markdown-embed-chooser-replace]');

    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-markdown-embed-chooser-current]',
      )
      .doesNotExist('current-target tile is hidden after Replace');
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-mini-card-chooser]',
      )
      .exists('mini chooser is exposed for picking a new card');

    svc.resolve(undefined);
    await pending;
  });

  test('picking a card resolves the deferred with the serialized BFM', async function (assert) {
    await render(
      <template>
        <HostContextProvider>
          <MarkdownEmbedChooserModal />
        </HostContextProvider>
      </template>,
    );

    let svc = getService(
      'markdown-embed-chooser',
    ) as MarkdownEmbedChooserService;
    let pending = svc.chooseCardOrFile({ defaultTab: 'card' });
    await waitFor('[data-test-markdown-embed-chooser-modal]');

    // Search for the seeded card and click its row. SearchResultSection
    // renders rows under [data-test-search-result] in the mini variant.
    await fillIn(
      '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-search-field]',
      'Mango',
    );
    await waitFor(
      `[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-item-button="${mango}"]`,
      { timeout: 5000 },
    );
    await click(
      `[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-item-button="${mango}"]`,
    );

    // Pane unlocks once the target loads.
    await waitFor('[data-test-markdown-embed-preview-cta]:not([disabled])', {
      timeout: 5000,
    });
    await click('[data-test-markdown-embed-preview-cta]');

    let result = await pending;
    assert.deepEqual(
      result,
      { refType: 'card', url: mango, bfm: `:card[${mango}]` },
      'resolves with the serialized BFM directive for the picked card',
    );
  });
});
