import { precompileTemplate } from '@ember/template-compilation';
import type { RenderingTestContext } from '@ember/test-helpers';
import { click, render, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  type Permissions,
  baseRRI,
  testRealmURL,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import cmContext from '@cardstack/host/lib/codemirror-context';

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

import type { BaseDef, CardDef as CardDefType } from '@cardstack/base/card-api';

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

  // CodeMirrorEditor lazy-loads its context via globalThis.__loadCodeMirror.
  // Wire it to the real context so the docked toolbar (and its mode selector)
  // actually render in these tests rather than the loading placeholder.
  hooks.beforeEach(function () {
    (globalThis as any).__loadCodeMirror = async () => cmContext;
  });
  hooks.afterEach(function () {
    delete (globalThis as any).__loadCodeMirror;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
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

  test('display path renders a relative card-ref pill in a prefix-mapped realm', async function (assert) {
    // End-to-end over the whole reference chain in a prefix-mapped realm: the
    // markdown field extracts the ref in RRI space, the query-backed
    // linkedCards field searches by that RRI, the index and the client-side
    // filter matcher tolerate the URL-form instance id, and the pill slot
    // matches — so the referenced card's atom actually renders. Guards the
    // regression where the client re-filter dropped the URL-form instance
    // against the RRI filter value, leaving the pill unresolved.
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
            meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
          },
        },
        'article-1.json': {
          data: {
            attributes: { body: { content: `Inline: :card[./Pet/mango]` } },
            meta: { adoptsFrom: { module: './article', name: 'ArticleCard' } },
          },
        },
      },
    });
    let virtualNetwork = getService('network').virtualNetwork;
    virtualNetwork.addRealmMapping('@test/cards/', testRealmURL);
    try {
      let store = getService('store');
      let article = (await store.get(
        `${testRealmURL}article-1`,
      )) as CardDefType;
      let refs = (article as any).body?.cardReferenceUrls;
      assert.deepEqual(
        refs,
        ['@test/cards/Pet/mango'],
        'the relative ref resolves against the prefix-form base into RRI space',
      );
      await renderCard(loader, article, 'isolated');
      await waitFor('[data-test-pet-atom]');
      assert
        .dom('[data-test-pet-atom]')
        .hasText('Mango', 'the referenced card renders as a pill');
    } finally {
      virtualNetwork.removeRealmMapping('@test/cards/');
    }
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

  test('compose preview resolves a relative card ref against a prefix-form base', async function (assert) {
    // Regression guard for the compose/edit path: when the realm is
    // prefix-mapped the editor's reference base is a prefix-form RRI, and a
    // relative embed (`:card[./Pet/mango]`) must resolve against it without a
    // VirtualNetwork. Before the fix, CodeMirrorEditor's resolveUrl did
    // `new URL(raw, base)`, which throws on a prefix base and falls back to the
    // raw ref — so the widget never matched the loaded card and stayed a
    // fallback. We render CodeMirrorEditor directly with the referenced card
    // supplied via `linkedCards`, isolating the ref-resolution from the
    // query-backed-field machinery.
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

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'pet.gts': { Pet },
        'Pet/mango.json': {
          data: {
            attributes: { name: 'Mango', cardTitle: 'Mango' },
            meta: {
              adoptsFrom: { module: '../pet', name: 'Pet' },
            },
          },
        },
      },
    });

    // Two-segment realm prefix (`@scope/name/`), matching how real realm
    // prefixes are namespaced (e.g. `@cardstack/base/`). Remove it afterward:
    // the network service's VirtualNetwork is shared across tests.
    let virtualNetwork = getService('network').virtualNetwork;
    virtualNetwork.addRealmMapping('@test/cards/', testRealmURL);
    try {
      let store = getService('store');
      // Served in canonical RRI form because the realm is prefix-mapped.
      let pet = (await store.get('@test/cards/Pet/mango')) as BaseDef;
      await store.loaded();
      assert.strictEqual(
        (pet as any).id,
        '@test/cards/Pet/mango',
        'precondition: the referenced card loads with a canonical RRI id',
      );

      let CodeMirrorEditor = (
        (await loader.import('@cardstack/base/codemirror-editor')) as {
          default: unknown;
        }
      ).default;
      let harness = {
        content: 'Inline: :card[./Pet/mango]',
        linkedCards: [pet],
        onUpdate: () => {},
      };

      await render(
        precompileTemplate(
          `<CodeMirrorEditor
             @content={{harness.content}}
             @onUpdate={{harness.onUpdate}}
             @linkedCards={{harness.linkedCards}}
             @cardReferenceBaseUrl="@test/cards/article-1"
             @livePreview={{true}}
           />`,
          {
            strictMode: true,
            scope: () => ({ CodeMirrorEditor, harness }),
          },
        ),
      );

      // With the fix, `./Pet/mango` resolves against the prefix base to
      // `@test/cards/Pet/mango`, matching the supplied card's id, so the
      // compose preview renders it. Before the fix it stayed an unresolved
      // fallback and this selector never appears.
      await waitFor('[data-test-pet-atom]', { timeout: 10_000 });
      assert
        .dom('[data-test-pet-atom]')
        .hasText('Mango', 'relative ref resolves and renders in the preview');
    } finally {
      virtualNetwork.removeRealmMapping('@test/cards/');
    }
  });

  test('inline card reference with a non-atom format resolves to an inline-block slot', async function (assert) {
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
                content: `Embedded inline: :card[${testRealmURL}Pet/mango | embedded]\n\nAtom inline: :card[${testRealmURL}Pet/mango | atom]\n`,
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

    // Both inline refs target the same card; the embedded one renders the
    // embedded format and the atom one renders atom.
    await waitFor('[data-test-pet-embedded]', { timeout: 10_000 });
    await waitFor('[data-test-pet-atom]', { timeout: 10_000 });

    let embeddedSlot = document
      .querySelector('[data-test-pet-embedded]')!
      .closest('[data-test-markdown-bfm-inline-card]');
    assert.ok(
      embeddedSlot,
      'the embedded inline ref renders inside an inline card slot',
    );
    assert
      .dom(embeddedSlot)
      .hasClass(
        'markdown-bfm-card-slot--inline-embed',
        'a non-atom inline embed flows as an inline-block slot',
      );
    assert
      .dom(embeddedSlot)
      .doesNotHaveClass(
        'markdown-bfm-card-slot--inline',
        'a non-atom inline embed does not use the atom pill flow class',
      );

    let atomSlot = document
      .querySelector('[data-test-pet-atom]')!
      .closest('[data-test-markdown-bfm-inline-card]');
    assert.ok(
      atomSlot,
      'the atom inline ref renders inside an inline card slot',
    );
    assert
      .dom(atomSlot)
      .hasClass(
        'markdown-bfm-card-slot--inline',
        'a plain (atom) inline ref keeps the atom pill flow class',
      );
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

  test('unresolved block ::file with fitted size spec carries the same footprint as ::card', async function (assert) {
    // A `::file[... | spec]` block ref honors fitted sizing the same way
    // `::card[... | spec]` does — the broken-link box adopts the fitted format
    // class and inline width/height.
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
        'article-file-fitted-unresolved.json': {
          data: {
            attributes: {
              body: {
                content: `::file[https://nonexistent.example/images/gone.png | 400x200]\n`,
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
      `${testRealmURL}article-file-fitted-unresolved`,
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
        'fitted file ref carries the fitted footprint class',
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

  // ── View selector + docked toolbar tests ──

  test('edit template renders a docked toolbar with the view selector', async function (assert) {
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

    await waitFor('[data-test-markdown-toolbar]');
    assert
      .dom('[data-test-markdown-toolbar]')
      .exists('docked toolbar is rendered');
    assert
      .dom('[data-test-markdown-mode-select]')
      .exists('view selector is rendered in the toolbar');

    // The view selector exposes all three modes
    await click('[data-test-markdown-mode-select]');
    assert
      .dom('[data-test-markdown-mode-option="compose"]')
      .exists('Compose option');
    assert
      .dom('[data-test-markdown-mode-option="source"]')
      .exists('Source option');
    assert
      .dom('[data-test-markdown-mode-option="preview"]')
      .exists('Preview option');
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

  test('formatting controls start disabled while the view selector stays enabled', async function (assert) {
    // Note: the enabled-on-focus transition is driven by CodeMirror's
    // view.hasFocus, which ANDs document.hasFocus(). Headless CI windows aren't
    // OS-focused, so that path can't be asserted here — it's exercised in the
    // app. This test covers the reliably-observable side: controls disabled
    // without focus, and the view selector working regardless of focus.
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

    await waitFor('[data-test-toolbar="bold"]');
    assert
      .dom('[data-test-toolbar="bold"]')
      .isDisabled('Bold is disabled before the editor gains focus');
    assert
      .dom('[data-test-toolbar="blockquote"]')
      .isDisabled('all formatting controls start disabled');

    // The view selector is always enabled — it opens even without editor focus
    // (the trigger is a div, so assert behavior rather than the disabled prop).
    await click('[data-test-markdown-mode-select]');
    assert
      .dom('[data-test-markdown-mode-option="source"]')
      .exists('view selector opens without editor focus');
    await click('[data-test-markdown-mode-option="compose"]');
  });

  test('selecting Preview shows rendered markdown and hides editor', async function (assert) {
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

    await waitFor('[data-test-markdown-mode-select]');
    await click('[data-test-markdown-mode-select]');
    await click('[data-test-markdown-mode-option="preview"]');

    assert
      .dom('[data-test-markdown-preview]')
      .exists('markdown preview is rendered');
    assert
      .dom('[data-test-codemirror-editor]')
      .doesNotExist('CodeMirror editor is not shown in preview mode');
    assert
      .dom('[data-test-markdown-preview] h1')
      .hasText('Hello World', 'heading is rendered as HTML');
    assert
      .dom('[data-test-markdown-preview] strong')
      .hasText('bold', 'bold text is rendered as HTML');
    // The view selector remains available in preview mode
    assert
      .dom('[data-test-markdown-mode-select]')
      .exists('view selector is still present in preview mode');
  });

  test('view selector works in preview mode to switch back to compose', async function (assert) {
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

    await waitFor('[data-test-markdown-mode-select]');
    // Switch to Preview
    await click('[data-test-markdown-mode-select]');
    await click('[data-test-markdown-mode-option="preview"]');
    assert.dom('[data-test-markdown-preview]').exists('preview is shown');

    // Switch back to Compose from the standalone preview-mode selector
    await click('[data-test-markdown-mode-select]');
    await click('[data-test-markdown-mode-option="compose"]');
    assert
      .dom('[data-test-markdown-preview]')
      .doesNotExist('preview is hidden after switching back');

    await waitFor('[data-test-markdown-toolbar]');
    let editorOrLoading =
      document.querySelector('[data-test-codemirror-editor]') ??
      document.querySelector('[data-test-codemirror-loading]');
    assert.ok(
      editorOrLoading,
      'editor is restored after switching back to Compose',
    );
  });
});
