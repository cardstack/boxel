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

  const authorCard = `import { contains, field, CardDef, Component, FieldDef } from "https://cardstack.com/base/card-api";
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
}

export class Quote extends FieldDef {
  static displayName = 'Quote';
  @field quote = contains(StringField);
  @field attribution = contains(StringField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div data-test-quote-field-embedded>
        <blockquote data-test-quote>
          <p><@fields.quote /></p>
        </blockquote>
        <p data-test-attribution><@fields.attribution /></p>
      </div>
    </template>
  }
}

export class FullNameField extends FieldDef {
  static displayName = 'Full Name';
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div data-test-full-name-embedded>
        <@fields.firstName /> <@fields.lastName />
      </div>
    </template>
  }
}`;

  const blogPostCard = `import { contains, containsMany, field, linksTo, linksToMany, CardDef, Component, FieldDef } from "https://cardstack.com/base/card-api";
import DatetimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';
import StringField from "https://cardstack.com/base/string";
import { Sparkle } from '@cardstack/boxel-ui/icons';
import { Author } from './author';

export class Category extends CardDef {
  static displayName = 'Category';
  static fitted = class Fitted extends Component<typeof this> {
  <template>
    <div data-test-category-fitted><@fields.title /></div>
  </template>
  }
}

class LocalCategoryCard extends Category {}

export class Status extends StringField {
  static displayName = 'Status';
}

class LocalStatusField extends Status {}

export class Comment extends FieldDef {
  static displayName = 'Comment';
  static icon = Sparkle;
  @field title = contains(StringField);
  @field name = contains(StringField);
  @field message = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div data-test-embedded-comment>
        <h4 data-test-embedded-comment-title><@fields.title /></h4>
        <p><@fields.message /> - by <@fields.name /></p>
      </div>
    </template>
  }
}

class LocalCommentField extends Comment {}

export class RandomClass {}

export class BlogPost extends CardDef {
  static displayName = 'Blog Post';
  @field publishDate = contains(DatetimeField);
  @field author = linksTo(Author);
  @field categories = linksToMany(Category);
  @field localCategories = linksToMany(LocalCategoryCard);
  @field comments = containsMany(Comment);
  @field localComments = containsMany(LocalCommentField);
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
  @field localStatus = contains(LocalStatusField);

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
        'Spec/comment-1.json': {
          data: {
            type: 'card',
            attributes: {
              ref: {
                name: 'Comment',
                module: '../blog-post',
              },
              specType: 'field',
              containedExamples: [
                {
                  title: 'Terrible product',
                  name: 'Marco',
                  message: 'I would give 0 stars if I could. Do not buy!',
                },
                {
                  title: 'Needs better packaging',
                  name: 'Harry',
                  message: 'Arrived broken',
                },
              ],
              title: 'Comment spec',
            },
            meta: {
              fields: {
                containedExamples: [
                  {
                    adoptsFrom: {
                      module: '../blog-post',
                      name: 'Comment',
                    },
                  },
                  {
                    adoptsFrom: {
                      module: '../blog-post',
                      name: 'Comment',
                    },
                  },
                ],
              },
              adoptsFrom: {
                module: 'https://cardstack.com/base/spec',
                name: 'Spec',
              },
            },
          },
        },
        'Spec/comment-2.json': {
          data: {
            type: 'card',
            attributes: {
              ref: {
                name: 'Comment',
                module: '../blog-post',
              },
              specType: 'field',
              containedExamples: [
                {
                  title: 'Spec 2 Example 1',
                },
              ],
              title: 'Comment spec II',
            },
            meta: {
              fields: {
                containedExamples: [
                  {
                    adoptsFrom: {
                      module: '../blog-post',
                      name: 'Comment',
                    },
                  },
                ],
              },
              adoptsFrom: {
                module: 'https://cardstack.com/base/spec',
                name: 'Spec',
              },
            },
          },
        },
        'Spec/full-name.json': {
          data: {
            type: 'card',
            attributes: {
              ref: {
                name: 'FullNameField',
                module: '../author',
              },
              specType: 'field',
              containedExamples: [],
              title: 'FullNameField spec',
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/spec',
                name: 'Spec',
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

  const selectClass = async (name: string) =>
    await click(
      `[data-test-in-this-file-selector] [data-test-boxel-selector-item-text="${name}"]`,
    );

  const getPersistedPlaygroundSelection = (moduleId: string) => {
    let selections = window.localStorage.getItem(PlaygroundSelections);
    if (!selections) {
      throw new Error('No selections found in mock local storage');
    }
    return JSON.parse(selections)[moduleId];
  };

  test('can render playground panel when an exported card def or exported compound field def is selected', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}blog-post.gts`,
    });
    assert
      .dom(
        '[data-test-in-this-file-selector] [data-test-boxel-selector-item-selected] [data-test-boxel-selector-item-text="Category"]',
      )
      .exists(); // pre-selected since it's the first definition
    assert
      .dom('[data-test-accordion-item="playground"]')
      .exists(
        'playground accordion item exists for Category (exported card def)',
      );
    await click('[data-test-accordion-item="playground"] button'); // open panel
    assert
      .dom('[data-test-playground-panel]')
      .exists('playground panel exists for Category (exported card def)');

    await selectClass('LocalCategoryCard');
    assert
      .dom('[data-test-accordion-item="playground"]')
      .doesNotExist(
        'playground does not exist for LocalCategory (local card def)',
      );

    await selectClass('Comment');
    assert
      .dom('[data-test-playground-panel]')
      .exists('playground exists for Comment (exported compound field def)');

    await selectClass('LocalCommentField');
    assert
      .dom('[data-test-accordion-item="playground"]')
      .doesNotExist(
        'does not exist for LocalComment (local compound field def)',
      );

    // Note: Currently we can not have polymorphism in primitive fields. However, this can be done
    // after the `.value` refactor when the distinctions in the implementations of primitive
    // and compound fields will cease to exist. See linear ticket [CS-6689].
    // TODO
    await selectClass('Status');
    assert
      .dom('[data-test-accordion-item="playground"]')
      .doesNotExist('does not exist for Status (primitive field def)');

    await selectClass('LocalStatusField');
    assert
      .dom('[data-test-accordion-item="playground"]')
      .doesNotExist('does not exist for LocalStatus (primitive field def)');

    await selectClass('RandomClass');
    assert
      .dom('[data-test-accordion-item="playground"]')
      .doesNotExist('does not exist for RandomClass (not a card or field def)');

    await selectClass('BlogPost');
    assert
      .dom('[data-test-playground-panel]')
      .exists('exists for BlogPost (exported card def)');
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
    await click('[data-test-accordion-item="playground"] button');
    assert.dom('[data-test-selected-item]').hasText('City Design');
    assertCardExists('Category/city-design');

    await selectClass('BlogPost');
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
    assert.dom('[data-test-format-chooser="isolated"]').hasClass('active');

    await click('[data-test-format-chooser="embedded"]');
    assert.dom('[data-test-format-chooser="isolated"]').hasNoClass('active');
    assert.dom('[data-test-format-chooser="embedded"]').hasClass('active');
    assert
      .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
      .doesNotExist();
    assert
      .dom(
        `[data-test-playground-panel] [data-test-card="${testRealmURL}Author/jane-doe"][data-test-card-format="embedded"]`,
      )
      .exists();

    await click('[data-test-format-chooser="edit"]');
    assert.dom('[data-test-format-chooser="embedded"]').hasNoClass('active');
    assert.dom('[data-test-format-chooser="edit"]').hasClass('active');
    assert
      .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
      .hasText('Author');
    assert
      .dom(
        `[data-test-playground-panel] [data-test-card="${testRealmURL}Author/jane-doe"][data-test-card-format="edit"]`,
      )
      .exists();

    await click('[data-test-format-chooser="atom"]');
    assert.dom('[data-test-format-chooser="edit"]').hasNoClass('active');
    assert.dom('[data-test-format-chooser="atom"]').hasClass('active');

    assert
      .dom('[data-test-atom-preview]')
      .hasText(
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do Jane Doe tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
      );

    await click('[data-test-format-chooser="fitted"]');
    assert.dom('[data-test-format-chooser="atom"]').hasNoClass('active');
    assert.dom('[data-test-format-chooser="fitted"]').hasClass('active');
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
    assert.dom('[data-test-format-chooser="isolated"]').hasClass('active');
    await click(
      '[data-test-boxel-card-header-actions] [data-test-edit-button]',
    );

    assert.dom(`${playgroundCard}[data-test-card-format="edit"]`).exists();
    assert.dom('[data-test-card-header]').hasClass('is-editing');
    assert.dom('[data-test-format-chooser="isolated"]').hasNoClass('active');
    assert.dom('[data-test-format-chooser="edit"]').hasClass('active');
    await click(
      '[data-test-boxel-card-header-actions] [data-test-edit-button]',
    );

    assert.dom(`${playgroundCard}[data-test-card-format="isolated"]`).exists();
    assert.dom('[data-test-card-header]').hasNoClass('is-editing');
    assert.dom('[data-test-format-chooser="edit"]').hasNoClass('active');
    assert.dom('[data-test-format-chooser="isolated"]').hasClass('active');
  });

  test('can use the header context menu to open instance in edit format in interact mode', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}author.gts`,
    });
    await click('[data-test-accordion-item="playground"] button');
    await click('[data-test-instance-chooser]');
    await click('[data-option-index="0"]');
    await click('[data-test-format-chooser="edit"]');
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
      { line: 8, column: 38 },
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
    await click('[data-test-accordion-item="playground"] button');
    assertCorrectFormat(authorId, 'edit');
    await click('[data-test-format-chooser="atom"]'); // change selected format
    assertCorrectFormat(authorId, 'atom');
    assert.deepEqual(
      getPersistedPlaygroundSelection(authorModuleId),
      {
        cardId: authorId,
        format: 'atom',
      },
      'local storage is updated',
    );

    await click('[data-test-file-browser-toggle]');
    await click('[data-test-file="blog-post.gts"]'); // change open file
    await click('[data-test-accordion-item="playground"] button');
    assertCorrectFormat(categoryId1, 'embedded');

    await click('[data-test-instance-chooser]');
    await click('[data-option-index="1"]'); // change selected instance
    assertCorrectFormat(categoryId2, 'embedded');
    assert.deepEqual(
      getPersistedPlaygroundSelection(categoryModuleId),
      {
        cardId: categoryId2,
        format: 'embedded',
      },
      'local storage is updated',
    );

    await click('[data-test-inspector-toggle]');
    await click('[data-test-boxel-selector-item-text="BlogPost"]'); // change selected module
    assertCorrectFormat(blogPostId1, 'isolated', 'default format is correct');
    await click('[data-test-format-chooser="fitted"]'); // change selected format
    assert.deepEqual(getPersistedPlaygroundSelection(blogPostModuleId), {
      cardId: blogPostId1,
      format: 'fitted',
    });
    await click('[data-test-instance-chooser]');
    await click('[data-option-index="1"]'); // change selected instance
    assertCorrectFormat(blogPostId2, 'fitted');
    assert.deepEqual(getPersistedPlaygroundSelection(blogPostModuleId), {
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

  module('usage with field def', function () {
    test('can preview compound field instance', async function (assert) {
      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}blog-post.gts`,
      });
      await click('[data-test-boxel-selector-item-text="Comment"]');
      await click('[data-test-accordion-item="playground"] button');
      assert.dom('[data-test-selected-item]').hasText('Comment spec');
      assert.dom('[data-test-field-preview-header]').containsText('Comment');
      // assert.dom('[data-test-playground-format-chooser] button').exists({ count: 3 }); // TODO
      assert.dom('[data-test-format-chooser="embedded"]').hasClass('active');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText(
          'Terrible product',
          'preview defaults to embedded view of first example',
        );

      await click('[data-test-format-chooser="atom"]');
      assert
        .dom(
          '[data-test-field-preview-card] [data-test-compound-field-format="atom"]',
        )
        .exists();

      await click('[data-test-edit-button]');
      assert
        .dom(
          '[data-test-field-preview-card] [data-test-compound-field-format="edit"]',
        )
        .exists();
      assert
        .dom('[data-test-field-preview-card] [data-test-field]')
        .exists({ count: 3 });
      assert
        .dom('[data-test-field-preview-card] [data-test-field="name"] input')
        .hasValue('Marco');

      await click('[data-test-edit-button]');
      assert.dom('[data-test-embedded-comment]').exists();
    });

    test('changing the selected spec in Boxel Spec panel changes selected spec in playground', async function (assert) {
      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}blog-post.gts`,
      });
      await selectClass('Comment');
      // playground panel
      await click('[data-test-accordion-item="playground"] button');
      assert.dom('[data-test-selected-item]').hasText('Comment spec');
      assert.dom('[data-test-field-preview-header]').hasText('Comment');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText('Terrible product');
      let selection = getPersistedPlaygroundSelection(
        `${testRealmURL}blog-post/Comment`,
      );
      assert.deepEqual(selection, {
        cardId: `${testRealmURL}Spec/comment-1`,
        format: 'embedded',
        fieldIndex: 0,
      });

      // spec panel
      await click('[data-test-accordion-item="spec-preview"] button');
      assert
        .dom(
          `[data-test-card="${testRealmURL}Spec/comment-1"] [data-test-boxel-input-id="spec-title"]`,
        )
        .hasValue('Comment spec');
      assert
        .dom('[data-test-spec-selector] [data-test-spec-selector-item-path]')
        .containsText('Spec/comment-1.json');
      await click('[data-test-spec-selector] > div');
      assert
        .dom('[data-option-index="1"] [data-test-spec-selector-item-path]')
        .hasText('Spec/comment-2.json');
      await click('[data-option-index="1"]');
      assert
        .dom('[data-test-spec-selector] [data-test-spec-selector-item-path]')
        .containsText('Spec/comment-2.json');
      assert
        .dom(
          `[data-test-card="${testRealmURL}Spec/comment-2"] [data-test-boxel-input-id="spec-title"]`,
        )
        .hasValue('Comment spec II');

      // playground panel
      await click('[data-test-accordion-item="playground"] button');
      assert.dom('[data-test-selected-item]').hasText('Comment spec II');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText('Spec 2 Example 1');
      selection = getPersistedPlaygroundSelection(
        `${testRealmURL}blog-post/Comment`,
      );
      assert.deepEqual(selection, {
        cardId: `${testRealmURL}Spec/comment-2`,
        format: 'embedded',
        fieldIndex: 0,
      });
    });

    test("can select a different instance to preview from the spec's containedExamples collection", async function (assert) {
      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}blog-post.gts`,
      });
      await selectClass('Comment');
      await click('[data-test-accordion-item="playground"] button');
      assert.dom('[data-test-selected-item]').hasText('Comment spec');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText('Terrible product');
      let selection = getPersistedPlaygroundSelection(
        `${testRealmURL}blog-post/Comment`,
      );
      assert.deepEqual(selection, {
        cardId: `${testRealmURL}Spec/comment-1`,
        format: 'embedded',
        fieldIndex: 0,
      });

      await click('[data-test-instance-chooser]');
      await click('[data-test-choose-another-instance]');
      assert
        .dom('[data-test-field-chooser] [data-test-boxel-header-title]')
        .hasText('Choose a Comment Instance');
      assert.dom('[data-test-field-instance]').exists({ count: 2 });
      assert.dom('[data-test-field-instance="0"]').hasClass('selected');
      assert.dom('[data-test-field-instance="1"]').doesNotHaveClass('selected');

      await click('[data-test-field-instance="1"]');
      assert
        .dom('[data-test-field-chooser]')
        .doesNotExist('field chooser modal is closed');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText('Needs better packaging');
      selection = getPersistedPlaygroundSelection(
        `${testRealmURL}blog-post/Comment`,
      );
      assert.deepEqual(selection, {
        cardId: `${testRealmURL}Spec/comment-1`,
        format: 'embedded',
        fieldIndex: 1,
      });
    });

    test('preview the next available example if the previously selected one has been deleted', async function (assert) {
      window.localStorage.setItem(
        PlaygroundSelections,
        JSON.stringify({
          [`${testRealmURL}blog-post/Comment`]: {
            cardId: `${testRealmURL}Spec/comment-1`,
            format: 'embedded',
            fieldIndex: 1,
          },
        }),
      );
      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}blog-post.gts`,
      });
      await selectClass('Comment');
      await click('[data-test-accordion-item="playground"] button');
      assert.dom('[data-test-selected-item]').hasText('Comment spec');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText('Needs better packaging');

      await click('[data-test-accordion-item="spec-preview"] button');
      assert
        .dom(
          '[data-test-contains-many="containedExamples"] [data-test-item="1"] [data-test-field="title"] input',
        )
        .hasValue('Needs better packaging');
      await click(
        '[data-test-contains-many="containedExamples"] [data-test-remove="1"]',
      );
      assert
        .dom(
          '[data-test-contains-many="containedExamples"] [data-test-item="1"]',
        )
        .doesNotExist();
      assert
        .dom(
          '[data-test-contains-many="containedExamples"] [data-test-item="0"]',
        )
        .exists();

      await click('[data-test-accordion-item="playground"] button');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText('Terrible product');

      await click('[data-test-accordion-item="spec-preview"] button');
      await click(
        '[data-test-contains-many="containedExamples"] [data-test-remove="0"]',
      ); // remove remaining contained example from spec
      assert
        .dom('[data-test-contains-many="containedExamples"] [data-test-item]')
        .doesNotExist();

      await click('[data-test-accordion-item="playground"] button');
      assert.dom('[data-test-embedded-comment]').doesNotExist();
      assert.dom('[data-test-add-field-instance]').exists();
    });

    test('can create new field instance (no preexisting Spec)', async function (assert) {
      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}author.gts`,
      });
      await selectClass('Quote');
      await click('[data-test-accordion-item="playground"] button');
      assert.dom('[data-test-quote-field-embedded]').doesNotExist();
      assert.dom('[data-test-instance-chooser]').hasText('Please Select');
      assert
        .dom(
          '[data-test-accordion-item="spec-preview"] [data-test-create-spec-button]',
        )
        .exists();

      await click('[data-test-instance-chooser]');
      await click('[data-test-create-instance]');
      assert
        .dom('[data-test-instance-chooser] [data-test-selected-item]')
        .hasText('Quote');
      assert
        .dom(
          '[data-test-field-preview-card] [data-test-compound-field-format="edit"]',
        )
        .exists();
      assert.dom('[data-test-field="quote"] input').hasNoValue();

      assert
        .dom(
          '[data-test-accordion-item="spec-preview"] [data-test-create-spec-button]',
        )
        .doesNotExist();
      assert
        .dom('[data-test-accordion-item="spec-preview"] [data-test-has-spec]')
        .hasText('field');

      await click('[data-test-accordion-item="spec-preview"] button');
      assert.dom('[data-test-boxel-input-id="spec-title"]').hasValue('Quote');
      assert
        .dom(
          '[data-test-contains-many="containedExamples"] [data-test-item="0"] [data-test-field="quote"] input',
        )
        .hasNoValue();
    });

    test('can create new field instance (has preexisting Spec)', async function (assert) {
      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}blog-post.gts`,
      });
      await selectClass('Comment');
      await click('[data-test-accordion-item="playground"] button');
      assert.dom('[data-test-selected-item]').hasText('Comment spec');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText('Terrible product');
      let selection = getPersistedPlaygroundSelection(
        `${testRealmURL}blog-post/Comment`,
      );
      assert.deepEqual(selection, {
        cardId: `${testRealmURL}Spec/comment-1`,
        format: 'embedded',
        fieldIndex: 0,
      });

      await click('[data-test-instance-chooser]');
      await click('[data-test-create-instance]');
      assert
        .dom('[data-test-field-preview-card] [data-test-field="title"] input')
        .hasNoValue();
      selection = getPersistedPlaygroundSelection(
        `${testRealmURL}blog-post/Comment`,
      );
      assert.deepEqual(selection, {
        cardId: `${testRealmURL}Spec/comment-1`,
        format: 'edit',
        fieldIndex: 2,
      });

      await click('[data-test-accordion-item="spec-preview"] button');
      assert
        .dom('[data-test-contains-many="containedExamples"] [data-test-item]')
        .exists({ count: 3 });
      assert
        .dom(
          '[data-test-contains-many="containedExamples"] [data-test-item="2"] [data-test-field="title"] input',
        )
        .hasNoValue();

      await click('[data-test-accordion-item="playground"] button');
      await click('[data-test-instance-chooser]');
      await click('[data-test-choose-another-instance]');
      assert
        .dom('[data-test-field-chooser] [data-test-field-instance]')
        .exists({ count: 3 });
    });

    test('can create new field instance when spec exists but has no examples', async function (assert) {
      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}author.gts`,
      });
      await selectClass('FullNameField');
      await click('[data-test-accordion-item="playground"] button');
      assert.dom('[data-test-selected-item]').hasText('FullNameField spec');
      assert.dom('[data-test-field-preview-header]').doesNotExist();

      await click('[data-test-add-field-instance]');
      assert.dom('[data-test-field-preview-header]').containsText('Full Name');
      assert
        .dom(
          '[data-test-field-preview-card] [data-test-compound-field-format="edit"]',
        )
        .exists();
      assert
        .dom(
          '[data-test-field-preview-card] [data-test-field="firstName"] input',
        )
        .hasNoValue();
      await fillIn('[data-test-field="firstName"] input', 'Marco');
      await fillIn('[data-test-field="lastName"] input', 'N.');

      await click('[data-test-instance-chooser]');
      await click('[data-test-choose-another-instance]');
      assert
        .dom('[data-test-field-chooser] [data-test-field-instance]')
        .exists({ count: 1 });
      assert
        .dom('[data-test-field-chooser] [data-test-full-name-embedded]')
        .hasText('Marco N.');
      await click('[data-test-field-chooser] [data-test-close-modal]');

      await click('[data-test-accordion-item="spec-preview"] button');
      assert
        .dom('[data-test-contains-many="containedExamples"] [data-test-item]')
        .exists({ count: 1 });
      assert
        .dom(
          '[data-test-contains-many="containedExamples"] [data-test-item="0"] [data-test-field="firstName"] input',
        )
        .hasValue('Marco');

      let selection = getPersistedPlaygroundSelection(
        `${testRealmURL}author/FullNameField`,
      );
      assert.deepEqual(selection, {
        cardId: `${testRealmURL}Spec/full-name`,
        format: 'edit',
        fieldIndex: 0,
      });
    });

    test('editing compound field instance live updates the preview', async function (assert) {
      const updatedCommentField = `import { contains, field, Component, FieldDef } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";

        export class Comment extends FieldDef {
          static displayName = 'Comment';
          @field title = contains(StringField);
          @field name = contains(StringField);
          @field message = contains(StringField);

          static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-embedded-comment>
            <p><@fields.message /> - by <@fields.name /></p>
          </div>
        </template>
          }
        }`;
      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}blog-post.gts`,
      });
      await selectClass('Comment');
      await click('[data-test-accordion-item="playground"] button');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText('Terrible product');
      await realm.write('blog-post.gts', updatedCommentField),
        await waitUntil(
          () =>
            document.querySelector('[data-test-embedded-comment-title]') ===
            null,
        );
      assert.dom('[data-test-embedded-comment-title]').doesNotExist();
    });
  });
});
