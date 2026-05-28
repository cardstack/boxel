import type { RenderingTestContext } from '@ember/test-helpers';
import { click, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  type Permissions,
  baseRealm,
  baseRRI,
  testRealmURL,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

import {
  provideConsumeContext,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  type CardDocFiles,
} from '../../helpers';
import {
  setupBaseRealm,
  CardDef,
  Component,
  StringField,
  RichMarkdownField,
  contains,
  field,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;

module('Integration | RichMarkdownField', function (hooks) {
  setupRenderingTest(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  setupBaseRealm(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    let permissions: Permissions = {
      canWrite: true,
      canRead: true,
    };
    provideConsumeContext(PermissionsContextName, permissions);
    loader = getService('loader-service').loader;
  });
  setupLocalIndexing(hooks);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('renders markdown as HTML', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static atom = class Atom extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: new RichMarkdownField({
        content: '# Hello World\n\nSome **bold** text.',
      }),
    });
    let root = await renderCard(loader, card, 'atom');
    assert.dom(root.querySelector('h1')).hasText('Hello World');
    assert.dom(root.querySelector('strong')).hasText('bold');
  });

  test('edit template renders CodeMirror editor for content', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static edit = class Edit extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: new RichMarkdownField({ content: 'Edit me' }),
    });
    let root = await renderCard(loader, card, 'edit');
    // CodeMirrorEditor shows a loading state or the editor depending on
    // whether the lazy module is available in the test environment
    let editor = root.querySelector('[data-test-codemirror-editor]');
    let loading = root.querySelector('[data-test-codemirror-loading]');
    let hasEditorOrLoading = editor !== null || loading !== null;
    assert.true(
      hasEditorOrLoading,
      'CodeMirror editor or loading state is rendered',
    );
  });

  test('renders with null content without error', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static edit = class Edit extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard();
    let root = await renderCard(loader, card, 'edit');
    assert.dom(root).exists('renders without error');
  });

  test('renders inline :card references as BFM elements', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static atom = class Atom extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: new RichMarkdownField({
        content: 'See :card[https://example.com/cards/1] for details.',
      }),
    });
    let root = await renderCard(loader, card, 'atom');
    assert
      .dom(root.querySelector('[data-boxel-bfm-inline-ref]'))
      .exists('inline card reference is rendered as BFM element');
    assert
      .dom(root.querySelector('[data-boxel-bfm-inline-ref]'))
      .hasAttribute('data-boxel-bfm-inline-ref', 'https://example.com/cards/1');
  });

  test('renders block ::card references as BFM elements', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static atom = class Atom extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: new RichMarkdownField({
        content: '::card[https://example.com/cards/2]\n',
      }),
    });
    let root = await renderCard(loader, card, 'atom');
    assert
      .dom(root.querySelector('[data-boxel-bfm-block-ref]'))
      .exists('block card reference is rendered as BFM element');
    assert
      .dom(root.querySelector('[data-boxel-bfm-block-ref]'))
      .hasAttribute('data-boxel-bfm-block-ref', 'https://example.com/cards/2');
  });

  test('cardReferenceUrls computes resolved URLs from markdown content', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: new RichMarkdownField({
        content:
          'See :card[https://example.com/cards/1] for details.\n\n::card[https://example.com/cards/2]\n',
      }),
    });
    await renderCard(loader, card, 'embedded');
    assert.deepEqual(
      card.body.cardReferenceUrls,
      ['https://example.com/cards/1', 'https://example.com/cards/2'],
      'cardReferenceUrls contains both inline and block reference URLs',
    );
  });

  test('cardReferenceUrls returns empty array for content without references', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: new RichMarkdownField({
        content: '# Just plain markdown\n\nNo card references here.',
      }),
    });
    await renderCard(loader, card, 'embedded');
    assert.deepEqual(
      card.body.cardReferenceUrls,
      [],
      'cardReferenceUrls is empty',
    );
  });

  test('linkedCards query resolves referenced cards from the realm', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    let sampleCards: CardDocFiles = {
      'referenced-card.json': {
        data: {
          type: 'card',
          attributes: {
            cardTitle: 'Referenced Card',
          },
          meta: {
            adoptsFrom: {
              module: baseRRI('card-api'),
              name: 'CardDef',
            },
          },
        },
      },
    };

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
        ...sampleCards,
      },
    });

    let card = new TestCard({
      body: new RichMarkdownField({
        content: `:card[${testRealmURL}referenced-card]`,
      }),
    });
    let root = await renderCard(loader, card, 'embedded');
    assert
      .dom(root.querySelector('[data-boxel-bfm-inline-ref]'))
      .exists('card reference placeholder is rendered');
  });

  test('renders footnotes', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static atom = class Atom extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: new RichMarkdownField({
        content:
          'Text with a footnote[^1].\n\n[^1]: This is the footnote content.',
      }),
    });
    let root = await renderCard(loader, card, 'atom');
    assert
      .dom(root.querySelector('.footnotes'))
      .exists('footnote section is rendered');
    assert.ok(
      root.textContent!.includes('This is the footnote content'),
      'footnote content is present',
    );
  });

  test('linkedCards render inside the markdown when card is loaded from realm', async function (assert) {
    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-pet-embedded><@fields.name /></div>
        </template>
      };
      static atom = class Atom extends Component<typeof this> {
        <template>
          <span data-test-pet-atom>{{@model.name}}</span>
        </template>
      };
    }

    class ArticleCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'pet.gts': { Pet },
        'article.gts': { ArticleCard },
        'Pet/mango.json': {
          data: {
            attributes: { name: 'Mango', cardTitle: 'Mango' },
            meta: {
              adoptsFrom: { module: '../pet', name: 'Pet' },
            },
          },
        },
        'article-1.json': {
          data: {
            attributes: {
              body: {
                content: `Inline ref: :card[${testRealmURL}Pet/mango]\n\nBlock ref:\n\n::card[${testRealmURL}Pet/mango]\n`,
              },
            },
            meta: {
              adoptsFrom: { module: './article', name: 'ArticleCard' },
            },
          },
        },
      },
    });

    let store = getService('store');
    let article = (await store.get(`${testRealmURL}article-1`)) as BaseDef;
    await store.loaded();

    await renderCard(loader, article, 'isolated');

    await waitFor('[data-test-pet-atom]', { timeout: 10_000 });

    assert
      .dom('[data-test-pet-atom]')
      .exists(
        'inline card reference renders the referenced card in atom format',
      );
    assert
      .dom('[data-test-pet-atom]')
      .hasText('Mango', 'inline atom shows the correct card');

    assert
      .dom('[data-test-pet-embedded]')
      .exists(
        'block card reference renders the referenced card in embedded format',
      );
    assert
      .dom('[data-test-pet-embedded]')
      .hasText('Mango', 'block embedded shows the correct card');

    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .doesNotExist('no unresolved Pill remains after card resolves (inline)');
    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .doesNotExist('no unresolved Pill remains after card resolves (block)');
  });

  test('card references show loading shimmer before linkedCards resolves, not broken Pills', async function (assert) {
    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
      static atom = class Atom extends Component<typeof this> {
        <template>
          <span data-test-pet-atom>{{@model.name}}</span>
        </template>
      };
    }

    class ArticleCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'pet.gts': { Pet },
        'article.gts': { ArticleCard },
        'Pet/mango.json': {
          data: {
            attributes: { name: 'Mango', cardTitle: 'Mango' },
            meta: {
              adoptsFrom: { module: '../pet', name: 'Pet' },
            },
          },
        },
        'article-1.json': {
          data: {
            attributes: {
              body: {
                content: `Inline ref: :card[${testRealmURL}Pet/mango]\n`,
              },
            },
            meta: {
              adoptsFrom: { module: './article', name: 'ArticleCard' },
            },
          },
        },
      },
    });

    let store = getService('store');
    let article = (await store.get(`${testRealmURL}article-1`)) as BaseDef;
    await store.loaded();

    await renderCard(loader, article, 'isolated');

    // Use a MutationObserver to detect if an unresolved Pill *ever* appears
    // during the loading→resolved transition. This catches regressions where
    // a deferred timer prematurely enables unresolved Pills, even if the flash
    // is too brief for a point-in-time assertion to catch.
    let unresolvedPillEverAppeared = false;
    let testRoot = document.querySelector('#ember-testing')!;
    let testObserver = new MutationObserver(() => {
      if (
        testRoot.querySelector('[data-test-markdown-bfm-unresolved-inline]')
      ) {
        unresolvedPillEverAppeared = true;
      }
    });
    testObserver.observe(testRoot, { childList: true, subtree: true });

    let inlineRef = document.querySelector('[data-boxel-bfm-inline-ref]');
    assert.ok(inlineRef, 'card ref element exists in the DOM');

    // Wait for the card to resolve
    await waitFor('[data-test-pet-atom]', { timeout: 10_000 });

    testObserver.disconnect();

    assert.false(
      unresolvedPillEverAppeared,
      'no broken Pill flashed during the loading→resolved transition',
    );
    assert
      .dom('[data-test-pet-atom]')
      .hasText('Mango', 'card resolves correctly');
    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .doesNotExist('no unresolved Pill after card resolves');
  });

  test('unresolved card references render as muted Pill indicators', async function (assert) {
    class ArticleCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'article.gts': { ArticleCard },
        'article-unresolved.json': {
          data: {
            attributes: {
              body: {
                content: `Inline: :card[https://nonexistent.example/Pet/missing]\n\nBlock:\n\n::card[https://nonexistent.example/BlogPost/gone]\n`,
              },
            },
            meta: {
              adoptsFrom: { module: './article', name: 'ArticleCard' },
            },
          },
        },
      },
    });

    let store = getService('store');
    let article = (await store.get(
      `${testRealmURL}article-unresolved`,
    )) as BaseDef;
    await store.loaded();

    await renderCard(loader, article, 'isolated');

    await waitUntil(
      () =>
        document.querySelector('[data-test-markdown-bfm-unresolved-inline]') !==
        null,
      { timeout: 10_000 },
    );

    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .hasText('Pet', 'inline unresolved ref shows type name in Pill');
    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .hasAttribute(
        'title',
        'https://nonexistent.example/Pet/missing',
        'inline Pill title shows the raw URL',
      );

    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .exists('block unresolved ref renders a Pill');
    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .hasAttribute(
        'title',
        'https://nonexistent.example/BlogPost/gone',
        'block Pill title shows the raw URL',
      );
  });

  test('unresolved block ref with fitted size spec carries the card footprint', async function (assert) {
    // Exercises the base default-templates/markdown.gts path (mirrors the
    // host's rendered-markdown coverage). The broken-link box should adopt
    // the fitted format class + inline width/height so the layout matches
    // the eventual card.
    class ArticleCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'article.gts': { ArticleCard },
        'article-fitted-unresolved.json': {
          data: {
            attributes: {
              body: {
                content: `::card[https://nonexistent.example/BlogPost/gone | 400x200]\n`,
              },
            },
            meta: {
              adoptsFrom: { module: './article', name: 'ArticleCard' },
            },
          },
        },
      },
    });

    let store = getService('store');
    let article = (await store.get(
      `${testRealmURL}article-fitted-unresolved`,
    )) as BaseDef;
    await store.loaded();

    await renderCard(loader, article, 'isolated');

    await waitUntil(
      () =>
        document.querySelector('[data-test-markdown-bfm-unresolved-block]') !==
        null,
      { timeout: 10_000 },
    );

    let brokenBlock = document.querySelector(
      '[data-test-markdown-bfm-unresolved-block]',
    ) as HTMLElement | null;
    assert.ok(brokenBlock, 'broken-link block exists');
    assert
      .dom(brokenBlock)
      .hasClass(
        'markdown-bfm-broken--fitted',
        'fitted ref carries the fitted footprint class',
      );
    let style = brokenBlock?.getAttribute('style') ?? '';
    assert.true(
      /width:\s*400px/.test(style),
      `broken-link inline style includes width: 400px (got "${style}")`,
    );
    assert.true(
      /height:\s*200px/.test(style),
      `broken-link inline style includes height: 200px (got "${style}")`,
    );
  });

  test('linkedCards resolve when markdown uses relative card references', async function (assert) {
    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-pet-embedded><@fields.name /></div>
        </template>
      };
      static atom = class Atom extends Component<typeof this> {
        <template>
          <span data-test-pet-atom>{{@model.name}}</span>
        </template>
      };
    }

    class ArticleCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'pet.gts': { Pet },
        'article.gts': { ArticleCard },
        'Pet/mango.json': {
          data: {
            attributes: { name: 'Mango', cardTitle: 'Mango' },
            meta: {
              adoptsFrom: { module: '../pet', name: 'Pet' },
            },
          },
        },
        'article-1.json': {
          data: {
            attributes: {
              body: {
                content: `Inline ref: :card[./Pet/mango]\n\nBlock ref:\n\n::card[./Pet/mango]\n`,
              },
            },
            meta: {
              adoptsFrom: { module: './article', name: 'ArticleCard' },
            },
          },
        },
      },
    });

    let store = getService('store');
    let article = (await store.get(`${testRealmURL}article-1`)) as BaseDef;
    await store.loaded();

    await renderCard(loader, article, 'isolated');

    await waitFor('[data-test-pet-atom]', { timeout: 10_000 });

    assert
      .dom('[data-test-pet-atom]')
      .exists(
        'inline card reference with relative path renders the referenced card',
      );
    assert
      .dom('[data-test-pet-atom]')
      .hasText('Mango', 'inline atom shows the correct card');

    assert
      .dom('[data-test-pet-embedded]')
      .exists(
        'block card reference with relative path renders the referenced card',
      );
    assert
      .dom('[data-test-pet-embedded]')
      .hasText('Mango', 'block embedded shows the correct card');

    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .doesNotExist('no unresolved Pill remains after card resolves (inline)');
    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .doesNotExist('no unresolved Pill remains after card resolves (block)');
  });

  // ── Mode switcher tests ──

  test('edit template renders mode switcher with Compose, Source, and Preview buttons', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static edit = class Edit extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: new RichMarkdownField({ content: 'Hello world' }),
    });
    await renderCard(loader, card, 'edit');

    assert.dom('[data-test-mode-switcher]').exists('mode switcher is rendered');
    assert
      .dom('[data-test-mode-compose]')
      .hasText('Compose', 'Compose button is rendered');
    assert
      .dom('[data-test-mode-source]')
      .hasText('Source', 'Source button is rendered');
    assert
      .dom('[data-test-mode-preview]')
      .hasText('Preview', 'Preview button is rendered');
  });

  test('default mode shows editor, not preview', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static edit = class Edit extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: new RichMarkdownField({ content: 'Hello world' }),
    });
    await renderCard(loader, card, 'edit');

    assert
      .dom('[data-test-markdown-preview]')
      .doesNotExist('preview is not shown by default');
    // CodeMirror editor should be present (either loaded or loading)
    let editorOrLoading =
      document.querySelector('[data-test-codemirror-editor]') ??
      document.querySelector('[data-test-codemirror-loading]');
    assert.ok(editorOrLoading, 'editor is shown by default (edit mode)');
  });

  test('clicking Preview shows rendered markdown and hides editor', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static edit = class Edit extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: new RichMarkdownField({
        content: '# Hello World\n\nSome **bold** text.',
      }),
    });
    await renderCard(loader, card, 'edit');

    await click('[data-test-mode-preview]');

    assert
      .dom('[data-test-markdown-preview]')
      .exists('markdown preview is rendered');
    assert
      .dom('[data-test-codemirror-editor]')
      .doesNotExist('CodeMirror editor is not shown in preview mode');
    assert
      .dom('[data-test-codemirror-loading]')
      .doesNotExist('CodeMirror loading is not shown in preview mode');
    assert
      .dom('[data-test-markdown-preview] h1')
      .hasText('Hello World', 'heading is rendered as HTML');
    assert
      .dom('[data-test-markdown-preview] strong')
      .hasText('bold', 'bold text is rendered as HTML');
  });

  test('clicking Source hides preview and shows editor', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static edit = class Edit extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: new RichMarkdownField({ content: 'Hello world' }),
    });
    await renderCard(loader, card, 'edit');

    await click('[data-test-mode-source]');

    assert
      .dom('[data-test-markdown-preview]')
      .doesNotExist('preview is not shown in source mode');
    let editorOrLoading =
      document.querySelector('[data-test-codemirror-editor]') ??
      document.querySelector('[data-test-codemirror-loading]');
    assert.ok(editorOrLoading, 'editor is shown in source mode');
  });

  test('switching from Preview back to Compose restores editor', async function (assert) {
    class TestCard extends CardDef {
      @field body = contains(RichMarkdownField);
      static edit = class Edit extends Component<typeof this> {
        <template><@fields.body /></template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'test-card.gts': { TestCard },
      },
    });

    let card = new TestCard({
      body: new RichMarkdownField({ content: 'Hello world' }),
    });
    await renderCard(loader, card, 'edit');

    // Switch to Preview
    await click('[data-test-mode-preview]');
    assert.dom('[data-test-markdown-preview]').exists('preview is shown');

    // Switch back to Compose
    await click('[data-test-mode-compose]');
    assert
      .dom('[data-test-markdown-preview]')
      .doesNotExist('preview is hidden after switching back');
    let editorOrLoading =
      document.querySelector('[data-test-codemirror-editor]') ??
      document.querySelector('[data-test-codemirror-loading]');
    assert.ok(
      editorOrLoading,
      'editor is restored after switching back to Compose',
    );
  });
});
