import type { TOC } from '@ember/component/template-only';
import { type RenderingTestContext, render } from '@ember/test-helpers';

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
  type BfmSizeSpec,
} from '@cardstack/runtime-common';

import MarkdownEmbedPreview from '@cardstack/host/components/markdown-embed-chooser/preview';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import type StoreService from '@cardstack/host/services/store';

// The base-realm helper below exports `CardDef` as a value (for defining test
// card classes); import the instance *type* separately for annotations.
import type { CardDef as CardDefInstance } from 'https://cardstack.com/base/card-api';

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

const PreviewBox: TOC<{ Blocks: { default: [] } }> = <template>
  <div class='preview-box'>
    {{yield}}
  </div>
  <style scoped>
    .preview-box {
      width: 360px;
      min-height: 320px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
  </style>
</template>;

// Provides the contexts CardRenderer reads via @consume so the preview can
// render outside OperatorMode.
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

function styleOf(): string {
  return (
    document
      .querySelector('[data-test-markdown-embed-preview]')
      ?.getAttribute('style') ?? ''
  );
}

module('Integration | markdown-embed-preview', function (hooks) {
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

  test('renders atom format with no fitted sizing', async function (assert) {
    let card = await loadCard();
    await render(
      <template>
        <PreviewBox>
          <HostContextProvider>
            <MarkdownEmbedPreview @target={{card}} @format='atom' />
          </HostContextProvider>
        </PreviewBox>
      </template>,
    );
    assert
      .dom('[data-test-markdown-embed-preview]')
      .hasAttribute('data-test-markdown-embed-preview-format', 'atom');
    assert
      .dom('[data-test-markdown-embed-preview].markdown-embed-preview--fitted')
      .doesNotExist('atom carries no fitted sizing');
  });

  test('renders embedded format', async function (assert) {
    let card = await loadCard();
    await render(
      <template>
        <PreviewBox>
          <HostContextProvider>
            <MarkdownEmbedPreview @target={{card}} @format='embedded' />
          </HostContextProvider>
        </PreviewBox>
      </template>,
    );
    assert
      .dom('[data-test-markdown-embed-preview]')
      .hasAttribute('data-test-markdown-embed-preview-format', 'embedded');
  });

  test('renders a named fitted variant at its exact footprint', async function (assert) {
    let card = await loadCard();
    // tall-tile = 150x275
    let tallTile: BfmSizeSpec = { format: 'fitted', width: 150, height: 275 };
    await render(
      <template>
        <PreviewBox>
          <HostContextProvider>
            <MarkdownEmbedPreview
              @target={{card}}
              @format='fitted'
              @sizeSpec={{tallTile}}
            />
          </HostContextProvider>
        </PreviewBox>
      </template>,
    );
    assert
      .dom('[data-test-markdown-embed-preview]')
      .hasAttribute('data-test-markdown-embed-preview-format', 'fitted');
    let style = styleOf();
    assert.ok(style.includes('width: 150px'), `width applied (${style})`);
    assert.ok(style.includes('height: 275px'), `height applied (${style})`);
    assert.ok(style.includes('overflow: hidden'), 'fitted clips overflow');
  });

  test('renders an arbitrary custom W×H', async function (assert) {
    let card = await loadCard();
    let custom: BfmSizeSpec = { format: 'fitted', width: 300, height: 200 };
    await render(
      <template>
        <PreviewBox>
          <HostContextProvider>
            <MarkdownEmbedPreview
              @target={{card}}
              @format='fitted'
              @sizeSpec={{custom}}
            />
          </HostContextProvider>
        </PreviewBox>
      </template>,
    );
    let style = styleOf();
    assert.ok(style.includes('width: 300px'), `custom width (${style})`);
    assert.ok(style.includes('height: 200px'), `custom height (${style})`);
  });

  test('kind controls placement: inline renders a span, block renders a div', async function (assert) {
    let card = await loadCard();
    await render(
      <template>
        <PreviewBox>
          <HostContextProvider>
            <MarkdownEmbedPreview
              @target={{card}}
              @format='embedded'
              @kind='inline'
            />
          </HostContextProvider>
        </PreviewBox>
      </template>,
    );
    assert
      .dom('span[data-test-markdown-embed-preview]')
      .exists('inline kind renders a span');
    assert
      .dom('div[data-test-markdown-embed-preview]')
      .doesNotExist('no block wrapper for inline kind');
  });

  test('showSurroundingText wraps the embed in skeleton document text', async function (assert) {
    let card = await loadCard();
    await render(
      <template>
        <PreviewBox>
          <HostContextProvider>
            <MarkdownEmbedPreview
              @target={{card}}
              @format='atom'
              @kind='inline'
              @showSurroundingText={{true}}
            />
          </HostContextProvider>
        </PreviewBox>
      </template>,
    );
    // The real embed still renders…
    assert
      .dom('[data-test-markdown-embed-preview]')
      .hasAttribute('data-test-markdown-embed-preview-format', 'atom');
    // …flowing inside decorative skeleton document text (2 lines above + 2
    // below the paragraph that carries the inline embed).
    assert.dom('.markdown-embed-preview-doc__line').exists({ count: 4 });
    assert
      .dom(
        '.markdown-embed-preview-doc__para span[data-test-markdown-embed-preview]',
      )
      .exists('inline embed flows within the skeleton paragraph');
  });

  test('bare preview (no surrounding text) renders no skeleton document', async function (assert) {
    let card = await loadCard();
    await render(
      <template>
        <PreviewBox>
          <HostContextProvider>
            <MarkdownEmbedPreview @target={{card}} @format='atom' />
          </HostContextProvider>
        </PreviewBox>
      </template>,
    );
    assert
      .dom('[data-test-markdown-embed-preview]')
      .exists('the embed renders');
    assert
      .dom('.markdown-embed-preview-doc')
      .doesNotExist(
        'no skeleton document wrapper without @showSurroundingText',
      );
  });

  test('renders the broken-ref visual (not the embed) for a 404 with the card type name', async function (assert) {
    let brokenUrl = `${testRealmURL}Book/deleted`;
    let errorDoc = {
      status: 404,
      title: 'Not Found',
      message: `Could not find ${brokenUrl}`,
      additionalErrors: null,
    };
    await render(
      <template>
        <PreviewBox>
          <MarkdownEmbedPreview
            @brokenUrl={{brokenUrl}}
            @brokenTypeName='Book'
            @errorDoc={{errorDoc}}
            @brokenState='not-found'
            @format='embedded'
          />
        </PreviewBox>
      </template>,
    );
    assert
      .dom('[data-test-broken-link-template="embedded"]')
      .exists('the broken-ref visual renders in place of the embed');
    assert.dom('[data-test-broken-link-state="not-found"]').exists();
    assert.dom('[data-test-broken-link-type]').hasText('Book');
    assert.dom('[data-test-broken-link-url]').hasText(brokenUrl);
    assert
      .dom('[data-test-markdown-embed-preview]')
      .doesNotExist('no resolved embed for a broken ref');
  });

  test('renders the broken-ref visual for a non-404 error state', async function (assert) {
    let brokenUrl = `${testRealmURL}Book/exploded`;
    let errorDoc = {
      status: 500,
      title: 'Internal Server Error',
      message: 'TypeError: boom',
      stack: 'Error: boom\n    at Book.render (book.gts:1:1)',
      additionalErrors: null,
    };
    await render(
      <template>
        <PreviewBox>
          <MarkdownEmbedPreview
            @brokenUrl={{brokenUrl}}
            @brokenTypeName='Book'
            @errorDoc={{errorDoc}}
            @brokenState='error'
            @format='fitted'
          />
        </PreviewBox>
      </template>,
    );
    assert.dom('[data-test-broken-link-template="fitted"]').exists();
    assert.dom('[data-test-broken-link-state="error"]').exists();
    assert
      .dom('[data-test-broken-link-headline]')
      .hasText('Linked card failed to load');
  });

  test('a broken file ref is labelled by its filename', async function (assert) {
    let brokenUrl = `${testRealmURL}files/notes.md`;
    let errorDoc = {
      status: 404,
      title: 'Not Found',
      message: `Could not find ${brokenUrl}`,
      additionalErrors: null,
    };
    await render(
      <template>
        <PreviewBox>
          <MarkdownEmbedPreview
            @brokenUrl={{brokenUrl}}
            @brokenTypeName='notes.md'
            @errorDoc={{errorDoc}}
            @brokenState='not-found'
            @format='embedded'
          />
        </PreviewBox>
      </template>,
    );
    assert.dom('[data-test-broken-link-type]').hasText('notes.md');
  });

  test('a fitted broken ref takes the picked tile footprint and does not clip its overlay', async function (assert) {
    let brokenUrl = `${testRealmURL}Book/deleted`;
    let errorDoc = {
      status: 404,
      title: 'Not Found',
      message: `Could not find ${brokenUrl}`,
      additionalErrors: null,
    };
    // tall-tile = 150x275
    let tallTile: BfmSizeSpec = { format: 'fitted', width: 150, height: 275 };
    await render(
      <template>
        <PreviewBox>
          <MarkdownEmbedPreview
            @brokenUrl={{brokenUrl}}
            @brokenTypeName='Book'
            @errorDoc={{errorDoc}}
            @brokenState='not-found'
            @format='fitted'
            @sizeSpec={{tallTile}}
          />
        </PreviewBox>
      </template>,
    );
    let style =
      document
        .querySelector('[data-test-broken-link-template="fitted"]')
        ?.getAttribute('style') ?? '';
    assert.ok(
      style.includes('width: 150px'),
      `fitted broken box takes the picked width (${style})`,
    );
    assert.ok(
      style.includes('height: 275px'),
      `fitted broken box takes the picked height (${style})`,
    );
    // The root must not clip, or the reveal overlay would be cut off — only the
    // inner box clips its own content.
    assert.notOk(
      style.includes('overflow'),
      'the broken root does not set overflow, so the reveal overlay is not clipped',
    );
  });
});
