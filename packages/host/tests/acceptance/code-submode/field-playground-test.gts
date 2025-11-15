import { click, fillIn, settled } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { specRef, type Realm } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import {
  assertMessages,
  percySnapshot,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupUserSubscription,
  testRealmURL,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import {
  assertCardExists,
  assertFieldExists,
  chooseAnotherInstance,
  createNewInstance,
  getPlaygroundSelections,
  openFileInPlayground,
  removePlaygroundSelections,
  removeSpecSelection,
  selectDeclaration,
  selectFormat,
  setPlaygroundSelections,
  togglePlaygroundPanel,
  toggleSpecPanel,
  type PlaygroundSelection,
  type Format,
} from '../../helpers/playground';
import { setRecentFiles } from '../../helpers/recent-files-cards';
import { setupApplicationTest } from '../../helpers/setup';

const { resolvedBaseRealmURL } = ENV;

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
  import { Author } from './author';

  export class Status extends StringField {
    static displayName = 'Status';
  }

  class LocalStatusField extends Status {}

  export class Comment extends FieldDef {
    static displayName = 'Comment';
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

  export class ContactInfo extends FieldDef {
    @field email = contains(StringField);
    static atom = class Atom extends Component<typeof this> {
      <template>
        <div data-test-atom-contact-info>
          <@fields.email />
        </div>
      </template>
    }
    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <div data-test-embedded-contact-info>
          <@fields.email />
        </div>
      </template>
    }
  }

  export class BlogPost extends CardDef {
    static displayName = 'Blog Post';
    @field title = contains(StringField)
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

const petCard = `import { contains, containsMany, field, CardDef, Component, FieldDef, StringField } from 'https://cardstack.com/base/card-api';
  export class ToyField extends FieldDef {
    static displayName = 'Toy';
    @field title = contains(StringField);
  }
  export class TreatField extends FieldDef {
    static displayName = 'Treat';
    @field title = contains(StringField);
  }
  export class PetCard extends CardDef {
    static displayName = 'Pet';
    @field firstName = contains(StringField);
    @field favoriteToys = containsMany(ToyField);
  }
`;

module('Acceptance | code-submode | field playground', function (_hooks) {
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

    hooks.beforeEach(async function () {
      createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-test',
      });
      setupUserSubscription();
      setupAuthEndpoints();

      ({ realm } = await setupAcceptanceTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'author.gts': authorCard,
          'blog-post.gts': blogPostCard,
          'pet.gts': petCard,
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
          'Spec/contact-info.json': {
            data: {
              type: 'card',
              attributes: {
                ref: {
                  name: 'ContactInfo',
                  module: '../blog-post',
                },
                specType: 'field',
                containedExamples: [
                  { email: 'marcelius@email.com' },
                  { email: 'lilian@email.com' },
                  { email: 'susie@email.com' },
                ],
                title: 'Contact Info',
              },
              meta: {
                fields: {
                  containedExamples: [
                    {
                      adoptsFrom: {
                        module: '../blog-post',
                        name: 'ContactInfo',
                      },
                    },
                    {
                      adoptsFrom: {
                        module: '../blog-post',
                        name: 'ContactInfo',
                      },
                    },
                    {
                      adoptsFrom: {
                        module: '../blog-post',
                        name: 'ContactInfo',
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
          'Spec/toy.json': {
            data: {
              type: 'card',
              attributes: {
                ref: {
                  name: 'ToyField',
                  module: '../pet',
                },
                specType: 'field',
                containedExamples: [
                  { title: 'Tug rope' },
                  { title: 'Lambchop' },
                ],
                title: 'Toy',
              },
              meta: {
                fields: {
                  containedExamples: [
                    {
                      adoptsFrom: {
                        module: '../pet',
                        name: 'ToyField',
                      },
                    },
                    {
                      adoptsFrom: {
                        module: '../pet',
                        name: 'ToyField',
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
          'Pet/mango.json': {
            data: {
              attributes: {
                firstName: 'Mango',
                title: 'Mango',
                favoriteToys: [{ title: 'Tug rope' }, { title: 'Lambchop' }],
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}pet`,
                  name: 'PetCard',
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
      removeSpecSelection();

      setActiveRealms([testRealmURL]);
      setRealmPermissions({
        [testRealmURL]: ['read', 'write'],
      });
    });

    test('can preview compound field instance', async function (assert) {
      await openFileInPlayground('blog-post.gts', testRealmURL, {
        declaration: 'Comment',
      });
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
      await openFileInPlayground('blog-post.gts', testRealmURL, {
        declaration: 'Comment',
      });
      assert.dom('[data-test-playground-panel]').exists();

      await selectDeclaration('Status');
      assert
        .dom('[data-test-playground-panel]')
        .doesNotExist('primitive field');
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

    test('can populate instance chooser dropdown options with containedExamples from Spec', async function (assert) {
      await openFileInPlayground('blog-post.gts', testRealmURL, {
        declaration: 'ContactInfo',
      });
      assertFieldExists(assert, 'embedded');
      assert
        .dom('[data-test-selected-item]')
        .containsText('Contact Info - Example 1');
      assert
        .dom('[data-test-embedded-contact-info]')
        .hasText('marcelius@email.com');

      await click('[data-test-instance-chooser]');
      assert.dom('[data-option-index]').exists({ count: 3 });
      assert.dom('[data-option-index="0"]').hasText('marcelius@email.com');
      assert.dom('[data-option-index="1"]').hasText('lilian@email.com');
      assert.dom('[data-option-index="2"]').hasText('susie@email.com');

      await click('[data-option-index="2"]');
      assert
        .dom('[data-test-selected-item]')
        .containsText('Contact Info - Example 3');
      assert
        .dom('[data-test-embedded-contact-info]')
        .hasText('susie@email.com');
    });

    test('can update the instance chooser when selected declaration changes', async function (assert) {
      await openFileInPlayground('blog-post.gts', testRealmURL, {
        declaration: 'ContactInfo',
      });
      assertFieldExists(assert, 'embedded');
      assert
        .dom('[data-test-selected-item]')
        .containsText('Contact Info - Example 1');
      assert
        .dom('[data-test-embedded-contact-info]')
        .hasText('marcelius@email.com');
      await click('[data-test-instance-chooser]');
      assert.dom('[data-option-index]').exists({ count: 3 });
      assert.dom('[data-option-index="0"]').hasText('marcelius@email.com');

      await selectDeclaration('Comment');
      assert
        .dom('[data-test-selected-item]')
        .containsText('Comment spec - Example 1');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText('Terrible product');
      await click('[data-test-instance-chooser]');
      assert.dom('[data-option-index]').exists({ count: 2 });
      assert.dom('[data-option-index="0"]').hasText('Terrible product');
      assert.dom('[data-option-index="1"]').hasText('Needs better packaging');

      await selectDeclaration('BlogPost'); // card def selected
      assert
        .dom('[data-test-selected-item]')
        .containsText('Remote Work', 'most-recent card is pre-selected');
      assertCardExists(assert, `${testRealmURL}BlogPost/remote-work`);

      await selectDeclaration('ContactInfo');
      assertFieldExists(assert, 'embedded');
      assert
        .dom('[data-test-selected-item]')
        .containsText('Contact Info - Example 1');
    });

    test('changing the selected spec in Boxel Spec panel changes selected spec in playground', async function (assert) {
      await openFileInPlayground('blog-post.gts', testRealmURL, {
        declaration: 'Comment',
      });
      assert
        .dom('[data-test-selected-item]')
        .containsText('Comment spec - Example 1');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText('Terrible product');
      let selection =
        getPlaygroundSelections()?.[`${testRealmURL}blog-post/Comment`];
      assert.deepEqual(selection, {
        cardId: `${testRealmURL}Spec/comment-1`,
        format: 'embedded',
        fieldIndex: 0,
        url: `${testRealmURL}blog-post.gts`,
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
        .containsText('Comment spec II - Example 1');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText('Spec 2 Example 1');
      selection =
        getPlaygroundSelections()?.[`${testRealmURL}blog-post/Comment`];
      assert.deepEqual(selection, {
        cardId: `${testRealmURL}Spec/comment-2`,
        format: 'embedded',
        fieldIndex: 0,
        url: `${testRealmURL}blog-post.gts`,
      });
    });

    test("can select a different instance to preview from the spec's containedExamples collection", async function (assert) {
      await openFileInPlayground('blog-post.gts', testRealmURL, {
        declaration: 'Comment',
      });
      assert
        .dom('[data-test-selected-item]')
        .containsText('Comment spec - Example 1');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText('Terrible product');
      let selection =
        getPlaygroundSelections()?.[`${testRealmURL}blog-post/Comment`];
      assert.deepEqual(selection, {
        cardId: `${testRealmURL}Spec/comment-1`,
        format: 'embedded',
        fieldIndex: 0,
        url: `${testRealmURL}blog-post.gts`,
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
      selection =
        getPlaygroundSelections()?.[`${testRealmURL}blog-post/Comment`];
      assert.deepEqual(selection, {
        cardId: `${testRealmURL}Spec/comment-1`,
        format: 'embedded',
        fieldIndex: 1,
        url: `${testRealmURL}blog-post.gts`,
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
      await openFileInPlayground('blog-post.gts', testRealmURL, {
        declaration: 'Comment',
      });
      assert
        .dom('[data-test-selected-item]')
        .containsText('Comment spec - Example 2');
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
        .dom(
          '[data-test-contains-many="containedExamples"] [data-test-item="1"]',
        )
        .doesNotExist();
      assert
        .dom(
          '[data-test-contains-many="containedExamples"] [data-test-item="0"]',
        )
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
      assert
        .dom('[data-test-selected-item]')
        .containsText('Comment spec - Example 1');
      assertFieldExists(assert, 'edit', 'new field instance is autogenerated');
    });

    test('can autogenerate new Spec and field instance (no preexisting Spec)', async function (assert) {
      await openFileInPlayground('author.gts', testRealmURL, {
        declaration: 'Quote',
      });
      assert
        .dom('[data-test-instance-chooser]')
        .containsText('Quote - Example 1');
      assertFieldExists(assert, 'edit');
      assert.dom('[data-test-field="quote"] input').hasNoValue();

      await toggleSpecPanel();
      assert
        .dom('[data-test-spec-selector] > .ember-basic-dropdown-trigger')
        .hasAttribute('aria-disabled', 'true', 'has only 1 spec instance');
      assert.dom('[data-test-boxel-input-id="spec-title"]').hasValue('Quote');
      assert
        .dom(
          '[data-test-contains-many="containedExamples"] [data-test-item="0"] [data-test-field="quote"] input',
        )
        .hasNoValue();

      await togglePlaygroundPanel();
      assertFieldExists(assert, 'edit');
      await toggleSpecPanel();
      assert
        .dom('[data-test-spec-selector] > .ember-basic-dropdown-trigger')
        .hasAttribute(
          'aria-disabled',
          'true',
          'still has only 1 spec instance',
        );
    });

    test('can create new field instance (has preexisting Spec)', async function (assert) {
      await openFileInPlayground('blog-post.gts', testRealmURL, {
        declaration: 'Comment',
      });
      assert
        .dom('[data-test-selected-item]')
        .containsText('Comment spec - Example 1');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText('Terrible product');
      let selection =
        getPlaygroundSelections()?.[`${testRealmURL}blog-post/Comment`];
      assert.deepEqual(selection, {
        cardId: `${testRealmURL}Spec/comment-1`,
        format: 'embedded',
        fieldIndex: 0,
        url: `${testRealmURL}blog-post.gts`,
      });

      await createNewInstance();
      assert
        .dom('[data-test-field-preview-card] [data-test-field="title"] input')
        .hasNoValue();
      selection =
        getPlaygroundSelections()?.[`${testRealmURL}blog-post/Comment`];
      assert.deepEqual(selection, {
        cardId: `${testRealmURL}Spec/comment-1`,
        format: 'edit',
        fieldIndex: 2,
        url: `${testRealmURL}blog-post.gts`,
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

    test('can autogenerate new field instance when spec exists but has no examples', async function (assert) {
      let selection =
        getPlaygroundSelections()?.[`${testRealmURL}author/FullNameField`];
      assert.strictEqual(selection, undefined);
      await openFileInPlayground('author.gts', testRealmURL, {
        declaration: 'FullNameField',
      });
      assert
        .dom('[data-test-selected-item]')
        .containsText('FullNameField spec - Example 1');
      assertFieldExists(assert, 'edit');
      assert
        .dom(
          '[data-test-field-preview-card] [data-test-field="firstName"] input',
        )
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
        .dom('[data-test-spec-selector] > .ember-basic-dropdown-trigger')
        .hasAttribute('aria-disabled', 'true', 'has only 1 spec instance');
      assert
        .dom('[data-test-contains-many="containedExamples"] [data-test-item]')
        .exists({ count: 1 });
      assert
        .dom(
          '[data-test-contains-many="containedExamples"] [data-test-item="0"] [data-test-field="firstName"] input',
        )
        .hasValue('Marco');

      selection =
        getPlaygroundSelections()?.[`${testRealmURL}author/FullNameField`];
      assert.deepEqual(selection, {
        cardId: `${testRealmURL}Spec/full-name`,
        format: 'edit',
        fieldIndex: 0,
        url: `${testRealmURL}author.gts`,
      });
    });

    test('has default templates when a format template is not provided', async function (assert) {
      await openFileInPlayground('pet.gts', testRealmURL, {
        declaration: 'TreatField',
      });
      assert
        .dom('[data-test-instance-chooser]')
        .containsText('TreatField - Example 1');
      assertFieldExists(assert, 'edit'); // spec was autogenerated
      await selectFormat('embedded');
      assert
        .dom('[data-test-missing-template-text="embedded"]')
        .hasText('Missing embedded component for FieldDef: Treat');
      await selectFormat('fitted');
      assert
        .dom('[data-test-missing-template-text="fitted"]')
        .hasText('Missing fitted component for FieldDef: Treat');
      await selectFormat('atom');
      assert
        .dom('[data-test-compound-field-format="atom"]')
        .hasText('Untitled Treat');
    });

    test('does not persist the wrong card for field', async function (assert) {
      const cardId = `${testRealmURL}Pet/mango`;
      const specId = `${testRealmURL}Spec/toy`;
      let selections: Record<string, PlaygroundSelection> = {
        [`${testRealmURL}pet/PetCard`]: {
          cardId,
          format: 'isolated' as Format,
        },
      };
      setRecentFiles([[testRealmURL, 'Pet/mango.json']]);
      setPlaygroundSelections(selections);

      await openFileInPlayground('pet.gts', testRealmURL, {
        declaration: 'ToyField',
      });
      assert
        .dom('[data-test-instance-chooser]')
        .containsText('Toy - Example 1');
      assertFieldExists(assert, 'embedded');
      selections = {
        ...selections,
        [`${testRealmURL}pet/ToyField`]: {
          cardId: specId,
          fieldIndex: 0,
          format: 'embedded',
          url: `${testRealmURL}pet.gts`,
        },
      };
      assert.deepEqual(
        getPlaygroundSelections(),
        selections,
        'persisted selections are correct',
      );

      await selectDeclaration('PetCard');
      assertCardExists(assert, cardId, 'isolated');
      await selectDeclaration('ToyField');
      assert
        .dom('[data-test-instance-chooser]')
        .containsText('Toy - Example 1');
      assertFieldExists(assert, 'embedded');
      assert.deepEqual(
        getPlaygroundSelections(),
        selections,
        'persisted selections are still correct',
      );
    });

    test('editing compound field instance live updates the preview', async function (assert) {
      const originalEmbeddedBlock = `    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <div data-test-embedded-comment>
          <h4 data-test-embedded-comment-title><@fields.title /></h4>
          <p><@fields.message /> - by <@fields.name /></p>
        </div>
      </template>
    }
`;
      const updatedEmbeddedBlock = `    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <div data-test-embedded-comment>
          <p><@fields.message /> - by <@fields.name /></p>
        </div>
      </template>
    }
`;
      const updatedCommentField = blogPostCard.replace(
        originalEmbeddedBlock,
        updatedEmbeddedBlock,
      );
      if (updatedCommentField === blogPostCard) {
        throw new Error('failed to apply updated comment template');
      }
      await openFileInPlayground('blog-post.gts', testRealmURL, {
        declaration: 'Comment',
      });
      assertFieldExists(assert, 'embedded');
      assert
        .dom('[data-test-embedded-comment-title]')
        .hasText('Terrible product');

      await realm.write('blog-post.gts', updatedCommentField);
      await settled();
      assertFieldExists(assert, 'embedded');
      assert.dom('[data-test-embedded-comment-title]').doesNotExist();
    });

    test('can request AI assistant to fill in sample data', async function (assert) {
      const prompt = `Fill in sample data for this example on the card's spec.`;
      const menuItem = 'Fill in sample data with AI';
      const commandMessage = {
        from: 'testuser',
        message: prompt,
        cards: [{ id: `${testRealmURL}Spec/toy` }],
        files: [{ name: 'pet.gts', sourceUrl: `${testRealmURL}pet.gts` }],
      };
      await openFileInPlayground('pet.gts', testRealmURL, {
        declaration: 'ToyField',
      });
      assert
        .dom('[data-test-instance-chooser]')
        .containsText('Toy - Example 1');
      assertFieldExists(assert, 'embedded');

      await click('[data-test-instance-chooser]');
      await click(`[data-test-boxel-menu-item-text="${menuItem}"]`);
      assertMessages(assert, [commandMessage]);
    });

    test('can request AI assistant to bulk generate samples', async function (assert) {
      const prompt = `Generate 3 additional examples on this card's spec.`;
      const menuItem = `Generate 3 examples with AI`;
      const commandMessage = {
        from: 'testuser',
        message: prompt,
        cards: [{ id: `${testRealmURL}Spec/toy` }],
        files: [{ name: 'pet.gts', sourceUrl: `${testRealmURL}pet.gts` }],
      };
      await openFileInPlayground('pet.gts', testRealmURL, {
        declaration: 'ToyField',
      });
      assert
        .dom('[data-test-instance-chooser]')
        .containsText('Toy - Example 1');
      assertFieldExists(assert, 'embedded');

      await click('[data-test-instance-chooser]');
      await click(`[data-test-boxel-menu-item-text="${menuItem}"]`);
      assertMessages(assert, [commandMessage]);
    });
  });

  module('multiple realms', function (hooks) {
    let realm: Realm;
    let origin = new URL(resolvedBaseRealmURL).origin;
    let personalRealmURL = `${origin}/testuser/personal/`;
    let additionalRealmURL = `${origin}/testuser/aaa/`; // writeable realm that is lexically before the personal realm

    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [personalRealmURL, additionalRealmURL],
    });
    let { setRealmPermissions, createAndJoinRoom } = mockMatrixUtils;

    hooks.beforeEach(async function () {
      createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-test',
      });
      setupUserSubscription();
      setupAuthEndpoints();

      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        realmURL: personalRealmURL,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'author.gts': authorCard,
          '.realm.json': {
            name: `Test User's Workspace`,
            backgroundURL: 'https://i.postimg.cc/NjcjbyD3/4k-origami-flock.jpg',
            iconURL: 'https://i.postimg.cc/Rq550Bwv/T.png',
          },
        },
      });

      ({ realm } = await setupAcceptanceTestRealm({
        mockMatrixUtils,
        realmURL: additionalRealmURL,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'author.gts': authorCard,
          'pet.gts': petCard,
          'Spec/toy.json': {
            data: {
              type: 'card',
              attributes: {
                ref: {
                  name: 'ToyField',
                  module: '../pet',
                },
                specType: 'field',
                containedExamples: [{ title: 'Tug rope' }],
                title: 'Toy',
              },
              meta: {
                fields: {
                  containedExamples: [
                    {
                      adoptsFrom: {
                        module: '../pet',
                        name: 'ToyField',
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
          '.realm.json': {
            name: `Additional Workspace`,
            backgroundURL: 'https://i.postimg.cc/4ycXQZ94/4k-powder-puff.jpg',
            iconURL: 'https://i.postimg.cc/BZwv0LyC/A.png',
          },
        },
      }));

      setRealmPermissions({
        [additionalRealmURL]: ['read', 'write', 'realm-owner'],
        [personalRealmURL]: ['read', 'write', 'realm-owner'],
      });
    });

    test('can autogenerate new Spec and field instance (no preexisting Spec)', async function (assert) {
      let queryEngine = realm.realmIndexQueryEngine;
      let { data: matching } = await queryEngine.search({
        filter: {
          on: specRef,
          eq: {
            specType: 'field',
            isField: true,
            title: 'Quote',
            moduleHref: `${additionalRealmURL}author`,
          },
        },
      });
      assert.strictEqual(matching.length, 0);

      await openFileInPlayground('author.gts', additionalRealmURL, {
        declaration: 'Quote',
      });
      assert
        .dom('[data-test-instance-chooser]')
        .containsText('Quote - Example 1');
      assertFieldExists(assert, 'edit');
      assert.dom('[data-test-field="quote"] input').hasNoValue();

      ({ data: matching } = await queryEngine.search({
        filter: {
          on: specRef,
          eq: {
            specType: 'field',
            isField: true,
            title: 'Quote',
            moduleHref: `${additionalRealmURL}author`,
          },
        },
      }));
      assert.strictEqual(matching.length, 1);
      assert.ok(matching[0].id!.startsWith(`${additionalRealmURL}Spec/`));

      await toggleSpecPanel();
      assert
        .dom('[data-test-spec-selector] > .ember-basic-dropdown-trigger')
        .hasAttribute('aria-disabled', 'true', 'has only 1 spec instance');
      assert.dom('[data-test-boxel-input-id="spec-title"]').hasValue('Quote');
      assert
        .dom(
          '[data-test-contains-many="containedExamples"] [data-test-item="0"] [data-test-field="quote"] input',
        )
        .hasNoValue();
      await togglePlaygroundPanel();
      assertFieldExists(assert, 'edit');
      await toggleSpecPanel();
      assert
        .dom('[data-test-spec-selector] > .ember-basic-dropdown-trigger')
        .hasAttribute(
          'aria-disabled',
          'true',
          'still has only 1 spec instance',
        );
    });

    test('can create new field instance (has preexisting Spec)', async function (assert) {
      await openFileInPlayground('pet.gts', additionalRealmURL, {
        declaration: 'ToyField',
      });
      assert.dom('[data-test-selected-item]').containsText('Toy - Example 1');
      await selectFormat('atom');
      assertFieldExists(assert, 'atom');
      assert
        .dom(
          '[data-test-playground-panel] [data-test-compound-field-format="atom"]',
        )
        .hasText('Tug rope');
      let selection =
        getPlaygroundSelections()?.[`${additionalRealmURL}pet/ToyField`];
      assert.deepEqual(selection, {
        cardId: `${additionalRealmURL}Spec/toy`,
        format: 'atom',
        fieldIndex: 0,
        url: `${additionalRealmURL}pet.gts`,
      });

      await createNewInstance();
      assert
        .dom('[data-test-field-preview-card] [data-test-field="title"] input')
        .hasNoValue();
      selection =
        getPlaygroundSelections()?.[`${additionalRealmURL}pet/ToyField`];
      assert.deepEqual(selection, {
        cardId: `${additionalRealmURL}Spec/toy`,
        format: 'edit',
        fieldIndex: 1,
        url: `${additionalRealmURL}pet.gts`,
      });

      await toggleSpecPanel();
      assert
        .dom('[data-test-contains-many="containedExamples"] [data-test-item]')
        .exists({ count: 2 });
      assert
        .dom(
          '[data-test-contains-many="containedExamples"] [data-test-item="1"] [data-test-field="title"] input',
        )
        .hasNoValue();

      await togglePlaygroundPanel();
      await chooseAnotherInstance();
      assert
        .dom('[data-test-field-chooser] [data-test-field-instance]')
        .exists({ count: 2 });
    });

    test('can autogenerate new field instance when spec exists but has no examples', async function (assert) {
      let selection =
        getPlaygroundSelections()?.[
          `${additionalRealmURL}author/FullNameField`
        ];
      assert.strictEqual(selection, undefined);
      await openFileInPlayground('author.gts', additionalRealmURL, {
        declaration: 'FullNameField',
      });
      assert
        .dom('[data-test-selected-item]')
        .containsText('FullNameField spec - Example 1');
      assertFieldExists(assert, 'edit');
      assert
        .dom(
          '[data-test-field-preview-card] [data-test-field="firstName"] input',
        )
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
        .dom('[data-test-spec-selector] > .ember-basic-dropdown-trigger')
        .hasAttribute('aria-disabled', 'true', 'has only 1 spec instance');
      assert
        .dom('[data-test-contains-many="containedExamples"] [data-test-item]')
        .exists({ count: 1 });
      assert
        .dom(
          '[data-test-contains-many="containedExamples"] [data-test-item="0"] [data-test-field="firstName"] input',
        )
        .hasValue('Marco');

      selection =
        getPlaygroundSelections()?.[
          `${additionalRealmURL}author/FullNameField`
        ];
      assert.deepEqual(selection, {
        cardId: `${additionalRealmURL}Spec/full-name`,
        format: 'edit',
        fieldIndex: 0,
        url: `${additionalRealmURL}author.gts`,
      });
    });
  });
});
