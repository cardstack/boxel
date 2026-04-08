import type { RenderingTestContext } from '@ember/test-helpers';
import { waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  PermissionsContextName,
  type Permissions,
  baseRealm,
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

  test('edit template renders textarea for content', async function (assert) {
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
    assert.dom(root.querySelector('textarea')).exists('textarea is rendered');
    assert.dom(root.querySelector('textarea')).hasValue('Edit me');
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
              module: `${baseRealm.url}card-api`,
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
    let article = await store.get<BaseDef>(`${testRealmURL}article-1`);
    await store.loaded();

    await renderCard(loader, article, 'isolated');

    await waitFor('[data-test-pet-atom]', { timeout: 10_000 });

    assert
      .dom('[data-test-pet-atom]')
      .exists('inline card reference renders the referenced card in atom format');
    assert
      .dom('[data-test-pet-atom]')
      .hasText('Mango', 'inline atom shows the correct card');

    assert
      .dom('[data-test-pet-embedded]')
      .exists('block card reference renders the referenced card in embedded format');
    assert
      .dom('[data-test-pet-embedded]')
      .hasText('Mango', 'block embedded shows the correct card');
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
    let article = await store.get<BaseDef>(`${testRealmURL}article-1`);
    await store.loaded();

    await renderCard(loader, article, 'isolated');

    await waitFor('[data-test-pet-atom]', { timeout: 10_000 });

    assert
      .dom('[data-test-pet-atom]')
      .exists('inline card reference with relative path renders the referenced card');
    assert
      .dom('[data-test-pet-atom]')
      .hasText('Mango', 'inline atom shows the correct card');

    assert
      .dom('[data-test-pet-embedded]')
      .exists('block card reference with relative path renders the referenced card');
    assert
      .dom('[data-test-pet-embedded]')
      .hasText('Mango', 'block embedded shows the correct card');
  });
});
