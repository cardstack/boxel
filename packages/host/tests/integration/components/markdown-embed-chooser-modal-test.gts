import {
  type RenderingTestContext,
  click,
  fillIn,
  render,
  triggerEvent,
  triggerKeyEvent,
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
  const readme = `${testRealmURL}readme.txt`;

  // Open the format dropdown scoped to one tab-panel and pick an option. The
  // dropdown renders in the power-select wormhole, so the option selector is
  // global once the menu is open.
  async function chooseFormatIn(tab: 'card' | 'file', value: string) {
    await click(
      `[data-test-markdown-embed-chooser-tab-panel="${tab}"] [data-test-markdown-embed-preview-format-select]`,
    );
    await waitFor('.ember-power-select-option', { timeout: 3000 });
    await click(`[data-test-format-option="${value}"]`);
  }

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
        'readme.txt': 'readme',
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

  test('the close button shows an ESC tooltip and Escape closes the modal', async function (assert) {
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

    // Hovering the close button reveals a styled tooltip: label + ESC badge.
    let trigger = document
      .querySelector('[data-test-close-modal]')
      ?.closest('[data-tooltip-trigger]');
    assert.ok(trigger, 'close button is wrapped in a tooltip trigger');
    await triggerEvent(trigger as Element, 'mouseenter');
    await waitFor('[data-test-tooltip-content]');
    assert
      .dom('[data-test-tooltip-content]')
      .includesText('close', 'tooltip shows the close label');
    assert
      .dom('[data-test-tooltip-content] .shortcut-key')
      .hasText('ESC', 'tooltip shows the ESC key badge');
    await triggerEvent(trigger as Element, 'mouseleave');

    // The modal owns Escape: it must not bubble to the document-level
    // operator-mode handler (which would flip the card out of edit format).
    let escapeReachedDocument = false;
    let docListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') escapeReachedDocument = true;
    };
    document.addEventListener('keydown', docListener);

    // Pressing Escape closes the modal and resolves the deferred with undefined.
    try {
      await triggerKeyEvent(
        '[data-test-markdown-embed-chooser-modal]',
        'keydown',
        'Escape',
      );
    } finally {
      document.removeEventListener('keydown', docListener);
    }
    assert.false(
      escapeReachedDocument,
      'Escape is stopped at the modal and does not reach the document',
    );
    let result = await pending;
    assert.strictEqual(
      result,
      undefined,
      'pressing Escape resolves with undefined',
    );
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
      .hasText('Done', 'edit-mode CTA reads Done while the form is clean');

    // The preloaded card must actually render its embed in the preview — not
    // just the CTA row.
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-markdown-embed-preview]',
      )
      .exists('the preloaded card renders its embed preview in edit mode');

    svc.resolve(undefined);
    await pending;
  });

  test('edit-mode preload of a broken ref shows the broken preview + Remove/Replace, not the empty placeholder', async function (assert) {
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
    // A card URL that isn't in the realm — the preload can't resolve it.
    let brokenUrl = `${testRealmURL}books/ghost`;
    // The editing document sits in a sibling directory, so the broken ref
    // relativizes against it to a `../`-relative label.
    let pending = svc.editEmbed({
      refType: 'card',
      url: brokenUrl,
      sizeSpec: 'embedded',
      documentBaseUrl: `${testRealmURL}posts/my-post`,
    });
    await waitFor('[data-test-markdown-embed-chooser-modal]');

    // The preview pane renders the broken-ref visual rather than the empty
    // "search & preview" placeholder.
    await waitFor(
      '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-broken-link-template]',
      { timeout: 5000 },
    );
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-broken-link-template]',
      )
      .exists('the broken preview shows for an unresolvable preload');
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-markdown-embed-preview-empty]',
      )
      .doesNotExist('the empty placeholder is suppressed for a broken ref');

    // The current-target tile still offers Remove / Replace as the fix/remove
    // affordance, and labels the broken ref by its URL.
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-markdown-embed-chooser-current]',
      )
      .exists('the current-target tile renders for the broken preload');
    // The label falls back to the ref (no title to show). It relativizes
    // against the editing document's URL, so it reads as the `../`-relative
    // path — the same form the pane serializes into the directive.
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-markdown-embed-chooser-current-label]',
      )
      .hasText(
        '../books/ghost',
        'a broken ref labels as its document-relative path',
      );
    assert
      .dom('[data-test-markdown-embed-chooser-remove]')
      .exists('Remove is available');
    assert
      .dom('[data-test-markdown-embed-chooser-replace]')
      .exists('Replace is available');

    svc.resolve(undefined);
    await pending;
  });

  test('a broken ref in a different realm than the document keeps its full URL as the label', async function (assert) {
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
    // A broken ref in the base realm while the editing document lives in the
    // test realm — the two are in different namespaces, so the ref can't be
    // relativized and keeps its absolute URL.
    let brokenUrl = `${baseRealm.url}ghost-card`;
    let pending = svc.editEmbed({
      refType: 'card',
      url: brokenUrl,
      sizeSpec: 'embedded',
      documentBaseUrl: `${testRealmURL}posts/my-post`,
    });
    await waitFor(
      '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-broken-link-template]',
      { timeout: 5000 },
    );
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-markdown-embed-chooser-current-label]',
      )
      .hasText(
        brokenUrl,
        'a broken ref in another realm keeps its absolute URL',
      );

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

  test('a picked card serializes a document-relative ref when a base URL is supplied', async function (assert) {
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
    // The editing document lives in a sibling directory (`posts/`) to the
    // picked card (`books/`), so the inserted ref collapses to `../books/mango`
    // — matching the codemirror format-picker insertion path. The `url` in the
    // result stays absolute (it's metadata; only the `bfm` ref is relativized).
    let pending = svc.chooseCardOrFile({
      defaultTab: 'card',
      documentBaseUrl: `${testRealmURL}posts/my-post`,
    });
    await waitFor('[data-test-markdown-embed-chooser-modal]');

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

    await waitFor('[data-test-markdown-embed-preview-cta]:not([disabled])', {
      timeout: 5000,
    });
    await click('[data-test-markdown-embed-preview-cta]');

    let result = await pending;
    assert.deepEqual(
      result,
      { refType: 'card', url: mango, bfm: `:card[../books/mango]` },
      'resolves with a document-relative BFM ref while keeping url absolute',
    );
  });

  test('the chosen format sticks when switching from the cards tab to the files tab', async function (assert) {
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

    // Pick a card and switch its format away from the default atom.
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
    await waitFor('[data-test-markdown-embed-preview-cta]:not([disabled])', {
      timeout: 5000,
    });
    await chooseFormatIn('card', 'embedded');
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-markdown-embed-preview-cta]',
      )
      .hasText('Insert as Embedded');

    // Switch to the files tab and pick a file: the preview format carries over
    // rather than resetting to atom (the two tabs share one format selection).
    await click('[data-test-markdown-embed-chooser-tab="file"]');
    await waitFor(
      '[data-test-mini-file-chooser] [data-test-file="readme.txt"]',
      {
        timeout: 5000,
      },
    );
    await click('[data-test-mini-file-chooser] [data-test-file="readme.txt"]');
    await waitFor(
      '[data-test-markdown-embed-chooser-tab-panel="file"] [data-test-markdown-embed-preview-cta]:not([disabled])',
      { timeout: 5000 },
    );
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="file"] [data-test-markdown-embed-preview-cta]',
      )
      .hasText('Insert as Embedded', 'the format stuck across the tab switch');

    await click(
      '[data-test-markdown-embed-chooser-tab-panel="file"] [data-test-markdown-embed-preview-cta]',
    );
    let result = await pending;
    assert.deepEqual(
      result,
      { refType: 'file', url: readme, bfm: `::file[${readme} | embedded]` },
      'the file directive carries the format chosen on the cards tab',
    );
  });

  test('editing a size-less block directive preserves block placement', async function (assert) {
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
    // `::card[url]` — block placement, no size specifier.
    let pending = svc.editEmbed({ refType: 'card', url: mango, kind: 'block' });
    await waitFor('[data-test-markdown-embed-chooser-modal]');

    // Clean preload, so the CTA reads DONE; the seeded format reflects what a
    // size-less block embed actually renders as (embedded), not inline atom.
    await waitFor('[data-test-markdown-embed-preview-cta]:not([disabled])', {
      timeout: 5000,
    });
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-markdown-embed-preview-cta]',
      )
      .hasText('Done', 'a clean edit keeps the Done label');

    await click(
      '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-markdown-embed-preview-cta]',
    );
    let result = await pending;
    assert.deepEqual(
      result,
      { refType: 'card', url: mango, bfm: `::card[${mango} | embedded]` },
      'DONE re-serializes a block directive — not a collapsed inline atom',
    );
  });
});
