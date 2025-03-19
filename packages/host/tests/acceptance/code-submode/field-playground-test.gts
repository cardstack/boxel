import { click, fillIn, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import type { Realm } from '@cardstack/runtime-common';

import {
  percySnapshot,
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  testRealmURL,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import {
  assertFieldExists,
  chooseAnotherInstance,
  createNewInstance,
  getPlaygroundSelections,
  openFileInPlayground,
  removePlaygroundSelections,
  selectDeclaration,
  selectFormat,
  setPlaygroundSelections,
  setRecentFiles,
  togglePlaygroundPanel,
  toggleSpecPanel,
} from '../../helpers/playground';
import { setupApplicationTest } from '../../helpers/setup';

let matrixRoomId: string;
module('Acceptance | code-submode | field playground', function (hooks) {
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

  const blogPostCard = `import { contains, containsMany, field, linksTo, CardDef, Component, FieldDef } from "https://cardstack.com/base/card-api";
    import DatetimeField from 'https://cardstack.com/base/datetime';
    import MarkdownField from 'https://cardstack.com/base/markdown';
    import StringField from "https://cardstack.com/base/string";
    import { Sparkle } from '@cardstack/boxel-ui/icons';
    import { Author } from './author';

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

      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <div data-test-fitted-comment><@fields.title /> - by <@fields.name /></div>
        </template>
      }
    }

    class LocalCommentField extends Comment {}

    export class BlogPost extends CardDef {
      static displayName = 'Blog Post';
      @field publishDate = contains(DatetimeField);
      @field author = linksTo(Author);
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
    setRecentFiles([
      [testRealmURL, 'blog-post.gts'],
      [testRealmURL, 'author.gts'],
      [testRealmURL, 'BlogPost/remote-work.json'],
      [testRealmURL, 'Author/jane-doe.json'],
    ]);
    removePlaygroundSelections();

    setActiveRealms([testRealmURL]);
    setRealmPermissions({
      [testRealmURL]: ['read', 'write'],
    });
  });

  test('can preview compound field instance', async function (assert) {
    await openFileInPlayground('blog-post.gts', testRealmURL, 'Comment');
    assert
      .dom('[data-test-playground-format-chooser] button')
      .exists({ count: 4 });
    assert.dom('[data-test-format-chooser="isolated"]').doesNotExist();
    assert.dom('[data-test-format-chooser="embedded"]').hasClass('active');
    assert
      .dom('[data-test-embedded-comment-title]')
      .hasText('Terrible product');
    assert.dom('[data-test-embedded-comment]').containsText('0 stars');
    await percySnapshot(assert);

    await selectFormat('atom');
    assert.dom('[data-test-format-chooser="embedded"]').hasNoClass('active');
    assert.dom('[data-test-format-chooser="atom"]').hasClass('active');
    assertFieldExists(assert, 'atom');

    await selectFormat('edit');
    assertFieldExists(assert, 'edit');
    assert
      .dom('[data-test-field-preview-card] [data-test-field]')
      .exists({ count: 3 });
    assert
      .dom('[data-test-field-preview-card] [data-test-field="name"] input')
      .hasValue('Marco');

    await selectFormat('fitted');
    assertFieldExists(assert, 'fitted');
    assert.dom('[data-test-fitted-comment]').containsText('by Marco');
  });

  test('can not preview non-exports or primitives', async function (assert) {
    await openFileInPlayground('blog-post.gts', testRealmURL, 'Comment');
    assert.dom('[data-test-playground-panel]').exists();

    await selectDeclaration('Status');
    assert.dom('[data-test-playground-panel]').doesNotExist('primitive field');
    assert.dom('[data-test-incompatible-primitives]').exists();

    await selectDeclaration('LocalStatusField');
    assert
      .dom('[data-test-playground-panel]')
      .doesNotExist('local primitive field');
    assert.dom('[data-test-incompatible-primitives]').exists();

    await selectDeclaration('LocalCommentField');
    assert
      .dom('[data-test-playground-panel]')
      .doesNotExist('local compound field');
    assert.dom('[data-test-incompatible-nonexports]').exists();
  });

  // TODO
  test('can populate instance chooser dropdown options with containedExamples from Spec', async function (_assert) {});
  test('can update the instance chooser when selected declaration changes', async function (_assert) {});

  test('changing the selected spec in Boxel Spec panel changes selected spec in playground', async function (assert) {
    await openFileInPlayground('blog-post.gts', testRealmURL, 'Comment');
    assert.dom('[data-test-selected-item]').hasText('Comment spec - Example 1');
    assert
      .dom('[data-test-embedded-comment-title]')
      .hasText('Terrible product');
    let selection =
      getPlaygroundSelections()?.[`${testRealmURL}blog-post/Comment`];
    assert.deepEqual(selection, {
      cardId: `${testRealmURL}Spec/comment-1`,
      format: 'embedded',
      fieldIndex: 0,
    });

    await toggleSpecPanel();
    assert
      .dom(
        `[data-test-card="${testRealmURL}Spec/comment-1"] [data-test-boxel-input-id="spec-title"]`,
      )
      .hasValue('Comment spec');
    assert
      .dom('[data-test-spec-selector] [data-test-spec-selector-item-path]')
      .containsText('Spec/comment-1');
    await click('[data-test-spec-selector] > div');
    assert
      .dom('[data-option-index="1"] [data-test-spec-selector-item-path]')
      .hasText('Spec/comment-2');
    await click('[data-option-index="1"]');
    assert
      .dom('[data-test-spec-selector] [data-test-spec-selector-item-path]')
      .containsText('Spec/comment-2');
    assert
      .dom(
        `[data-test-card="${testRealmURL}Spec/comment-2"] [data-test-boxel-input-id="spec-title"]`,
      )
      .hasValue('Comment spec II');

    await togglePlaygroundPanel();
    assert
      .dom('[data-test-selected-item]')
      .hasText('Comment spec II - Example 1');
    assert
      .dom('[data-test-embedded-comment-title]')
      .hasText('Spec 2 Example 1');
    selection = getPlaygroundSelections()?.[`${testRealmURL}blog-post/Comment`];
    assert.deepEqual(selection, {
      cardId: `${testRealmURL}Spec/comment-2`,
      format: 'embedded',
      fieldIndex: 0,
    });
  });

  test("can select a different instance to preview from the spec's containedExamples collection", async function (assert) {
    await openFileInPlayground('blog-post.gts', testRealmURL, 'Comment');
    assert.dom('[data-test-selected-item]').hasText('Comment spec - Example 1');
    assert
      .dom('[data-test-embedded-comment-title]')
      .hasText('Terrible product');
    let selection =
      getPlaygroundSelections()?.[`${testRealmURL}blog-post/Comment`];
    assert.deepEqual(selection, {
      cardId: `${testRealmURL}Spec/comment-1`,
      format: 'embedded',
      fieldIndex: 0,
    });

    await chooseAnotherInstance();
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
    selection = getPlaygroundSelections()?.[`${testRealmURL}blog-post/Comment`];
    assert.deepEqual(selection, {
      cardId: `${testRealmURL}Spec/comment-1`,
      format: 'embedded',
      fieldIndex: 1,
    });
  });

  test('preview the next available example if the previously selected one has been deleted', async function (assert) {
    setPlaygroundSelections({
      [`${testRealmURL}blog-post/Comment`]: {
        cardId: `${testRealmURL}Spec/comment-1`,
        format: 'embedded',
        fieldIndex: 1,
      },
    });
    await openFileInPlayground('blog-post.gts', testRealmURL, 'Comment');
    assert.dom('[data-test-selected-item]').hasText('Comment spec - Example 2');
    assert
      .dom('[data-test-embedded-comment-title]')
      .hasText('Needs better packaging');

    await toggleSpecPanel();
    assert
      .dom(
        '[data-test-contains-many="containedExamples"] [data-test-item="1"] [data-test-field="title"] input',
      )
      .hasValue('Needs better packaging');
    await click(
      '[data-test-contains-many="containedExamples"] [data-test-remove="1"]',
    );
    assert
      .dom('[data-test-contains-many="containedExamples"] [data-test-item="1"]')
      .doesNotExist();
    assert
      .dom('[data-test-contains-many="containedExamples"] [data-test-item="0"]')
      .exists();

    await togglePlaygroundPanel();
    assert
      .dom('[data-test-embedded-comment-title]')
      .hasText('Terrible product');

    await toggleSpecPanel();
    await click(
      '[data-test-contains-many="containedExamples"] [data-test-remove="0"]',
    ); // remove remaining contained example from spec
    assert
      .dom('[data-test-contains-many="containedExamples"] [data-test-item]')
      .doesNotExist();

    await togglePlaygroundPanel();
    assert.dom('[data-test-embedded-comment]').doesNotExist();
    assert.dom('[data-test-add-field-instance]').exists();
  });

  test('can create new field instance (no preexisting Spec)', async function (assert) {
    await openFileInPlayground('author.gts', testRealmURL, 'Quote');
    assert.dom('[data-test-quote-field-embedded]').doesNotExist();
    assert.dom('[data-test-instance-chooser]').hasText('Please Select');
    assert.dom('[data-test-create-spec-button]').exists();

    await createNewInstance();
    assert.dom('[data-test-selected-item]').hasText('Quote - Example 1');
    assertFieldExists(assert, 'edit');
    assert.dom('[data-test-field="quote"] input').hasNoValue();
    assert.dom('[data-test-create-spec-button]').doesNotExist();

    // TODO: spec panel updates when spec is created from playground
    // await toggleAccordionPanel('spec-preview');
    // assert.dom('[data-test-boxel-input-id="spec-title"]').hasValue('Quote');
    // assert
    //   .dom(
    //     '[data-test-contains-many="containedExamples"] [data-test-item="0"] [data-test-field="quote"] input',
    //   )
    //   .hasNoValue();
  });

  test('can create new field instance (has preexisting Spec)', async function (assert) {
    await openFileInPlayground('blog-post.gts', testRealmURL, 'Comment');
    assert.dom('[data-test-selected-item]').hasText('Comment spec - Example 1');
    assert
      .dom('[data-test-embedded-comment-title]')
      .hasText('Terrible product');
    let selection =
      getPlaygroundSelections()?.[`${testRealmURL}blog-post/Comment`];
    assert.deepEqual(selection, {
      cardId: `${testRealmURL}Spec/comment-1`,
      format: 'embedded',
      fieldIndex: 0,
    });

    await createNewInstance();
    assert
      .dom('[data-test-field-preview-card] [data-test-field="title"] input')
      .hasNoValue();
    selection = getPlaygroundSelections()?.[`${testRealmURL}blog-post/Comment`];
    assert.deepEqual(selection, {
      cardId: `${testRealmURL}Spec/comment-1`,
      format: 'edit',
      fieldIndex: 2,
    });

    await toggleSpecPanel();
    assert
      .dom('[data-test-contains-many="containedExamples"] [data-test-item]')
      .exists({ count: 3 });
    assert
      .dom(
        '[data-test-contains-many="containedExamples"] [data-test-item="2"] [data-test-field="title"] input',
      )
      .hasNoValue();

    await togglePlaygroundPanel();
    await chooseAnotherInstance();
    assert
      .dom('[data-test-field-chooser] [data-test-field-instance]')
      .exists({ count: 3 });
  });

  test('can create new field instance when spec exists but has no examples', async function (assert) {
    await openFileInPlayground('author.gts', testRealmURL, 'FullNameField');
    assert.dom('[data-test-instance-chooser]').hasText('Please Select');

    await click('[data-test-add-field-instance]');
    assertFieldExists(assert, 'edit');
    assert
      .dom('[data-test-field-preview-card] [data-test-field="firstName"] input')
      .hasNoValue();
    await fillIn('[data-test-field="firstName"] input', 'Marco');
    await fillIn('[data-test-field="lastName"] input', 'N.');

    await chooseAnotherInstance();
    assert
      .dom('[data-test-field-chooser] [data-test-field-instance]')
      .exists({ count: 1 });
    assert
      .dom('[data-test-field-chooser] [data-test-full-name-embedded]')
      .hasText('Marco N.');
    await click('[data-test-field-chooser] [data-test-close-modal]');

    await toggleSpecPanel();
    assert
      .dom('[data-test-contains-many="containedExamples"] [data-test-item]')
      .exists({ count: 1 });
    assert
      .dom(
        '[data-test-contains-many="containedExamples"] [data-test-item="0"] [data-test-field="firstName"] input',
      )
      .hasValue('Marco');

    let selection =
      getPlaygroundSelections()?.[`${testRealmURL}author/FullNameField`];
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
    await openFileInPlayground('blog-post.gts', testRealmURL, 'Comment');
    assert
      .dom('[data-test-embedded-comment-title]')
      .hasText('Terrible product');
    await realm.write('blog-post.gts', updatedCommentField),
      await waitUntil(
        () =>
          document.querySelector('[data-test-embedded-comment-title]') === null,
      );
    assert.dom('[data-test-embedded-comment-title]').doesNotExist();
  });
});
