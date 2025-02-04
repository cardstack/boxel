import { click } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  percySnapshot,
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupServerSentEvents,
  testRealmURL,
  visitOperatorMode,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

module('Acceptance | code-submode | playground panel', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupMockMatrix(hooks, {
    loggedInAs: '@testuser:staging',
    activeRealms: [testRealmURL],
  });

  const authorCard = `
  import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
  import MarkdownField from 'https://cardstack.com/base/markdown';
  import StringField from "https://cardstack.com/base/string";
  export class Author extends CardDef {
    static displayName = 'Author';
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field bio = contains(MarkdownField);
    @field title = contains(StringField, {
      computeVia: function (this: Author) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <article>
          <header>
            <h1 data-test-author-title><@fields.title /></h1>
          </header>
          <p data-test-author-bio><@fields.bio /></p>
        </article>
        <style scoped>
          article {
            padding: 20px;
          }
        </style>
      </template>
    }
  }
`;
  const blogPostCard = `
  import { contains, field, linksTo, linksToMany, CardDef } from "https://cardstack.com/base/card-api";
  import DatetimeField from 'https://cardstack.com/base/datetime';
  import MarkdownField from 'https://cardstack.com/base/markdown';
  import StringField from "https://cardstack.com/base/string";
  import { Author } from './author';

  export class Category extends CardDef {
    static displayName = 'Category';
  }

  class Status extends StringField {
    static displayName = 'Status';
  }

  export class BlogPost extends CardDef {
    static displayName = 'Blog Post';
    @field publishDate = contains(DatetimeField);
    @field author = linksTo(Author);
    @field categories = linksToMany(Category);
    @field body = contains(MarkdownField);
    @field status = contains(Status, {
      computeVia: function (this: BlogPost) {
        if (!this.publishDate) {
          return 'Draft';
        }
        if (Date.now() >= Date.parse(String(this.publishDate))) {
          return 'Published';
        }
        return 'Scheduled';
      },
    });
  }
`;

  hooks.beforeEach(async function () {
    await setupAcceptanceTestRealm({
      contents: {
        'author.gts': authorCard,
        'blog-post.gts': blogPostCard,
        'Author/jane-doe.json': {
          data: {
            attributes: {
              firstName: 'Jane',
              lastName: 'Doe',
              bio: "Jane Doe is the Senior Managing Editor at <em>Ramped.com</em>, where she leads content strategy, editorial direction, and ensures the highest standards of quality across all publications. With over a decade of experience in digital media and editorial management, Jane has a proven track record of shaping impactful narratives, growing engaged audiences, and collaborating with cross-functional teams to deliver compelling content. When she's not editing, you can find her exploring new books, hiking, or indulging in her love of photography.",
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}author`,
                name: 'Author',
              },
            },
          },
        },
        'BlogPost/remote-work.json': {
          data: {
            attributes: {
              title: 'The Ultimate Guide to Remote Work',
              description:
                'In today’s digital age, remote work has transformed from a luxury to a necessity. This comprehensive guide will help you navigate the world of remote work, offering tips, tools, and best practices for success.',
            },
            relationships: {
              author: {
                links: {
                  self: `${testRealmURL}Author/jane-doe`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}blog-post`,
                name: 'BlogPost',
              },
            },
          },
        },
        'BlogPost/mad-hatter.json': {
          data: {
            attributes: { title: 'Mad As a Hatter' },
            relationships: {
              author: {
                links: {
                  self: `${testRealmURL}Author/jane-doe`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}blog-post`,
                name: 'BlogPost',
              },
            },
          },
        },
        'BlogPost/urban-living.json': {
          data: {
            attributes: {
              title:
                'The Future of Urban Living: Skyscrapers or Sustainable Communities?',
            },
            relationships: {
              author: {
                links: {
                  self: `${testRealmURL}Author/jane-doe`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}blog-post`,
                name: 'BlogPost',
              },
            },
          },
        },
        'Category/city-design.json': {
          data: {
            attributes: { title: 'City Design' },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}blog-post`,
                name: 'Category',
              },
            },
          },
        },
        'Category/future-tech.json': {
          data: {
            attributes: { title: 'Future Tech' },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}blog-post`,
                name: 'Category',
              },
            },
          },
        },
      },
    });
  });

  test('can render playground panel when a card def is selected', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}blog-post.gts`,
    });
    assert
      .dom(
        '[data-test-in-this-file-selector] [data-test-boxel-selector-item-selected] [data-test-boxel-selector-item-text="Category"]',
      )
      .exists();
    assert.dom('[data-test-accordion-item="playground"]').exists();

    // TODO: extend playground to field defs and test that it only works for field and card defs
    await click(
      '[data-test-in-this-file-selector] [data-test-boxel-selector-item-text="Status"]',
    );
    assert
      .dom('[data-test-accordion-item="playground"]')
      .doesNotExist('playground panel currently only exists for card defs');

    await click(
      '[data-test-in-this-file-selector] [data-test-boxel-selector-item-text="BlogPost"]',
    );
    await click('[data-test-accordion-item="playground"] button');
    assert.dom('[data-test-playground-panel]').exists();
  });

  test('can select from available instances using the instance chooser', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}blog-post.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    assert.dom('[data-test-instance-chooser]').hasText('Please Select');

    await click('[data-test-instance-chooser]');
    assert.dom('[data-option-index]').exists({ count: 2 });

    await click('[data-option-index="1"]');
    assert.dom('[data-test-selected-item]').hasText('Future Tech');

    await percySnapshot(assert);
  });

  test('can update the instance chooser when selected card def changes (same file)', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}blog-post.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    assert.dom('[data-option-index]').exists({ count: 2 });
    assert.dom('[data-option-index="0"]').hasText('City Design');
    await click('[data-option-index="0"]');
    assert.dom('[data-test-selected-item]').hasText('City Design');

    await click(
      '[data-test-in-this-file-selector] [data-test-boxel-selector-item-text="BlogPost"]',
    );
    await click('[data-test-instance-chooser]');
    assert.dom('[data-option-index]').exists({ count: 3 });
    assert.dom('[data-option-index="0"]').hasText('Mad As a Hatter');
    await click('[data-option-index="0"]');
    assert.dom('[data-test-selected-item]').hasText('Mad As a Hatter');
  });

  test('can update the instance chooser when a different file is opened', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}blog-post.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    assert.dom('[data-option-index]').exists({ count: 2 });
    assert.dom('[data-option-index="0"]').hasText('City Design');
    await click('[data-option-index="0"]');
    assert.dom('[data-test-selected-item]').hasText('City Design');

    await click('[data-test-file-browser-toggle]');
    await click('[data-test-file="author.gts"]');
    await click('[data-test-instance-chooser]');
    assert.dom('li.ember-power-select-option').exists({ count: 1 });
    assert.dom('[data-option-index="0"]').hasText('Jane Doe');
    await click('[data-option-index="0"]');
    assert.dom('[data-test-selected-item]').hasText('Jane Doe');
  });

  test('can display selected card in isolated format', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}author.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    await click('[data-option-index="0"]');
    assert
      .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
      .hasText('Author');
    assert
      .dom(
        `[data-test-playground-panel] [data-test-card="${testRealmURL}Author/jane-doe"][data-test-card-format="isolated"]`,
      )
      .exists();
    assert.dom('[data-test-author-title]').hasText('Jane Doe');
    assert
      .dom('[data-test-author-bio]')
      .containsText('Jane Doe is the Senior Managing Editor');
  });

  test('can use the header context menu to open instance in code mode', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}author.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    await click('[data-option-index="0"]');
    await click('[data-test-more-options-button]');
    assert
      .dom('[data-test-boxel-dropdown-content] [data-test-boxel-menu-item]')
      .exists({ count: 3 });

    await click('[data-test-boxel-menu-item-text="Open in Code Mode"]');
    assert
      .dom(
        `[data-test-code-mode-card-preview-header="${testRealmURL}Author/jane-doe"]`,
      )
      .exists();
    assert.dom('[data-test-accordion-item="playground"]').doesNotExist();
  });

  test('can use the header context menu to open instance in interact mode', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}author.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    await click('[data-option-index="0"]');
    await click('[data-test-more-options-button]');
    await click('[data-test-boxel-menu-item-text="Open in Interact Mode"]');
    assert
      .dom(
        `[data-test-stack-card-index="0"][data-test-stack-card="${testRealmURL}Author/jane-doe"]`,
      )
      .exists();
    assert.dom('[data-test-author-title]').hasText('Jane Doe');
  });

  test('can display selected card in the chosen format', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}author.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    await click('[data-option-index="0"]');
    assert
      .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
      .hasText('Author');
    assert
      .dom(
        `[data-test-playground-panel] [data-test-card="${testRealmURL}Author/jane-doe"][data-test-card-format="isolated"]`,
      )
      .exists();
    assert.dom('[data-test-author-title]').hasText('Jane Doe');
    assert
      .dom('[data-test-author-bio]')
      .containsText('Jane Doe is the Senior Managing Editor');
    assert
      .dom('[data-test-playground-panel-format-chooser-isolated]')
      .hasClass('active');

    await click('[data-test-playground-panel-format-chooser-embedded]');
    assert
      .dom('[data-test-playground-panel-format-chooser-isolated]')
      .hasNoClass('active');
    assert
      .dom('[data-test-playground-panel-format-chooser-embedded]')
      .hasClass('active');
    assert
      .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
      .doesNotExist();
    assert
      .dom(
        `[data-test-playground-panel] [data-test-card="${testRealmURL}Author/jane-doe"][data-test-card-format="embedded"]`,
      )
      .exists();

    await click('[data-test-playground-panel-format-chooser-edit]');
    assert
      .dom('[data-test-playground-panel-format-chooser-embedded]')
      .hasNoClass('active');
    assert
      .dom('[data-test-playground-panel-format-chooser-edit]')
      .hasClass('active');
    assert
      .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
      .hasText('Author');
    assert
      .dom(
        `[data-test-playground-panel] [data-test-card="${testRealmURL}Author/jane-doe"][data-test-card-format="edit"]`,
      )
      .exists();
  });

  test('can use the header context menu to open instance in edit format in interact mode', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}author.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    await click('[data-option-index="0"]');
    await click('[data-test-playground-panel-format-chooser-edit]');
    await click('[data-test-more-options-button]');
    await click('[data-test-boxel-menu-item-text="Open in Interact Mode"]');
    assert
      .dom(
        `[data-test-stack-card-index="0"][data-test-stack-card="${testRealmURL}Author/jane-doe"]`,
      )
      .exists();
    assert
      .dom(`[data-test-stack-item-content] [data-test-card-format="edit"]`)
      .exists();
  });
});
