import { click, fillIn, waitFor, waitUntil } from '@ember/test-helpers';

import { triggerEvent } from '@ember/test-helpers';

import { module, test } from 'qunit';

import type { Realm } from '@cardstack/runtime-common';

import type RealmServerService from '@cardstack/host/services/realm-server';

import {
  percySnapshot,
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  testRealmURL,
  visitOperatorMode,
  type TestContextWithSave,
  assertMessages,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import {
  assertCardExists,
  chooseAnotherInstance,
  createNewInstance,
  getPlaygroundSelections,
  getRecentFiles,
  openFileInPlayground,
  removePlaygroundSelections,
  removeRecentFiles,
  selectDeclaration,
  selectFormat,
  setPlaygroundSelections,
  setRecentFiles,
  togglePlaygroundPanel,
} from '../../helpers/playground';
import { setupApplicationTest } from '../../helpers/setup';

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

  export class RandomClass {}

  export class BlogPost extends CardDef {
    static displayName = 'Blog Post';
    @field publishDate = contains(DatetimeField);
    @field author = linksTo(Author);
    @field categories = linksToMany(Category);
    @field localCategories = linksToMany(LocalCategoryCard);
    @field body = contains(MarkdownField);

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

let matrixRoomId: string;

module('Acceptance | code-submode | card playground', function (_hooks) {
  module('single realm', function (hooks) {
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

      setRecentFiles([
        [testRealmURL, 'blog-post.gts'],
        [testRealmURL, 'author.gts'],
        [testRealmURL, 'BlogPost/mad-hatter.json'],
        [testRealmURL, 'Category/city-design.json'],
        [testRealmURL, 'Category/future-tech.json'],
        [testRealmURL, 'BlogPost/remote-work.json'],
        [testRealmURL, 'BlogPost/urban-living.json'],
        [testRealmURL, 'Author/jane-doe.json'],
      ]);
      removePlaygroundSelections();

      setActiveRealms([testRealmURL]);
      setRealmPermissions({
        [testRealmURL]: ['read', 'write'],
      });
    });

    test('can render playground panel when an exported card def is selected', async function (assert) {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}blog-post.gts`,
      });
      assert
        .dom('[data-test-selected-accordion-item="schema-editor"]')
        .exists('schema editor is open by default');
      assert
        .dom('[data-test-playground-panel]')
        .doesNotExist('do not load playground unless panel is open');

      await selectDeclaration('Category');
      await togglePlaygroundPanel();
      assert
        .dom('[data-test-playground-panel]')
        .exists('playground panel exists for Category (exported card def)');

      await click('[data-test-accordion-item="schema-editor"] > button');
      await selectDeclaration('LocalCategoryCard');
      assert.dom('[data-test-incompatible-nonexports]').doesNotExist();
      await togglePlaygroundPanel();
      assert
        .dom('[data-test-playground-panel]')
        .doesNotExist(
          'playground preview is not available for LocalCategory (local card def)',
        );
      assert.dom('[data-test-incompatible-nonexports]').exists();

      await selectDeclaration('RandomClass');
      assert
        .dom('[data-test-accordion-item="playground"]')
        .doesNotExist(
          'does not exist for RandomClass (not a card or field def)',
        );

      await selectDeclaration('BlogPost');
      assert
        .dom('[data-test-playground-panel]')
        .exists('exists for BlogPost (exported card def)');
    });

    test('can populate instance chooser dropdown options from recent files', async function (assert) {
      removeRecentFiles();
      setRecentFiles([
        [testRealmURL, 'BlogPost/mad-hatter.json'],
        [testRealmURL, 'Category/future-tech.json'],
        [testRealmURL, 'Category/city-design.json'],
        [testRealmURL, 'BlogPost/remote-work.json'],
        [testRealmURL, 'BlogPost/urban-living.json'],
        [testRealmURL, 'Author/jane-doe.json'],
      ]);
      await openFileInPlayground('blog-post.gts', testRealmURL, 'Category');
      assert.dom('[data-test-instance-chooser]').hasText('Please Select');

      await click('[data-test-instance-chooser]');
      assert
        .dom('[data-option-index] [data-test-category-fitted]')
        .exists({ count: 2 });

      await click('[data-option-index="1"]');
      assert.dom('[data-test-selected-item]').hasText('Future Tech');

      await percySnapshot(assert);
    });

    test('can update the instance chooser when selected card def changes (same file)', async function (assert) {
      await openFileInPlayground('blog-post.gts', testRealmURL, 'Category');
      await click('[data-test-instance-chooser]');
      assert.dom('[data-option-index]').exists({ count: 2 });
      assert.dom('[data-option-index="0"]').containsText('City Design');
      await click('[data-option-index="0"]');
      assert.dom('[data-test-selected-item]').containsText('City Design');

      await selectDeclaration('BlogPost');
      await click('[data-test-instance-chooser]');
      assert.dom('[data-option-index]').exists({ count: 3 });
      assert.dom('[data-option-index="0"]').containsText('Mad As a Hatter');
      await click('[data-option-index="0"]');
      assert.dom('[data-test-selected-item]').containsText('Mad As a Hatter');
    });

    test('can update the instance chooser when a different file is opened', async function (assert) {
      await openFileInPlayground('blog-post.gts', testRealmURL, 'Category');
      await click('[data-test-instance-chooser]');
      assert.dom('[data-option-index]').exists({ count: 2 });
      assert.dom('[data-option-index="0"]').containsText('City Design');
      await click('[data-option-index="0"]');
      assert.dom('[data-test-selected-item]').containsText('City Design');

      await click('[data-test-file-browser-toggle]');
      await click('[data-test-file="author.gts"]');
      await togglePlaygroundPanel();
      assert.dom('[data-test-instance-chooser]').hasText('Please Select');
      await click('[data-test-instance-chooser]');
      assert.dom('li.ember-power-select-option').exists({ count: 1 });
      assert.dom('[data-option-index="0"]').containsText('Jane Doe');
      await click('[data-option-index="0"]');
      assert.dom('[data-test-selected-item]').containsText('Jane Doe');
    });

    test('can use the header context menu to open instance in code mode', async function (assert) {
      await openFileInPlayground('author.gts', testRealmURL, 'Author');
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
      await openFileInPlayground('author.gts', testRealmURL, 'Author');
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
      const cardId = `${testRealmURL}Author/jane-doe`;
      await openFileInPlayground('author.gts', testRealmURL, 'Author');
      await click('[data-test-instance-chooser]');
      await click('[data-option-index="0"]');
      assert
        .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
        .hasText('Author');
      assertCardExists(assert, cardId, 'isolated');
      assert.dom('[data-test-author-title]').hasText('Jane Doe');
      assert
        .dom('[data-test-author-bio]')
        .containsText('Jane Doe is the Senior Managing Editor');
      assert.dom('[data-test-format-chooser="isolated"]').hasClass('active');

      await selectFormat('embedded');
      assert.dom('[data-test-format-chooser="isolated"]').hasNoClass('active');
      assert.dom('[data-test-format-chooser="embedded"]').hasClass('active');
      assert
        .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
        .doesNotExist();
      assertCardExists(assert, cardId, 'embedded');

      await selectFormat('edit');
      assert.dom('[data-test-format-chooser="embedded"]').hasNoClass('active');
      assert.dom('[data-test-format-chooser="edit"]').hasClass('active');
      assert
        .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
        .hasText('Author');
      assertCardExists(assert, cardId, 'edit');

      await selectFormat('atom');
      assert.dom('[data-test-format-chooser="edit"]').hasNoClass('active');
      assert.dom('[data-test-format-chooser="atom"]').hasClass('active');

      assert
        .dom('[data-test-atom-preview]')
        .hasText(
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do Jane Doe tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
        );

      await selectFormat('fitted');
      assert.dom('[data-test-format-chooser="atom"]').hasNoClass('active');
      assert.dom('[data-test-format-chooser="fitted"]').hasClass('active');
      assert
        .dom('[data-test-playground-panel] [data-test-card-format="fitted"]')
        .exists({ count: 16 });
    });

    test('can toggle edit format via button on card header', async function (assert) {
      const cardId = `${testRealmURL}Author/jane-doe`;
      await openFileInPlayground('author.gts', testRealmURL, 'Author');
      await click('[data-test-instance-chooser]');
      await click('[data-option-index="0"]');
      assert
        .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
        .hasText('Author');
      assertCardExists(assert, cardId, 'isolated');
      assert.dom('[data-test-author-title]').hasText('Jane Doe');
      assert.dom('[data-test-format-chooser="isolated"]').hasClass('active');

      await click(
        '[data-test-boxel-card-header-actions] [data-test-edit-button]',
      );
      assertCardExists(assert, cardId, 'edit');
      assert.dom('[data-test-card-header]').hasClass('is-editing');
      assert.dom('[data-test-format-chooser="isolated"]').hasNoClass('active');
      assert.dom('[data-test-format-chooser="edit"]').hasClass('active');

      await click(
        '[data-test-boxel-card-header-actions] [data-test-edit-button]',
      );
      assertCardExists(assert, cardId, 'isolated');
      assert.dom('[data-test-card-header]').hasNoClass('is-editing');
      assert.dom('[data-test-format-chooser="edit"]').hasNoClass('active');
      assert.dom('[data-test-format-chooser="isolated"]').hasClass('active');
    });

    test('can use the header context menu to open instance in edit format in interact mode', async function (assert) {
      await openFileInPlayground('author.gts', testRealmURL, 'Author');
      await click('[data-test-instance-chooser]');
      await click('[data-option-index="0"]');
      await selectFormat('edit');
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
      removeRecentFiles();
      await openFileInPlayground('blog-post.gts', testRealmURL, 'BlogPost');
      await chooseAnotherInstance();
      assert.dom('[data-test-card-catalog-modal]').exists();
      assert.dom('[data-test-card-catalog-item]').exists({ count: 3 });
      assert
        .dom(
          `[data-test-card-catalog-item="${testRealmURL}BlogPost/mad-hatter"]`,
        )
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
      assertCardExists(
        assert,
        `${testRealmURL}BlogPost/mad-hatter`,
        'isolated',
      );
      assert.deepEqual(getRecentFiles()?.[0], [
        testRealmURL,
        'BlogPost/mad-hatter.json',
        null,
      ]);
    });

    test('can create new instance', async function (assert) {
      removeRecentFiles();
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}blog-post.gts`,
      });
      assert.deepEqual(getRecentFiles()?.[0], [
        testRealmURL,
        'blog-post.gts',
        { line: 6, column: 40 },
      ]);
      await click('[data-boxel-selector-item-text="BlogPost"]');
      await togglePlaygroundPanel();
      assert
        .dom('[data-test-instance-chooser] [data-test-selected-item]')
        .doesNotExist();

      await createNewInstance();

      let recentFiles = getRecentFiles();
      assert.strictEqual(
        recentFiles?.length,
        2,
        'recent file count is correct',
      );
      let newCardId = `${recentFiles?.[0][0]}${recentFiles?.[0][1]}`.replace(
        '.json',
        '',
      );
      assert
        .dom('[data-test-instance-chooser] [data-test-selected-item]')
        .hasText('Untitled Blog Post', 'created instance is selected');
      assertCardExists(
        assert,
        newCardId,
        'edit',
        'new card is rendered in edit format',
      );

      await click('[data-test-instance-chooser]');
      assert
        .dom('[data-option-index]')
        .exists({ count: 1 }, 'dropdown instance count is correct');
      assert.dom('[data-option-index]').containsText('Blog Post');
    });

    test('can create new instance with CodeRef field', async function (assert) {
      await openFileInPlayground(
        'code-ref-driver.gts',
        testRealmURL,
        'CodeRefDriver',
      );
      await createNewInstance();

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
      await openFileInPlayground(
        'code-ref-driver.gts',
        testRealmURL,
        'CodeRefDriver',
      );
      await createNewInstance();

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
      await openFileInPlayground('author.gts', testRealmURL, 'Author');
      await click('[data-test-instance-chooser]');
      await click('[data-option-index="0"]');
      assert.dom('[data-test-author-title]').containsText('Jane Doe');

      await realm.write('author.gts', authorCard);

      await waitUntil(
        () =>
          document
            .querySelector('[data-test-author-title]')
            ?.textContent?.includes('Hello'),
        { timeout: 5000 },
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

      await openFileInPlayground('blog-post.gts', testRealmURL, 'BlogPost');
      await click('[data-test-instance-chooser]');
      await click('[data-option-index="0"]');
      assert.dom('[data-test-post-title]').hasText('Mad As a Hatter');

      await realm.write('blog-post.gts', blogPostCard);

      await waitUntil(
        () =>
          document
            .querySelector('[data-test-post-title]')
            ?.textContent?.includes('Hello'),
        { timeout: 5000 },
      );

      assert
        .dom('[data-test-post-title]')
        .includesText('Hello Mad As a Hatter');
    });

    test('can remember playground selections and format choices via local storage', async function (assert) {
      const authorModuleId = `${testRealmURL}author/Author`;
      const categoryModuleId = `${testRealmURL}blog-post/Category`;
      const blogPostModuleId = `${testRealmURL}blog-post/BlogPost`;
      const authorId = `${testRealmURL}Author/jane-doe`;
      const categoryId1 = `${testRealmURL}Category/city-design`;
      const categoryId2 = `${testRealmURL}Category/future-tech`;
      const blogPostId1 = `${testRealmURL}BlogPost/mad-hatter`;
      const blogPostId2 = `${testRealmURL}BlogPost/remote-work`;

      setPlaygroundSelections({
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
          format: 'isolated',
        },
      });

      await openFileInPlayground('author.gts', testRealmURL, 'Author');
      assert.dom('[data-test-selected-item]').hasText('Jane Doe');
      assertCardExists(assert, authorId, 'edit');
      await selectFormat('atom'); // change selected format
      assertCardExists(assert, authorId, 'atom');
      assert.deepEqual(
        getPlaygroundSelections()?.[authorModuleId],
        {
          cardId: authorId,
          format: 'atom',
        },
        'local storage is updated',
      );

      await click(`[data-test-recent-file="${testRealmURL}blog-post.gts"]`); // change open file
      await togglePlaygroundPanel();
      assert.dom('[data-test-selected-item]').hasText('City Design');
      assertCardExists(assert, categoryId1, 'embedded');

      await click('[data-test-instance-chooser]');
      await click('[data-option-index="1"]'); // change selected instance
      assert.dom('[data-test-selected-item]').hasText('Future Tech');
      assertCardExists(assert, categoryId2, 'embedded');
      assert.deepEqual(
        getPlaygroundSelections()?.[categoryModuleId],
        {
          cardId: categoryId2,
          format: 'embedded',
        },
        'local storage is updated',
      );

      await click('[data-test-inspector-toggle]');
      await click('[data-test-boxel-selector-item-text="BlogPost"]'); // change selected module
      assertCardExists(assert, blogPostId1, 'isolated');
      await selectFormat('fitted'); // change selected format
      assert.deepEqual(getPlaygroundSelections()?.[blogPostModuleId], {
        cardId: blogPostId1,
        format: 'fitted',
      });
      await click('[data-test-instance-chooser]');
      await click('[data-option-index="1"]'); // change selected instance
      assertCardExists(assert, blogPostId2, 'fitted');
      assert.deepEqual(getPlaygroundSelections()?.[blogPostModuleId], {
        cardId: blogPostId2,
        format: 'fitted',
      });

      assert.strictEqual(
        JSON.stringify(getPlaygroundSelections()),
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
      await openFileInPlayground('author.gts', testRealmURL, 'Author');
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

    test<TestContextWithSave>('automatically attaches the selected card to the AI message', async function (assert) {
      await openFileInPlayground('author.gts', testRealmURL, 'Author');
      await click('[data-test-instance-chooser]');
      await click('[data-option-index="0"]');
      await click('[data-test-open-ai-assistant]');
      assert.dom(`[data-test-card="${testRealmURL}Author/jane-doe"]`).exists();
      assert.dom('[data-test-autoattached-card]').hasText('Jane Doe');
      await triggerEvent(`[data-test-autoattached-card]`, 'mouseenter');
      assert
        .dom('[data-test-tooltip-content]')
        .hasText('Current card is shared automatically');

      await click('[data-test-file-browser-toggle]');
      await click('[data-test-file="blog-post.gts"]');
      await click('[data-test-accordion-item="playground"] button');
      await click('[data-test-instance-chooser]');
      await click('[data-option-index="1"]');
      assert
        .dom(`[data-test-card="${testRealmURL}Category/future-tech"]`)
        .exists();
      assert.dom('[data-test-autoattached-card]').hasText('Future Tech');
      await click('[data-test-remove-card-btn]');
      assert.dom('[data-test-autoattached-card]').doesNotExist();

      await click('[data-test-instance-chooser]');
      await click('[data-option-index="0"]');
      assert
        .dom(`[data-test-card="${testRealmURL}Category/city-design"]`)
        .exists();
      assert.dom('[data-test-autoattached-card]').hasText('City Design');
      await fillIn('[data-test-message-field]', `Message With Card and File`);
      await click('[data-test-send-message-btn]');

      assertMessages(assert, [
        {
          from: 'testuser',
          message: 'Message With Card and File',
          files: [
            {
              sourceUrl: `${testRealmURL}blog-post.gts`,
              name: 'blog-post.gts',
            },
          ],
          cards: [
            { id: `${testRealmURL}Category/city-design`, title: 'City Design' },
          ],
        },
      ]);
    });

    test<TestContextWithSave>('instance chooser only appears when panel is opened', async function (assert) {
      await openFileInPlayground('author.gts', testRealmURL, 'Author');
      assert.dom('[data-test-instance-chooser]').exists();
      await click('[data-test-accordion-item="playground"] button');
      assert.dom('[data-test-instance-chooser]').doesNotExist();
    });
  });

  module('multiple realms', function (hooks) {
    let personalRealmURL: string;
    let additionalRealmURL: string;

    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
    });

    let { setActiveRealms, setRealmPermissions, createAndJoinRoom } =
      mockMatrixUtils;

    hooks.beforeEach(async function () {
      matrixRoomId = createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-test',
      });
      setupUserSubscription(matrixRoomId);

      let realmServerService = this.owner.lookup(
        'service:realm-server',
      ) as RealmServerService;
      personalRealmURL = `${realmServerService.url}testuser/personal/`;
      additionalRealmURL = `${realmServerService.url}testuser/aaa/`; // writeable realm that is lexically before the personal realm
      setActiveRealms([additionalRealmURL, personalRealmURL]);

      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        realmURL: personalRealmURL,
        contents: {
          'author-card.gts': authorCard,
          '.realm.json': {
            name: `Test User's Workspace`,
            backgroundURL: 'https://i.postimg.cc/NjcjbyD3/4k-origami-flock.jpg',
            iconURL: 'https://i.postimg.cc/Rq550Bwv/T.png',
          },
        },
      });

      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        realmURL: additionalRealmURL,
        contents: {
          'author-card.gts': authorCard,
          '.realm.json': {
            name: `Additional Workspace`,
            backgroundURL: 'https://i.postimg.cc/4ycXQZ94/4k-powder-puff.jpg',
            iconURL: 'https://i.postimg.cc/BZwv0LyC/A.png',
          },
        },
      });

      setRealmPermissions({
        [additionalRealmURL]: ['read', 'write', 'realm-owner'],
        [personalRealmURL]: ['read', 'write', 'realm-owner'],
      });
    });

    test('can create new instance in currently open realm', async function (assert) {
      removeRecentFiles();
      await openFileInPlayground(
        'author-card.gts',
        additionalRealmURL,
        'Author',
      );
      assert.deepEqual(getRecentFiles()?.[0], [
        additionalRealmURL,
        'author-card.gts',
        { line: 4, column: 38 },
      ]);
      assert.dom('[data-test-card]').doesNotExist();

      await createNewInstance();

      let recentFiles = getRecentFiles();
      assert.strictEqual(
        recentFiles?.length,
        2,
        'recent file count is correct',
      );
      let newCardId = document
        .querySelector('[data-test-card]')
        ?.getAttribute('data-test-card');
      assert.ok(newCardId?.startsWith(additionalRealmURL));
      assert.notOk(newCardId?.startsWith(personalRealmURL));

      let recentCardId = `${recentFiles?.[0][0]}${recentFiles?.[0][1]}`.replace(
        '.json',
        '',
      );
      assert.strictEqual(newCardId, recentCardId);
      assertCardExists(
        assert,
        recentCardId,
        'edit',
        'new card is rendered in edit format',
      );
    });
  });

  module('indexing error', function (hooks) {
    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);
    setupOnSave(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
    });
    let { setRealmPermissions, setActiveRealms, createAndJoinRoom } =
      mockMatrixUtils;

    const boomPet = `import { contains, field, CardDef, Component, FieldDef, StringField, serialize } from 'https://cardstack.com/base/card-api';
      // this field explodes when serialized (saved)
      export class BoomField extends FieldDef {
        @field title = contains(StringField);
        static [serialize](_boom: any) {
          throw new Error('Boom!');
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <@fields.title />
          </template>
        };
      }
      export class BoomPet extends CardDef {
        static displayName = 'Boom Pet';
        @field boom = contains(BoomField);
      }
    `;

    hooks.beforeEach(async function () {
      matrixRoomId = createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-test',
      });
      setupUserSubscription(matrixRoomId);
      setActiveRealms([testRealmURL]);
      setRealmPermissions({
        [testRealmURL]: ['read', 'write'],
      });
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {
          'boom-pet.gts': boomPet,
          'BoomPet/cassidy.json': {
            data: {
              attributes: {
                title: 'Cassidy Cat',
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}boom-pet`,
                  name: 'BoomPet',
                },
              },
            },
          },
        },
      });
    });

    test('it renders a playground instance with an error that has does not have a last known good state', async function (assert) {
      setPlaygroundSelections({
        [`${testRealmURL}boom-pet/BoomPet`]: {
          cardId: `${testRealmURL}BoomPet/cassidy`,
          format: 'isolated',
        },
      });
      await openFileInPlayground('boom-pet.gts', testRealmURL, 'BoomPet');
      assert.dom('[data-test-card-error]').exists();
    });
  });
});
