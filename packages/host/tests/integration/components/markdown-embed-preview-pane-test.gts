import type { TOC } from '@ember/component/template-only';
import {
  type RenderingTestContext,
  click,
  fillIn,
  render,
  waitFor,
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

import EmbedFormatSelection from '@cardstack/host/components/markdown-embed-chooser/format-selection';
import MarkdownEmbedPreviewPane from '@cardstack/host/components/markdown-embed-chooser/pane';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import type StoreService from '@cardstack/host/services/store';

// The base-realm helper below exports `CardDef` as a value (for defining test
// card classes); import the instance *type* separately for annotations.

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

import type { CardDef as CardDefInstance } from '@cardstack/base/card-api';

const PaneBox: TOC<{ Blocks: { default: [] } }> = <template>
  <div class='pane-box'>
    {{yield}}
  </div>
  <style scoped>
    .pane-box {
      width: 553px;
      height: 480px;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--boxel-border-color, var(--boxel-300));
    }
  </style>
</template>;

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

class InsertHarness {
  inserts: string[] = [];
  onInsert = (bfm: string) => {
    this.inserts.push(bfm);
  };
  get last() {
    return this.inserts[this.inserts.length - 1];
  }
}

async function chooseFormat(value: string) {
  // BoxelSelect spreads attributes onto the PowerSelect trigger itself, so the
  // data-test attribute lands directly on the `.ember-power-select-trigger`
  // element (not a wrapper) — click it directly to open the dropdown.
  await click('[data-test-markdown-embed-preview-format-select]');
  await waitFor('.ember-power-select-option', { timeout: 3000 });
  await click(`[data-test-format-option="${value}"]`);
}

module('Integration | markdown-embed-preview-pane', function (hooks) {
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
      },
    });
    await getService('realm').login(testRealmURL);
  });

  async function loadCard(): Promise<CardDefInstance> {
    let store = getService('store') as StoreService;
    return (await store.get(mango)) as CardDefInstance;
  }

  test('atom is the default; both placements are available', async function (assert) {
    let card = await loadCard();
    let harness = new InsertHarness();
    let selection = new EmbedFormatSelection();
    await render(
      <template>
        <PaneBox>
          <HostContextProvider>
            <MarkdownEmbedPreviewPane
              @target={{card}}
              @refType='card'
              @selection={{selection}}
              @onInsert={{harness.onInsert}}
            />
          </HostContextProvider>
        </PaneBox>
      </template>,
    );

    assert
      .dom('[data-test-markdown-embed-preview-cta]')
      .hasText('Insert as Atom', 'CTA reflects the default Atom category');
    assert
      .dom('[data-test-markdown-embed-preview-block]')
      .isNotDisabled('Block toggle is available for every format');
    assert
      .dom('[data-test-markdown-embed-preview-size]')
      .doesNotExist('no W/H inputs for Atom');

    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(
      harness.last,
      `:card[${card.id}]`,
      'inline atom inserts the size-less inline directive',
    );

    // Atom is available in block placement too (`::card[url | atom]`); the BFM
    // grammar ticket makes the renderer honor it.
    await click('[data-test-markdown-embed-preview-block]');
    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(
      harness.last,
      `::card[${card.id} | atom]`,
      'block atom emits the atom specifier',
    );
  });

  test('embedded emits a block directive with the embedded keyword', async function (assert) {
    let card = await loadCard();
    let harness = new InsertHarness();
    let selection = new EmbedFormatSelection();
    await render(
      <template>
        <PaneBox>
          <HostContextProvider>
            <MarkdownEmbedPreviewPane
              @target={{card}}
              @refType='card'
              @selection={{selection}}
              @onInsert={{harness.onInsert}}
            />
          </HostContextProvider>
        </PaneBox>
      </template>,
    );

    await chooseFormat('embedded');
    assert
      .dom('[data-test-markdown-embed-preview-cta]')
      .hasText('Insert as Embedded');
    assert
      .dom('[data-test-markdown-embed-preview-block]')
      .isNotDisabled('Block re-enables for non-atom formats');

    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(harness.last, `::card[${card.id} | embedded]`);
  });

  test('the preview tracks the selected format in either placement', async function (assert) {
    let card = await loadCard();
    let harness = new InsertHarness();
    let selection = new EmbedFormatSelection();
    await render(
      <template>
        <PaneBox>
          <HostContextProvider>
            <MarkdownEmbedPreviewPane
              @target={{card}}
              @refType='card'
              @selection={{selection}}
              @onInsert={{harness.onInsert}}
            />
          </HostContextProvider>
        </PaneBox>
      </template>,
    );

    await chooseFormat('embedded');
    assert
      .dom('[data-test-markdown-embed-preview]')
      .hasAttribute(
        'data-test-markdown-embed-preview-format',
        'embedded',
        'block embedded previews in embedded format',
      );

    // Format and placement are independent: toggling to inline keeps the
    // embedded render rather than collapsing to atom.
    await click('[data-test-markdown-embed-preview-inline]');
    assert
      .dom('[data-test-markdown-embed-preview]')
      .hasAttribute(
        'data-test-markdown-embed-preview-format',
        'embedded',
        'inline still previews the selected embedded format',
      );
  });

  test('fitted variant prefills W/H and emits the variant id in both placements', async function (assert) {
    let card = await loadCard();
    let harness = new InsertHarness();
    let selection = new EmbedFormatSelection();
    await render(
      <template>
        <PaneBox>
          <HostContextProvider>
            <MarkdownEmbedPreviewPane
              @target={{card}}
              @refType='card'
              @selection={{selection}}
              @onInsert={{harness.onInsert}}
            />
          </HostContextProvider>
        </PaneBox>
      </template>,
    );

    await chooseFormat('tall-tile');
    assert
      .dom('[data-test-markdown-embed-preview-cta]')
      .hasText('Insert as Fitted');
    assert
      .dom('[data-test-markdown-embed-preview-width]')
      .hasValue('150', 'width prefilled from the variant');
    assert
      .dom('[data-test-markdown-embed-preview-height]')
      .hasValue('275', 'height prefilled from the variant');

    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(
      harness.last,
      `::card[${card.id} | tall-tile]`,
      'block emits the named variant id',
    );

    // Inline carries the size too, so the emitted directive keeps the named
    // variant — `:card[url | tall-tile]`.
    await click('[data-test-markdown-embed-preview-inline]');
    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(
      harness.last,
      `:card[${card.id} | tall-tile]`,
      'inline carries the same size specifier as block',
    );
  });

  test('editing W/H to unknown dims switches to Custom and emits w:/h:', async function (assert) {
    let card = await loadCard();
    let harness = new InsertHarness();
    let selection = new EmbedFormatSelection();
    await render(
      <template>
        <PaneBox>
          <HostContextProvider>
            <MarkdownEmbedPreviewPane
              @target={{card}}
              @refType='card'
              @selection={{selection}}
              @onInsert={{harness.onInsert}}
            />
          </HostContextProvider>
        </PaneBox>
      </template>,
    );

    await chooseFormat('tall-tile');
    await fillIn('[data-test-markdown-embed-preview-width]', '300');
    await fillIn('[data-test-markdown-embed-preview-height]', '200');

    assert
      .dom('[data-test-markdown-embed-preview-cta]')
      .hasText('Insert as Custom', 'unknown dims fall back to Custom');

    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(harness.last, `::card[${card.id} | w:300 h:200]`);
  });

  test('editing W/H to a known variant follows the dropdown to that variant', async function (assert) {
    let card = await loadCard();
    let harness = new InsertHarness();
    let selection = new EmbedFormatSelection();
    await render(
      <template>
        <PaneBox>
          <HostContextProvider>
            <MarkdownEmbedPreviewPane
              @target={{card}}
              @refType='card'
              @selection={{selection}}
              @onInsert={{harness.onInsert}}
            />
          </HostContextProvider>
        </PaneBox>
      </template>,
    );

    await chooseFormat('tall-tile');
    // regular-tile = 250x170
    await fillIn('[data-test-markdown-embed-preview-width]', '250');
    await fillIn('[data-test-markdown-embed-preview-height]', '170');

    assert
      .dom('[data-test-markdown-embed-preview-cta]')
      .hasText(
        'Insert as Fitted',
        'an exact match stays in the Fitted category',
      );

    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(
      harness.last,
      `::card[${card.id} | regular-tile]`,
      'the dropdown follows the dimensions to the matching variant',
    );
  });

  test('isolated emits in both placements', async function (assert) {
    let card = await loadCard();
    let harness = new InsertHarness();
    let selection = new EmbedFormatSelection();
    await render(
      <template>
        <PaneBox>
          <HostContextProvider>
            <MarkdownEmbedPreviewPane
              @target={{card}}
              @refType='card'
              @selection={{selection}}
              @onInsert={{harness.onInsert}}
            />
          </HostContextProvider>
        </PaneBox>
      </template>,
    );

    await chooseFormat('isolated');
    assert
      .dom('[data-test-markdown-embed-preview-cta]')
      .hasText('Insert as Isolated');
    assert
      .dom('[data-test-markdown-embed-preview]')
      .hasAttribute(
        'data-test-markdown-embed-preview-format',
        'isolated',
        'preview switches to isolated',
      );

    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(
      harness.last,
      `::card[${card.id} | isolated]`,
      'block isolated emits the isolated specifier',
    );

    await click('[data-test-markdown-embed-preview-inline]');
    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(
      harness.last,
      `:card[${card.id} | isolated]`,
      'inline isolated also carries the isolated specifier',
    );
  });

  test('inline + embedded emits the explicit specifier on CTA', async function (assert) {
    let card = await loadCard();
    let harness = new InsertHarness();
    let selection = new EmbedFormatSelection();
    await render(
      <template>
        <PaneBox>
          <HostContextProvider>
            <MarkdownEmbedPreviewPane
              @target={{card}}
              @refType='card'
              @selection={{selection}}
              @onInsert={{harness.onInsert}}
            />
          </HostContextProvider>
        </PaneBox>
      </template>,
    );

    await chooseFormat('embedded');
    await click('[data-test-markdown-embed-preview-inline]');
    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(
      harness.last,
      `:card[${card.id} | embedded]`,
      'inline embedded carries the embedded specifier',
    );
  });

  test('inline + custom dimensions emit w:/h: in the inline directive', async function (assert) {
    let card = await loadCard();
    let harness = new InsertHarness();
    let selection = new EmbedFormatSelection();
    await render(
      <template>
        <PaneBox>
          <HostContextProvider>
            <MarkdownEmbedPreviewPane
              @target={{card}}
              @refType='card'
              @selection={{selection}}
              @onInsert={{harness.onInsert}}
            />
          </HostContextProvider>
        </PaneBox>
      </template>,
    );

    await chooseFormat('tall-tile');
    await fillIn('[data-test-markdown-embed-preview-width]', '321');
    await fillIn('[data-test-markdown-embed-preview-height]', '210');
    await click('[data-test-markdown-embed-preview-inline]');
    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(
      harness.last,
      `:card[${card.id} | w:321 h:210]`,
      'inline custom carries w:/h:',
    );
  });

  test('refType drives the keyword (file)', async function (assert) {
    let card = await loadCard();
    let harness = new InsertHarness();
    let selection = new EmbedFormatSelection();
    await render(
      <template>
        <PaneBox>
          <HostContextProvider>
            <MarkdownEmbedPreviewPane
              @target={{card}}
              @refType='file'
              @selection={{selection}}
              @onInsert={{harness.onInsert}}
            />
          </HostContextProvider>
        </PaneBox>
      </template>,
    );

    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(
      harness.last,
      `:file[${card.id}]`,
      'atom inline file ref',
    );

    await chooseFormat('embedded');
    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(harness.last, `::file[${card.id} | embedded]`);
  });

  test('the inserted ref is relativized against the document base URL', async function (assert) {
    let card = await loadCard();
    let harness = new InsertHarness();
    let selection = new EmbedFormatSelection();
    // The editing document lives in a sibling directory (`posts/`) to the
    // picked card (`books/`), so the ref collapses to a `../`-relative form —
    // the same shape the codemirror format-picker path produces.
    let documentBaseUrl = `${testRealmURL}posts/my-post`;
    await render(
      <template>
        <PaneBox>
          <HostContextProvider>
            <MarkdownEmbedPreviewPane
              @target={{card}}
              @refType='card'
              @selection={{selection}}
              @documentBaseUrl={{documentBaseUrl}}
              @onInsert={{harness.onInsert}}
            />
          </HostContextProvider>
        </PaneBox>
      </template>,
    );

    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(
      harness.last,
      `:card[../books/mango]`,
      'the inline atom ref is relativized against the document base URL',
    );

    await chooseFormat('embedded');
    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(
      harness.last,
      `::card[../books/mango | embedded]`,
      'the block directive carries the relative ref plus the format specifier',
    );
  });

  test('atom, embedded, isolated carry the has-divider modifier; fitted/custom do not', async function (assert) {
    let card = await loadCard();
    let harness = new InsertHarness();
    let selection = new EmbedFormatSelection();
    await render(
      <template>
        <PaneBox>
          <HostContextProvider>
            <MarkdownEmbedPreviewPane
              @target={{card}}
              @refType='card'
              @selection={{selection}}
              @onInsert={{harness.onInsert}}
            />
          </HostContextProvider>
        </PaneBox>
      </template>,
    );

    await click('[data-test-markdown-embed-preview-format-select]');
    await waitFor('.ember-power-select-option', { timeout: 3000 });

    for (let value of ['atom', 'embedded', 'isolated']) {
      assert
        .dom(`[data-test-format-option="${value}"]`)
        .hasClass(
          'has-divider',
          `${value} wrapper carries has-divider so the dropdown can paint a gap below it`,
        );
    }
    for (let value of ['tall-tile', 'custom']) {
      assert
        .dom(`[data-test-format-option="${value}"]`)
        .doesNotHaveClass(
          'has-divider',
          `${value} wrapper has no divider — only the non-fitted heads do`,
        );
    }
  });

  test('a broken ref surfaces the broken preview; the CTA still serializes the broken URL', async function (assert) {
    let harness = new InsertHarness();
    let selection = new EmbedFormatSelection();
    let brokenUrl = `${testRealmURL}books/deleted`;
    let errorDoc = {
      status: 404,
      title: 'Not Found',
      message: `Could not find ${brokenUrl}`,
      additionalErrors: null,
    };
    await render(
      <template>
        <PaneBox>
          <HostContextProvider>
            <MarkdownEmbedPreviewPane
              @refType='card'
              @selection={{selection}}
              @onInsert={{harness.onInsert}}
              @brokenUrl={{brokenUrl}}
              @brokenDisplayName='Book'
              @errorDoc={{errorDoc}}
              @brokenState='not-found'
            />
          </HostContextProvider>
        </PaneBox>
      </template>,
    );

    assert
      .dom('[data-test-broken-link-template]')
      .exists('the broken-ref visual surfaces in the pane');
    assert.dom('[data-test-broken-link-type]').hasText('Book');

    await click('[data-test-markdown-embed-preview-cta]');
    assert.strictEqual(
      harness.last,
      `:card[${brokenUrl}]`,
      'the CTA serializes the broken URL so Done/Accept keep the ref',
    );
  });
});
