import { click, fillIn, waitFor, waitUntil } from '@ember/test-helpers';

import window from 'ember-window-mock';
import { module, test } from 'qunit';

import type { Realm } from '@cardstack/runtime-common';

import { PlaygroundSelections } from '@cardstack/host/utils/local-storage-keys';

import type { Format } from 'https://cardstack.com/base/card-api';

import {
  percySnapshot,
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  testRealmURL,
  visitOperatorMode,
  type TestContextWithSave,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

let matrixRoomId: string;
module('Acceptance | code-submode | playground panel', function (hooks) {
  let realm: Realm;
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { setRealmPermissions, setActiveRealms, createAndJoinRoom } =
    mockMatrixUtils;

  setupOnSave(hooks);

  const codeRefDriverCard = `import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import CodeRefField from 'https://cardstack.com/base/code-ref';
export class CodeRefDriver extends CardDef {
  static displayName = "Code Ref Driver";
  @field ref = contains(CodeRefField);
}`;

  const authorCard = `import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
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
      <div data-test-author-bio><@fields.bio /></div>
    </article>
    <style scoped>
      article {
        margin-inline: 20px;
      }
    </style>
  </template>
  }
}`;

  const blogPostCard = `import { contains, field, linksTo, linksToMany, CardDef, Component } from "https://cardstack.com/base/card-api";
import DatetimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';
import StringField from "https://cardstack.com/base/string";
import { Author } from './author';

export class Category extends CardDef {
  static displayName = 'Category';
  static fitted = class Fitted extends Component<typeof this> {
  <template>
    <div data-test-category-fitted><@fields.title /></div>
  </template>
  }
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

  static isolated = class Isolated extends Component<typeof this> {
  <template>
    <article>
      <header>
        <h1 data-test-post-title><@fields.title /></h1>
      </header>
      <div data-test-byline><@fields.author /></div>
      <div data-test-post-body><@fields.body /></div>
    </article>
    <style scoped>
      article {
        margin-inline: 20px;
      }
    </style>
  </template>
  }
}`;

  hooks.beforeEach(async function () {
    matrixRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription(matrixRoomId);

    ({ realm } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'author.gts': authorCard,
        'blog-post.gts': blogPostCard,
        'code-ref-driver.gts': codeRefDriverCard,
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
    }));
    window.localStorage.setItem(
      'recent-files',
      JSON.stringify([
        [testRealmURL, 'blog-post.gts'],
        [testRealmURL, 'author.gts'],
        [testRealmURL, 'BlogPost/mad-hatter.json'],
        [testRealmURL, 'Category/city-design.json'],
        [testRealmURL, 'Category/future-tech.json'],
        [testRealmURL, 'BlogPost/remote-work.json'],
        [testRealmURL, 'BlogPost/urban-living.json'],
        [testRealmURL, 'Author/jane-doe.json'],
      ]),
    );
    window.localStorage.setItem(PlaygroundSelections, '');

    setActiveRealms([testRealmURL]);
    setRealmPermissions({
      [testRealmURL]: ['read', 'write'],
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

  test('can populate instance chooser dropdown options from recent files', async function (assert) {
    window.localStorage.setItem('recent-files', '');
    window.localStorage.setItem(PlaygroundSelections, '');

    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}blog-post.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    assert.dom('[data-test-instance-chooser]').hasText('Please Select');

    window.localStorage.setItem(
      'recent-files',
      JSON.stringify([
        [testRealmURL, 'BlogPost/mad-hatter.json'],
        [testRealmURL, 'Category/future-tech.json'],
        [testRealmURL, 'Category/city-design.json'],
        [testRealmURL, 'BlogPost/remote-work.json'],
        [testRealmURL, 'BlogPost/urban-living.json'],
        [testRealmURL, 'Author/jane-doe.json'],
      ]),
    );
    await click('[data-test-instance-chooser]');
    assert
      .dom('[data-option-index] [data-test-category-fitted]')
      .exists({ count: 2 });

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
    assert.dom('[data-option-index="0"]').containsText('City Design');
    await click('[data-option-index="0"]');
    assert.dom('[data-test-selected-item]').containsText('City Design');

    await click(
      '[data-test-in-this-file-selector] [data-test-boxel-selector-item-text="BlogPost"]',
    );
    await click('[data-test-instance-chooser]');
    assert.dom('[data-option-index]').exists({ count: 3 });
    assert.dom('[data-option-index="0"]').containsText('Mad As a Hatter');
    await click('[data-option-index="0"]');
    assert.dom('[data-test-selected-item]').containsText('Mad As a Hatter');
  });

  test('can update the instance chooser when a different file is opened', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}blog-post.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    assert.dom('[data-option-index]').exists({ count: 2 });
    assert.dom('[data-option-index="0"]').containsText('City Design');
    await click('[data-option-index="0"]');
    assert.dom('[data-test-selected-item]').containsText('City Design');

    await click('[data-test-file-browser-toggle]');
    await click('[data-test-file="author.gts"]');
    await click('[data-test-accordion-item="playground"] button');
    assert.dom('[data-test-instance-chooser]').hasText('Please Select');
    await click('[data-test-instance-chooser]');
    assert.dom('li.ember-power-select-option').exists({ count: 1 });
    assert.dom('[data-option-index="0"]').containsText('Jane Doe');
    await click('[data-option-index="0"]');
    assert.dom('[data-test-selected-item]').containsText('Jane Doe');
  });

  test('can populate playground preview with previous choices saved in local storage', async function (assert) {
    let selections = {
      [`${testRealmURL}author/Author`]: {
        cardId: `${testRealmURL}Author/jane-doe`,
      },
      [`${testRealmURL}blog-post/BlogPost`]: {
        cardId: `${testRealmURL}BlogPost/remote-work`,
      },
      [`${testRealmURL}blog-post/Category`]: {
        cardId: `${testRealmURL}Category/city-design`,
      },
    };
    window.localStorage.setItem(
      PlaygroundSelections,
      JSON.stringify(selections),
    );
    const assertCardExists = (fileName: string) => {
      const dataAttr = `[data-test-playground-panel] [data-test-card="${testRealmURL}${fileName}"]`;
      assert.dom(dataAttr).exists();
    };
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}author.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    assert.dom('[data-test-selected-item]').hasText('Jane Doe');
    assertCardExists('Author/jane-doe');

    await click(`[data-test-recent-file="${testRealmURL}blog-post.gts"]`);
    assert.dom('[data-test-selected-item]').hasText('City Design');
    assertCardExists('Category/city-design');

    await click(
      '[data-test-in-this-file-selector] [data-test-boxel-selector-item-text="BlogPost"]',
    );
    assert.dom('[data-test-selected-item]').containsText('Remote Work');
    assertCardExists('BlogPost/remote-work');
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
    assert.dom('[data-test-format-chooser-isolated]').hasClass('active');

    await click('[data-test-format-chooser-embedded]');
    assert.dom('[data-test-format-chooser-isolated]').hasNoClass('active');
    assert.dom('[data-test-format-chooser-embedded]').hasClass('active');
    assert
      .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
      .doesNotExist();
    assert
      .dom(
        `[data-test-playground-panel] [data-test-card="${testRealmURL}Author/jane-doe"][data-test-card-format="embedded"]`,
      )
      .exists();

    await click('[data-test-format-chooser-edit]');
    assert.dom('[data-test-format-chooser-embedded]').hasNoClass('active');
    assert.dom('[data-test-format-chooser-edit]').hasClass('active');
    assert
      .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
      .hasText('Author');
    assert
      .dom(
        `[data-test-playground-panel] [data-test-card="${testRealmURL}Author/jane-doe"][data-test-card-format="edit"]`,
      )
      .exists();

    await click('[data-test-format-chooser-atom]');
    assert.dom('[data-test-format-chooser-edit]').hasNoClass('active');
    assert.dom('[data-test-format-chooser-atom]').hasClass('active');

    assert
      .dom('[data-test-atom-preview]')
      .hasText(
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do Jane Doe tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
      );

    await click('[data-test-format-chooser-fitted]');
    assert.dom('[data-test-format-chooser-atom]').hasNoClass('active');
    assert.dom('[data-test-format-chooser-fitted]').hasClass('active');
    assert
      .dom('[data-test-playground-panel] [data-test-card-format="fitted"]')
      .exists({ count: 16 });
  });

  test('can toggle edit format via button on card header', async function (assert) {
    const playgroundCard = `[data-test-playground-panel] [data-test-card="${testRealmURL}Author/jane-doe"]`;
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
    assert.dom(`${playgroundCard}[data-test-card-format="isolated"]`).exists();
    assert.dom('[data-test-author-title]').hasText('Jane Doe');
    assert.dom('[data-test-format-chooser-isolated]').hasClass('active');
    await click(
      '[data-test-boxel-card-header-actions] [data-test-edit-button]',
    );

    assert.dom(`${playgroundCard}[data-test-card-format="edit"]`).exists();
    assert.dom('[data-test-card-header]').hasClass('is-editing');
    assert.dom('[data-test-format-chooser-isolated]').hasNoClass('active');
    assert.dom('[data-test-format-chooser-edit]').hasClass('active');
    await click(
      '[data-test-boxel-card-header-actions] [data-test-edit-button]',
    );

    assert.dom(`${playgroundCard}[data-test-card-format="isolated"]`).exists();
    assert.dom('[data-test-card-header]').hasNoClass('is-editing');
    assert.dom('[data-test-format-chooser-edit]').hasNoClass('active');
    assert.dom('[data-test-format-chooser-isolated]').hasClass('active');
  });

  test('can use the header context menu to open instance in edit format in interact mode', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}author.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    await click('[data-option-index="0"]');
    await click('[data-test-format-chooser-edit]');
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

  test('can choose another instance to be opened in playground panel', async function (assert) {
    window.localStorage.removeItem('recent-files');
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}blog-post.gts`,
    });

    await click('[data-boxel-selector-item-text="BlogPost"]');
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    await click('[data-test-choose-another-instance]');
    assert.dom('[data-test-card-catalog-modal]').exists();
    assert.dom('[data-test-card-catalog-item]').exists({ count: 3 });
    assert
      .dom(`[data-test-card-catalog-item="${testRealmURL}BlogPost/mad-hatter"]`)
      .exists();
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}BlogPost/urban-living"]`,
      )
      .exists();
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}BlogPost/remote-work"]`,
      )
      .exists();

    await click(
      `[data-test-card-catalog-item="${testRealmURL}BlogPost/mad-hatter"]`,
    );
    await click('[data-test-card-catalog-go-button]');
    assert
      .dom(
        `[data-test-playground-panel] [data-test-card="${testRealmURL}BlogPost/mad-hatter"][data-test-card-format="isolated"]`,
      )
      .exists();
    let recentFiles = JSON.parse(window.localStorage.getItem('recent-files')!);
    assert.deepEqual(recentFiles[0], [
      testRealmURL,
      'BlogPost/mad-hatter.json',
      null,
    ]);
  });

  test('can create new instance', async function (assert) {
    window.localStorage.removeItem('recent-files');
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}blog-post.gts`,
    });
    let recentFiles = JSON.parse(window.localStorage.getItem('recent-files')!);
    assert.deepEqual(recentFiles[0], [
      testRealmURL,
      'blog-post.gts',
      { column: 38, line: 7 },
    ]);
    await click('[data-boxel-selector-item-text="BlogPost"]');
    await click('[data-test-accordion-item="playground"] button');
    assert
      .dom('[data-test-instance-chooser] [data-test-selected-item]')
      .doesNotExist();

    await click('[data-test-instance-chooser]');
    await click('[data-test-create-instance]');

    recentFiles = JSON.parse(window.localStorage.getItem('recent-files')!);
    assert.strictEqual(recentFiles.length, 2, 'recent file count is correct');
    let newCardId = `${recentFiles[0][0]}${recentFiles[0][1]}`.replace(
      '.json',
      '',
    );
    assert
      .dom('[data-test-instance-chooser] [data-test-selected-item]')
      .hasText('Untitled Blog Post', 'created instance is selected');
    assert
      .dom(
        `[data-test-playground-panel] [data-test-card="${newCardId}"][data-test-card-format="edit"]`,
      )
      .exists('new card is rendered in edit format');

    await click('[data-test-instance-chooser]');
    assert
      .dom('[data-option-index]')
      .exists({ count: 1 }, 'dropdown instance count is correct');
    assert.dom('[data-option-index]').containsText('Blog Post');
  });

  test('can create new instance with CodeRef field', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}code-ref-driver.gts`,
    });
    await click('[data-boxel-selector-item-text="CodeRefDriver"]');
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    await click('[data-test-create-instance]');

    assert
      .dom('[data-test-instance-chooser] [data-test-selected-item]')
      .hasText('Untitled Code Ref Driver', 'created instance is selected');
    assert
      .dom(
        `[data-test-playground-panel] [data-test-card][data-test-card-format="edit"]`,
      )
      .exists('new card is rendered in edit format');
    assert
      .dom(
        '[data-test-playground-panel] [data-test-card] [data-test-field="ref"] input',
      )
      .hasNoValue('code ref field is empty');
  });

  test('can set relative CodeRef field', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}code-ref-driver.gts`,
    });
    await click('[data-boxel-selector-item-text="CodeRefDriver"]');
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    await click('[data-test-create-instance]');

    assert
      .dom(
        '[data-test-playground-panel] [data-test-card] [data-test-ref] [data-test-boxel-input-validation-state="valid"]',
      )
      .doesNotExist('code ref validity is not set');
    await fillIn(
      '[data-test-playground-panel] [data-test-card] [data-test-field="ref"] input',
      `../blog-post/BlogPost`,
    );
    await waitFor(
      '[data-test-playground-panel] [data-test-card] [data-test-hasValidated]',
    );
    assert
      .dom(
        '[data-test-playground-panel] [data-test-card] [data-test-field="ref"] [data-test-boxel-input-validation-state="valid"]',
      )
      .exists('code ref is valid');
  });

  test('playground preview for card with contained fields can live update when module changes', async function (assert) {
    // change: added "Hello" before rendering title on the template
    const authorCard = `import { contains, field, CardDef, Component } from "https://cardstack.com/base/card-api";
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
      <h1 data-test-author-title>Hello <@fields.title /></h1>
    </header>
    <div data-test-author-bio><@fields.bio /></div>
  </article>
  <style scoped>
    article {
      margin-inline: 20px;
    }
  </style>
</template>
  }
}`;
    await visitOperatorMode({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}author.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    await click('[data-option-index="0"]');
    assert.dom('[data-test-author-title]').containsText('Jane Doe');

    await realm.write('author.gts', authorCard);

    await waitUntil(() =>
      document
        .querySelector('[data-test-author-title]')
        ?.textContent?.includes('Hello'),
    );

    assert.dom('[data-test-author-title]').containsText('Hello Jane Doe');
  });

  test('playground preview for card with linked fields can live update when module changes', async function (assert) {
    // change: added "Hello" before rendering title on the template
    const blogPostCard = `import { contains, field, linksTo, linksToMany, CardDef, Component } from "https://cardstack.com/base/card-api";
import DatetimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';
import StringField from "https://cardstack.com/base/string";
import { Author } from './author';

export class Category extends CardDef {
  static displayName = 'Category';
  static fitted = class Fitted extends Component<typeof this> {
  <template>
    <div data-test-category-fitted><@fields.title /></div>
  </template>
  }
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

  static isolated = class Isolated extends Component<typeof this> {
  <template>
    <article>
      <header>
        <h1 data-test-post-title>Hello <@fields.title /></h1>
      </header>
      <div data-test-byline><@fields.author /></div>
      <div data-test-post-body><@fields.body /></div>
    </article>
    <style scoped>
      article {
        margin-inline: 20px;
      }
    </style>
  </template>
  }
}`;

    await visitOperatorMode({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}blog-post.gts`,
    });
    await click('[data-test-boxel-selector-item-text="BlogPost"]');
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    await click('[data-option-index="0"]');
    assert.dom('[data-test-post-title]').hasText('Mad As a Hatter');

    await realm.write('blog-post.gts', blogPostCard);

    await waitUntil(() =>
      document
        .querySelector('[data-test-post-title]')
        ?.textContent?.includes('Hello'),
    );

    assert.dom('[data-test-post-title]').includesText('Hello Mad As a Hatter');
  });

  test('can remember format choice via local storage', async function (assert) {
    const authorModuleId = `${testRealmURL}author/Author`;
    const categoryModuleId = `${testRealmURL}blog-post/Category`;
    const blogPostModuleId = `${testRealmURL}blog-post/BlogPost`;
    const authorId = `${testRealmURL}Author/jane-doe`;
    const categoryId1 = `${testRealmURL}Category/city-design`;
    const categoryId2 = `${testRealmURL}Category/future-tech`;
    const blogPostId1 = `${testRealmURL}BlogPost/mad-hatter`;
    const blogPostId2 = `${testRealmURL}BlogPost/remote-work`;

    window.localStorage.setItem(
      PlaygroundSelections,
      JSON.stringify({
        [`${authorModuleId}`]: {
          cardId: authorId,
          format: 'edit',
        },
        [`${categoryModuleId}`]: {
          cardId: categoryId1,
          format: 'embedded',
        },
        [`${blogPostModuleId}`]: {
          cardId: blogPostId1,
        },
      }),
    );
    const getSelection = (moduleId: string) => {
      let selections = window.localStorage.getItem(PlaygroundSelections);
      if (!selections) {
        throw new Error('No selections found in mock local storage');
      }
      return JSON.parse(selections)[moduleId];
    };
    const assertCorrectFormat = (
      cardId: string,
      format: Format,
      message?: string,
    ) => {
      const dataAttr = `[data-test-playground-panel] [data-test-card="${cardId}"][data-test-card-format="${format}"]`;
      assert.dom(dataAttr).exists(message);
    };
    await visitOperatorMode({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}author.gts`,
    });
    assertCorrectFormat(authorId, 'edit');
    await click('[data-test-format-chooser-atom]'); // change selected format
    assertCorrectFormat(authorId, 'atom');
    assert.deepEqual(
      getSelection(authorModuleId),
      {
        cardId: authorId,
        format: 'atom',
      },
      'local storage is updated',
    );

    await click('[data-test-file-browser-toggle]');
    await click('[data-test-file="blog-post.gts"]'); // change open file
    assertCorrectFormat(categoryId1, 'embedded');

    await click('[data-test-instance-chooser]');
    await click('[data-option-index="1"]'); // change selected instance
    assertCorrectFormat(categoryId2, 'embedded');
    assert.deepEqual(
      getSelection(categoryModuleId),
      {
        cardId: categoryId2,
        format: 'embedded',
      },
      'local storage is updated',
    );

    await click('[data-test-inspector-toggle]');
    await click('[data-test-boxel-selector-item-text="BlogPost"]'); // change selected module
    assertCorrectFormat(blogPostId1, 'isolated', 'default format is correct');
    await click('[data-test-format-chooser-fitted]'); // change selected format
    assert.deepEqual(getSelection(blogPostModuleId), {
      cardId: blogPostId1,
      format: 'fitted',
    });
    await click('[data-test-instance-chooser]');
    await click('[data-option-index="1"]'); // change selected instance
    assertCorrectFormat(blogPostId2, 'fitted');
    assert.deepEqual(getSelection(blogPostModuleId), {
      cardId: blogPostId2,
      format: 'fitted',
    });

    let selections = window.localStorage.getItem(PlaygroundSelections);
    assert.strictEqual(
      selections,
      JSON.stringify({
        [`${authorModuleId}`]: {
          cardId: authorId,
          format: 'atom',
        },
        [`${categoryModuleId}`]: {
          cardId: categoryId2,
          format: 'embedded',
        },
        [`${blogPostModuleId}`]: {
          cardId: blogPostId2,
          format: 'fitted',
        },
      }),
    );
  });

  test<TestContextWithSave>('trigger auto saved in edit format', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}author.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    await click('[data-option-index="0"]');
    await click('[data-test-edit-button]');
    assert.dom('[data-test-card-format="edit"]').exists();

    let newFirstName = 'John';
    this.onSave((_, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      assert.strictEqual(json.data.attributes?.firstName, newFirstName);
    });
    await fillIn(
      '[data-test-field="firstName"] [data-test-boxel-input]',
      newFirstName,
    );
  });
});
