import {
  click,
  waitFor,
  waitUntil,
  fillIn,
  settled,
  triggerEvent,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, skip, test } from 'qunit';

import ListingCreateCommand from '@cardstack/host/commands/listing-create';
import ListingInstallCommand from '@cardstack/host/commands/listing-install';
import ListingRemixCommand from '@cardstack/host/commands/listing-remix';
import ListingUseCommand from '@cardstack/host/commands/listing-use';

import { CardDef } from 'https://cardstack.com/base/card-api';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL as mockCatalogURL,
  setupAuthEndpoints,
  setupUserSubscription,
  setupAcceptanceTestRealm,
  visitOperatorMode,
  verifySubmode,
  toggleFileTree,
  openDir,
  verifyFolderWithUUIDInFileTree,
  verifyFileInFileTree,
  verifyJSONWithUUIDInFolder,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

import type { CardListing } from '@cardstack/catalog/listing/listing';

const catalogRealmURL = 'http://localhost:4201/catalog/';
const testDestinationRealmURL = `http://test-realm/test2/`;

//listing
const authorListingId = `${mockCatalogURL}Listing/author`;
const personListingId = `${mockCatalogURL}Listing/person`;
const emptyListingId = `${mockCatalogURL}Listing/empty`;
const pirateSkillListingId = `${mockCatalogURL}SkillListing/pirate-skill`;
const incompleteSkillListingId = `${mockCatalogURL}Listing/incomplete-skill`;
const apiDocumentationStubListingId = `${mockCatalogURL}Listing/api-documentation-stub`;

//skills
const pirateSkillId = `${mockCatalogURL}Skill/pirate-speak`;

//tags
const calculatorTagId = `${mockCatalogURL}Tag/c1fe433a-b3df-41f4-bdcf-d98686ee42d7`;
const gameTagId = `${mockCatalogURL}Tag/51de249c-516a-4c4d-bd88-76e88274c483`;
const stubTagId = `${mockCatalogURL}Tag/stub`;

//specs
const authorSpecId = `${mockCatalogURL}Spec/author`;

//examples
const authorExampleId = `${mockCatalogURL}author/Author/example`;

const authorCardSource = `
  import { field, contains, CardDef, FieldDef } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';


  export class AuthorCompany extends FieldDef {
    static displayName = 'AuthorCompany';
    @field name = contains(StringField);
    @field address = contains(StringField);
    @field city = contains(StringField);
    @field state = contains(StringField);
    @field zip = contains(StringField);
  }

  export class Author extends CardDef {
    static displayName = 'Author';
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field title = contains(StringField, {
      computeVia: function (this: Author) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    @field company = contains(AuthorCompany);
  }
`;

const blogPostCardSource = `
  import { field, contains, CardDef, FieldDef } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  import { Author } from '../author/author';

  export class BlogPost extends CardDef {
    static displayName = 'BlogPost';
    @field title = contains(StringField);
    @field content = contains(StringField);
    @field author = contains(Author);
  }
`;

const contactLinkFieldSource = `
  import { field, contains, FieldDef } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class ContactLink extends FieldDef {
    static displayName = 'ContactLink';
    @field label = contains(StringField);
    @field url = contains(StringField);
    @field type = contains(StringField);
  }
`;

const appCardSource = `
  import { CardDef } from 'https://cardstack.com/base/card-api';

  export class AppCard extends CardDef {
    static displayName = 'App Card';
    static prefersWideFormat = true;
  }
`;

const blogAppCardSource = `
  import { field, contains, containsMany } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  import { AppCard } from '../app-card';
  import { BlogPost } from '../blog-post/blog-post';

  export class BlogApp extends AppCard {
    static displayName = 'Blog App';
    @field title = contains(StringField);
    @field posts = containsMany(BlogPost);
  }
`;

let matrixRoomId: string;
module('Acceptance | Catalog | catalog app tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [mockCatalogURL, testDestinationRealmURL],
  });

  let { getRoomIds, createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    matrixRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();
    // this setup test realm is pretending to be a mock catalog
    await setupAcceptanceTestRealm({
      realmURL: mockCatalogURL,
      mockMatrixUtils,
      contents: {
        'author/author.gts': authorCardSource,
        'blog-post/blog-post.gts': blogPostCardSource,
        'fields/contact-link.gts': contactLinkFieldSource,
        'app-card.gts': appCardSource,
        'blog-app/blog-app.gts': blogAppCardSource,
        'author/Author/example.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Mike',
              lastName: 'Dane',
              summary: 'Author',
            },
            meta: {
              adoptsFrom: {
                module: `${mockCatalogURL}author/author`,
                name: 'Author',
              },
            },
          },
        },
        'blog-post/BlogPost/example.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Blog Post',
              content: 'Blog Post Content',
            },
            relationships: {
              author: {
                links: {
                  self: authorExampleId,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${mockCatalogURL}blog-post/blog-post`,
                name: 'BlogPost',
              },
            },
          },
        },
        'blog-app/BlogApp/example.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'My Blog App',
            },
            meta: {
              adoptsFrom: {
                module: `${mockCatalogURL}blog-app/blog-app`,
                name: 'BlogApp',
              },
            },
          },
        },
        'Spec/author.json': {
          data: {
            type: 'card',
            attributes: {
              ref: {
                name: 'Author',
                module: `${mockCatalogURL}author/author`,
              },
            },
            specType: 'card',
            containedExamples: [],
            title: 'Author',
            description: 'Spec for Author card',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/spec',
                name: 'Spec',
              },
            },
          },
        },
        'Spec/contact-link.json': {
          data: {
            type: 'card',
            attributes: {
              ref: {
                name: 'ContactLink',
                module: `${mockCatalogURL}fields/contact-link`,
              },
            },
            specType: 'field',
            containedExamples: [],
            title: 'ContactLink',
            description: 'Spec for ContactLink field',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/spec',
                name: 'Spec',
              },
            },
          },
        },
        'Listing/author.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Author',
              title: 'Author', // hardcoding title otherwise test will be flaky when waiting for a computed
            },
            relationships: {
              'specs.0': {
                links: {
                  self: authorSpecId,
                },
              },
              'examples.0': {
                links: {
                  self: authorExampleId,
                },
              },
              'tags.0': {
                links: {
                  self: calculatorTagId,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/listing`,
                name: 'CardListing',
              },
            },
          },
        },
        'Listing/person.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Person',
              title: 'Person', // hardcoding title otherwise test will be flaky when waiting for a computed
              images: [
                'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400',
                'https://images.unsplash.com/photo-1494790108755-2616b332db29?w=400',
                'https://images.unsplash.com/photo-1552374196-c4e7ffc6e126?w=400',
              ],
            },
            relationships: {
              'tags.0': {
                links: {
                  self: calculatorTagId,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/listing`,
                name: 'CardListing',
              },
            },
          },
        },
        'AppListing/blog-app.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Blog App',
              title: 'Blog App', // hardcoding title otherwise test will be flaky when waiting for a computed
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/listing`,
                name: 'AppListing',
              },
            },
          },
        },
        'Listing/empty.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Empty',
              title: 'Empty', // hardcoding title otherwise test will be flaky when waiting for a computed
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/listing`,
                name: 'CardListing',
              },
            },
          },
        },
        'SkillListing/pirate-skill.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Pirate Skill',
              title: 'Pirate Skill', // hardcoding title otherwise test will be flaky when waiting for a computed
            },
            relationships: {
              'skills.0': {
                links: {
                  self: pirateSkillId,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/listing`,
                name: 'SkillListing',
              },
            },
          },
        },
        'Listing/incomplete-skill.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Incomplete Skill',
              title: 'Incomplete Skill', // hardcoding title otherwise test will be flaky when waiting for a computed
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/listing`,
                name: 'SkillListing',
              },
            },
          },
        },
        'Skill/pirate-speak.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Talk Like a Pirate',
              name: 'Pirate Speak',
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/skill',
                name: 'Skill',
              },
            },
          },
        },
        'Tag/c1fe433a-b3df-41f4-bdcf-d98686ee42d7.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Calculator',
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/tag`,
                name: 'Tag',
              },
            },
          },
        },
        'Tag/51de249c-516a-4c4d-bd88-76e88274c483.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Game',
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/tag`,
                name: 'Tag',
              },
            },
          },
        },
        'Tag/stub.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Stub',
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/tag`,
                name: 'Tag',
              },
            },
          },
        },
        'Listing/api-documentation-stub.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'API Documentation',
              title: 'API Documentation', // hardcoding title otherwise test will be flaky when waiting for a computed
            },
            relationships: {
              'tags.0': {
                links: {
                  self: stubTagId,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/listing`,
                name: 'Listing',
              },
            },
          },
        },
        'FieldListing/contact-link.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Contact Link',
              title: 'Contact Link', // hardcoding title otherwise test will be flaky when waiting for a computed
              summary:
                'A field for creating and managing contact links such as email, phone, or other web links.',
            },
            relationships: {
              'specs.0': {
                links: {
                  self: `${mockCatalogURL}Spec/contact-link`,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/listing`,
                name: 'FieldListing',
              },
            },
          },
        },
        'index.json': {
          data: {
            type: 'card',
            attributes: {},
            relationships: {
              'startHere.0': {
                links: {
                  self: authorListingId,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/catalog`,
                name: 'Catalog',
              },
            },
          },
        },
        '.realm.json': {
          name: 'Cardstack Catalog',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
      },
    });
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      realmURL: testDestinationRealmURL,
      contents: {
        'index.json': {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
        },
      },
    });
  });

  /**
   * Selects a tab by name within the catalog app
   */
  async function selectTab(tabName: string) {
    await waitFor(`[data-test-catalog-app] [data-test-tab-label="${tabName}"]`);
    await click(`[data-test-catalog-app] [data-test-tab-label="${tabName}"]`);
  }

  /**
   * Waits for grid to load in the catalog app
   */
  async function waitForGrid() {
    await waitFor('[data-test-catalog-list-view]');
    await waitFor('[data-test-cards-grid-cards]');
    await settled();
  }

  /**
   * Waits for showcase view to load
   */
  async function waitForShowcase() {
    await waitFor('[data-test-showcase-view]');
    await settled();
  }

  /**
   * Waits for room operations to complete
   */
  async function waitForRoom() {
    await waitFor('[data-room-settled]');
    await settled();
  }

  /**
   * Waits for a card to appear on the grid with optional title verification
   */
  async function waitForCardOnGrid(cardId: string, title?: string) {
    await waitFor(`[data-test-cards-grid-item="${cardId}"]`);
    if (title) {
      await waitFor(
        `[data-test-cards-grid-item="${cardId}"] [data-test-card-title="${title}"]`,
        //its problematic when we are waiting for computed title
        //my recommendation for the purposes of test is to populate the card title in the realm
      );
    }
  }

  /**
   * Waits for a card to appear on the stack with optional title verification
   */
  async function waitForCardOnStack(cardId: string, expectedTitle?: string) {
    await waitFor(
      `[data-test-stack-card="${cardId}"] [data-test-boxel-card-header-title]`,
    );
    if (expectedTitle) {
      await waitFor(
        `[data-test-stack-card="${cardId}"] [data-test-boxel-card-header-title]`,
      );
    }
  }

  async function clickDropdownItem(menuItemText: string) {
    let selector = `[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="${menuItemText}"]`;
    await waitFor(selector);
    await click(selector);
  }

  async function hoverToHydrateCard(buttonSelector: string) {
    await waitFor(buttonSelector);
    await triggerEvent(buttonSelector, 'mouseenter');
    await waitFor('[data-test-hydrated-card]');
  }

  async function openMenu(buttonSelector: string, checkHydration = true) {
    await waitFor(buttonSelector);
    await triggerEvent(buttonSelector, 'mouseenter');
    if (checkHydration) {
      await waitFor('[data-test-hydrated-card]');
    }
    await click(buttonSelector);
  }

  async function executeListingAction(
    buttonSelector: string,
    menuItemText: string,
    checkHydration = true,
  ) {
    await openMenu(buttonSelector, checkHydration);
    await clickDropdownItem(menuItemText);
  }

  async function verifyListingAction(
    assert: Assert,
    buttonSelector: string,
    expectedText: string,
    expectedMessage: string,
    menuItemName = 'Test Workspace B',
    checkHydration = true,
  ) {
    await waitFor(buttonSelector);
    assert.dom(buttonSelector).containsText(expectedText);
    await executeListingAction(buttonSelector, menuItemName, checkHydration);
    await waitUntil(() => getRoomIds().length > 0);

    const roomId = getRoomIds().pop()!;
    await waitFor(`[data-test-room="${roomId}"][data-test-room-settled]`);
    await waitFor(
      `[data-test-room="${roomId}"] [data-test-ai-assistant-message]`,
    );

    await waitFor(
      `[data-test-room="${roomId}"] [data-test-ai-message-content]`,
    );
    await settled();

    assert
      .dom(`[data-test-room="${roomId}"] [data-test-ai-message-content]`)
      .containsText(expectedMessage);
  }

  async function assertDropdownItem(
    assert: Assert,
    menuItemText: string,
    exists = true,
  ) {
    let selector = `[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="${menuItemText}"]`;
    if (exists) {
      await waitFor(selector);
      assert.dom(selector).exists();
    } else {
      assert.dom(selector).doesNotExist();
    }
  }

  async function executeCommand(
    commandClass:
      | typeof ListingUseCommand
      | typeof ListingInstallCommand
      | typeof ListingRemixCommand,
    listingUrl: string,
    realm: string,
  ) {
    const commandService = getService('command-service');
    const store = getService('store');

    const command = new commandClass(commandService.commandContext);
    const listing = (await store.get(listingUrl)) as CardDef;

    return command.execute({
      realm,
      listing,
    });
  }

  module('catalog index', async function (hooks) {
    hooks.beforeEach(async function () {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${mockCatalogURL}index`,
              format: 'isolated',
            },
          ],
        ],
      });
      await waitForShowcase();
    });

    module('listing fitted', async function () {
      test('after clicking "Remix" button, the ai room is initiated, and prompt is given correctly', async function (assert) {
        await selectTab('Cards');
        await waitForGrid();
        await waitForCardOnGrid(authorListingId, 'Author');
        assert
          .dom(
            `[data-test-cards-grid-item="${authorListingId}"] [data-test-card-title="Author"]`,
          )
          .containsText('Author', '"Author" exist in listing');
        await verifyListingAction(
          assert,
          `[data-test-cards-grid-item="${authorListingId}"] [data-test-catalog-listing-action="Remix"]`,
          'Remix',
          'Remix done! Please suggest two example prompts on how to edit this card.',
          'Test Workspace B',
        );
      });

      test('after clicking "Remix" button, current realm (particularly catalog realm) is never displayed in realm options', async function (assert) {
        await selectTab('Cards');
        await waitForGrid();
        const listingId = mockCatalogURL + 'Listing/author';
        await waitFor(`[data-test-cards-grid-item="${listingId}"]`);
        await waitFor(
          `[data-test-cards-grid-item="${listingId}"] [data-test-card-title="Author"]`,
        );
        await openMenu(
          `[data-test-cards-grid-item="${listingId}"] [data-test-catalog-listing-action="Remix"]`,
        );
        assert
          .dom('[data-test-boxel-dropdown-content] [data-test-boxel-menu-item]')
          .exists({ count: 1 });
        await assertDropdownItem(assert, 'Test Workspace B');
        await assertDropdownItem(assert, 'Test Workspace A', false);
      });

      test('after clicking "Preview" button, the first example card opens up onto the stack', async function (assert) {
        await waitForCardOnGrid(authorListingId, 'Author');
        assert
          .dom(
            `[data-test-card="${authorListingId}"] [data-test-card-title="Author"]`,
          )
          .containsText('Author', '"Author" button exist in listing');
        await click(
          `[data-test-cards-grid-item="${authorListingId}"] [data-test-catalog-listing-fitted-preview-button]`,
        );
        await waitForCardOnStack(`${mockCatalogURL}author/Author/example`);
        assert
          .dom(
            `[data-test-stack-card="${mockCatalogURL}author/Author/example"] [data-test-boxel-card-header-title]`,
          )
          .hasText('Author - Mike Dane');
      });

      test('after clicking "Use Skills" button, the skills is attached to the skill menu', async function (assert) {
        await selectTab('Skills');
        await waitForGrid();
        await waitFor(`[data-test-cards-grid-item="${pirateSkillListingId}"]`);
        await openMenu(
          `[data-test-cards-grid-item="${pirateSkillListingId}"] [data-test-catalog-listing-fitted-add-skills-to-room-button]`,
        );
        await waitForRoom();
        await click('[data-test-skill-menu][data-test-pill-menu-button]');
        await waitFor('[data-test-skill-menu]');
        assert.dom('[data-test-skill-menu]').exists('Skill menu is visible');
        assert
          .dom('[data-test-pill-menu-item]')
          .containsText('Talk Like a Pirate')
          .exists('Skill is attached to the skill menu');
      });

      test('after clicking "carousel" area, the first example card opens up onto the stack', async function (assert) {
        await waitForCardOnGrid(authorListingId, 'Author');
        assert
          .dom(
            `[data-test-card="${authorListingId}"] [data-test-card-title="Author"]`,
          )
          .containsText('Author', '"Author" button exist in listing');
        await click(
          `[data-test-cards-grid-item="${authorListingId}"] [data-test-catalog-listing-fitted-preview-button]`,
        );
        await waitForCardOnStack(`${mockCatalogURL}author/Author/example`);
        assert
          .dom(
            `[data-test-stack-card="${mockCatalogURL}author/Author/example"] [data-test-boxel-card-header-title]`,
          )
          .hasText('Author - Mike Dane');
      });

      test('after clicking "Details" button, the listing details card opens up onto the stack', async function (assert) {
        await click(
          `[data-test-cards-grid-item="${authorListingId}"] [data-test-catalog-listing-fitted-details-button]`,
        );
        await waitForCardOnStack(authorListingId);
        assert
          .dom(
            `[data-test-stack-card="${authorListingId}"] [data-test-boxel-card-header-title]`,
          )
          .hasText('CardListing - Author');
      });

      test('after clicking "info-section" area, the listing details card opens up onto the stack', async function (assert) {
        await click(
          `[data-test-card="${authorListingId}"] [data-test-catalog-listing-fitted-details]`,
        );
        await waitForCardOnStack(authorListingId);
        assert
          .dom(
            `[data-test-stack-card="${authorListingId}"] [data-test-boxel-card-header-title]`,
          )
          .hasText('CardListing - Author');
      });

      test('no arrows and dots appear when one or less image exist', async function (assert) {
        await selectTab('Cards');
        await waitForGrid();
        await waitForCardOnGrid(emptyListingId);
        await hoverToHydrateCard(
          `[data-test-cards-grid-item="${emptyListingId}"]`,
        );

        const carouselNav = document.querySelector(
          `[data-test-cards-grid-item="${emptyListingId}"] .carousel-nav`,
        );
        const carouselDots = document.querySelector(
          `[data-test-cards-grid-item="${emptyListingId}"] .carousel-dots`,
        );

        if (carouselNav && carouselDots) {
          assert
            .dom(
              `[data-test-cards-grid-item="${emptyListingId}"] .carousel-arrow-prev`,
            )
            .exists();
          assert
            .dom(
              `[data-test-cards-grid-item="${emptyListingId}"] .carousel-arrow-next`,
            )
            .exists();
          assert
            .dom(
              `[data-test-cards-grid-item="${emptyListingId}"] .carousel-item-0.is-active`,
            )
            .exists();
        } else {
          assert
            .dom(
              `[data-test-cards-grid-item="${emptyListingId}"] .carousel-nav`,
            )
            .doesNotExist();
          assert
            .dom(
              `[data-test-cards-grid-item="${emptyListingId}"] .carousel-dots`,
            )
            .doesNotExist();
          assert
            .dom(
              `[data-test-cards-grid-item="${emptyListingId}"] .carousel-arrow-prev`,
            )
            .doesNotExist();
          assert
            .dom(
              `[data-test-cards-grid-item="${emptyListingId}"] .carousel-arrow-next`,
            )
            .doesNotExist();
        }
      });

      test('carousel arrows only when multiple images exist and works when triggered', async function (assert) {
        await selectTab('Cards');
        await waitForGrid();
        await waitForCardOnGrid(personListingId);
        await hoverToHydrateCard(
          `[data-test-cards-grid-item="${personListingId}"]`,
        );

        await click(
          `[data-test-cards-grid-item="${personListingId}"] .carousel-arrow-prev`,
        );
        assert
          .dom(
            `[data-test-cards-grid-item="${personListingId}"] .carousel-item-2.is-active`,
          )
          .exists('After clicking prev, last slide (index 2) is active');

        await click(
          `[data-test-cards-grid-item="${personListingId}"] .carousel-arrow-next`,
        );
        assert
          .dom(
            `[data-test-cards-grid-item="${personListingId}"] .carousel-item-0.is-active`,
          )
          .exists('After clicking next, first slide (index 0) is active');
      });

      test('carousel dots appear only when multiple images exist and works when triggered', async function (assert) {
        await selectTab('Cards');
        await waitForGrid();
        await waitForCardOnGrid(personListingId);

        // Hover over the carousel to make controls visible
        await hoverToHydrateCard(
          `[data-test-cards-grid-item="${personListingId}"]`,
        );

        const dots = document.querySelectorAll(
          `[data-test-cards-grid-item="${personListingId}"] .carousel-dot`,
        );

        if (dots.length > 1) {
          await click(dots[1]);
          assert
            .dom(
              `[data-test-cards-grid-item="${personListingId}"] .carousel-item-1.is-active`,
            )
            .exists('After clicking dot 1, slide 1 is active');
        }
      });

      test('preview button appears only when examples exist', async function (assert) {
        await selectTab('Cards');
        await waitForGrid();
        await waitForCardOnGrid(authorListingId);
        await hoverToHydrateCard(
          `[data-test-cards-grid-item="${authorListingId}"]`,
        );
        const previewButton = document.querySelector(
          `[data-test-cards-grid-item="${authorListingId}"] [data-test-catalog-listing-fitted-preview-button]`,
        );

        if (previewButton) {
          assert
            .dom(
              `[data-test-cards-grid-item="${authorListingId}"] [data-test-catalog-listing-fitted-preview-button]`,
            )
            .exists();
        } else {
          assert
            .dom(
              `[data-test-cards-grid-item="${authorListingId}"] [data-test-catalog-listing-fitted-preview-button]`,
            )
            .doesNotExist();
        }
      });
    });

    module('navigation', async function () {
      // showcase tab has different behavior compared to other tabs (apps, cards, fields, skills)
      module('show results as per catalog tab selected', async function () {
        test('switch to showcase tab', async function (assert) {
          await selectTab('Showcase');
          await waitForShowcase();
          assert
            .dom('[data-test-navigation-reset-button="showcase"]')
            .exists(`"Catalog Home" button should exist`)
            .hasClass('is-selected');
          assert.dom('[data-test-boxel-radio-option-id="grid"]').doesNotExist();
        });

        test('switch to apps tab', async function (assert) {
          await selectTab('Apps');
          await waitForGrid();
          assert
            .dom('[data-test-navigation-reset-button="app"]')
            .exists(`"All Apps" button should exist`)
            .hasClass('is-selected');
          assert.dom('[data-test-boxel-radio-option-id="grid"]').exists();
        });
      });

      skip('filters', async function () {
        test('list view is shown if filters are applied', async function (assert) {
          await waitFor('[data-test-filter-search-input]');
          await click('[data-test-filter-search-input]');
          await fillIn('[data-test-filter-search-input]', 'Mortgage');
          // filter by category
          await click('[data-test-filter-list-item="All"]');
          // filter by tag
          let tagPill = document.querySelector('[data-test-tag-list-pill]');
          if (tagPill) {
            await click(tagPill);
          }

          await waitUntil(() => {
            const cards = document.querySelectorAll(
              '[data-test-catalog-list-view]',
            );
            return cards.length === 1;
          });

          assert
            .dom('[data-test-catalog-list-view]')
            .exists(
              'Catalog list view should be visible when filters are applied',
            );
        });

        // TOOD: restore in CS-9083
        skip('should be reset when clicking "Catalog Home" button', async function (assert) {
          await waitFor('[data-test-filter-search-input]');
          await click('[data-test-filter-search-input]');
          await fillIn('[data-test-filter-search-input]', 'Mortgage');
          // filter by category
          await click('[data-test-filter-list-item="All"]');
          // filter by tag
          let tagPill = document.querySelector('[data-test-tag-list-pill]');
          if (tagPill) {
            await click(tagPill);
          }

          assert
            .dom('[data-test-showcase-view]')
            .doesNotExist('Should be in list view after applying filter');

          await click('[data-test-navigation-reset-button="showcase"]');

          assert
            .dom('[data-test-showcase-view]')
            .exists(
              'Should return to showcase view after clicking Catalog Home',
            );

          assert
            .dom('[data-test-filter-search-input]')
            .hasValue('', 'Search input should be cleared');
          assert
            .dom('[data-test-filter-list-item].is-selected')
            .doesNotExist('No category should be selected after reset');
          assert
            .dom('[data-test-tag-list-pill].selected')
            .doesNotExist('No tag should be selected after reset');
        });

        // TODO: restore in CS-9131
        skip('should be reset when clicking "All Apps" button', async function (assert) {
          await selectTab('Apps');
          await waitForGrid();

          await waitFor('[data-test-filter-search-input]');
          await click('[data-test-filter-search-input]');
          await fillIn('[data-test-filter-search-input]', 'Mortgage');
          // filter by category
          await click('[data-test-filter-list-item="All"]');
          // filter by tag
          let tagPill = document.querySelector('[data-test-tag-list-pill]');
          if (tagPill) {
            await click(tagPill);
          }

          await click('[data-test-navigation-reset-button="app"]');
          assert
            .dom('[data-test-showcase-view]')
            .doesNotExist('Should remain in list view, not return to showcase');
          await waitUntil(() => {
            const cards = document.querySelectorAll(
              '[data-test-catalog-list-view]',
            );
            return cards.length === 1;
          });
          assert
            .dom('[data-test-catalog-list-view]')
            .exists('Catalog list view should still be visible');

          assert
            .dom('[data-test-filter-search-input]')
            .hasValue('', 'Search input should be cleared');
          assert
            .dom('[data-test-filter-list-item].is-selected')
            .doesNotExist('No category should be selected after reset');
          assert
            .dom('[data-test-tag-list-pill].selected')
            .doesNotExist('No tag should be selected after reset');
        });

        skip('updates the card count correctly when filtering by a sphere group', async function (assert) {
          await click('[data-test-boxel-filter-list-button="LIFE"]');
          assert
            .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
            .exists({ count: 2 });
        });

        skip('updates the card count correctly when filtering by a category', async function (assert) {
          await click('[data-test-filter-list-item="LIFE"] .dropdown-toggle');
          await click(
            '[data-test-boxel-filter-list-button="Health & Wellness"]',
          );
          assert
            .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
            .exists({ count: 1 });
        });

        skip('updates the card count correctly when filtering by a search input', async function (assert) {
          await click('[data-test-filter-search-input]');
          await fillIn('[data-test-filter-search-input]', 'Mortgage');
          await waitUntil(() => {
            const cards = document.querySelectorAll(
              '[data-test-cards-grid-cards] [data-test-cards-grid-item]',
            );
            return cards.length === 1;
          });
          assert
            .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
            .exists({ count: 1 });
        });

        test('updates the card count correctly when filtering by a single tag', async function (assert) {
          await click(`[data-test-tag-list-pill="${gameTagId}"]`);
          assert
            .dom(`[data-test-tag-list-pill="${gameTagId}"]`)
            .hasClass('selected');
          assert
            .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
            .exists({ count: 1 });
        });

        test('updates the card count correctly when filtering by multiple tags', async function (assert) {
          await click(`[data-test-tag-list-pill="${calculatorTagId}"]`);
          await click(`[data-test-tag-list-pill="${gameTagId}"]`);
          assert
            .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
            .exists({ count: 2 });
        });

        test('updates the card count correctly when multiple filters are applied together', async function (assert) {
          await click('[data-test-boxel-filter-list-button="All"]');
          await click(`[data-test-tag-list-pill="${gameTagId}"]`);
          await click('[data-test-filter-search-input]');
          await fillIn('[data-test-filter-search-input]', 'Blackjack');

          await waitUntil(() => {
            const cards = document.querySelectorAll(
              '[data-test-cards-grid-cards] [data-test-cards-grid-item]',
            );
            return cards.length === 1;
          });

          assert
            .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
            .exists({ count: 1 });
        });

        test('shows zero results when filtering with a non-matching or invalid search input', async function (assert) {
          await click('[data-test-filter-search-input]');
          await fillIn('[data-test-filter-search-input]', 'asdfasdf');
          await waitUntil(() => {
            const cards = document.querySelectorAll('[data-test-no-results]');
            return cards.length === 1;
          });

          assert.dom('[data-test-no-results]').exists();
        });

        test('categories with null sphere fields are excluded from filter list', async function (assert) {
          // Setup: Create a category with null sphere field
          await setupAcceptanceTestRealm({
            realmURL: mockCatalogURL,
            mockMatrixUtils,
            contents: {
              'Category/category-with-null-sphere.json': {
                data: {
                  type: 'card',
                  attributes: {
                    name: 'CategoryWithNullSphere',
                  },
                  relationships: {
                    sphere: {
                      links: {
                        self: null,
                      },
                    },
                  },
                  meta: {
                    adoptsFrom: {
                      module: `${mockCatalogURL}catalog-app/listing/category`,
                      name: 'Category',
                    },
                  },
                },
              },
            },
          });

          await visitOperatorMode({
            stacks: [
              [
                {
                  id: `${mockCatalogURL}`,
                  format: 'isolated',
                },
              ],
            ],
          });

          assert
            .dom(
              '[data-test-boxel-filter-list-button="CategoryWithNullSphere"]',
            )
            .doesNotExist(
              'Category with null sphere should not appear in filter list',
            );
        });
      });
    });
  });

  module('listing isolated', async function (hooks) {
    hooks.beforeEach(async function () {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: authorListingId,
              format: 'isolated',
            },
          ],
        ],
      });
    });

    test('after clicking "Remix" button, current realm (particularly catalog realm) is never displayed in realm options', async function (assert) {
      let selector = `[data-test-card="${authorListingId}"] [data-test-catalog-listing-action="Remix"]`;
      await openMenu(selector, false);
      assert
        .dom('[data-test-boxel-dropdown-content] [data-test-boxel-menu-item]')
        .exists({ count: 1 });
      await assertDropdownItem(assert, 'Test Workspace B');
      await assertDropdownItem(assert, 'Test Workspace A', false);
    });

    test('after clicking "Use Skills" button, the skills is attached to the skill menu', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: pirateSkillListingId,
              format: 'isolated',
            },
          ],
        ],
      });
      await click(
        '[data-test-catalog-listing-embedded-add-skills-to-room-button]',
      );

      await waitFor('[data-room-settled]');
      await click('[data-test-skill-menu][data-test-pill-menu-button]');
      await waitFor('[data-test-skill-menu]');
      assert.dom('[data-test-skill-menu]').exists('Skill menu is visible');
      assert
        .dom('[data-test-pill-menu-item]')
        .containsText('Talk Like a Pirate')
        .exists('Skill is attached to the skill menu');
    });

    test('after clicking "Remix" button, the ai room is initiated, and prompt is given correctly', async function (assert) {
      await verifyListingAction(
        assert,
        `[data-test-card="${authorListingId}"] [data-test-catalog-listing-action="Remix"]`,
        'Remix',
        'Remix done! Please suggest two example prompts on how to edit this card.',
        'Test Workspace B',
        false,
      );
    });

    test('after clicking "Preview" button, the first example card opens up onto the stack', async function (assert) {
      await click(
        `[data-test-card="${authorListingId}"] [data-test-catalog-listing-embedded-preview-button]`,
      );
      await waitForCardOnStack(`${mockCatalogURL}author/Author/example`);
      assert
        .dom(
          `[data-test-stack-card="${mockCatalogURL}author/Author/example"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Author - Mike Dane');
    });

    skip('display of sections when viewing listing details', async function (assert) {
      const homeworkGraderId = `${mockCatalogURL}CardListing/cbe2c79b-60aa-4dca-bc13-82b610e31653`;
      await visitOperatorMode({
        stacks: [
          [
            {
              id: homeworkGraderId,
              format: 'isolated',
            },
          ],
        ],
      });

      //sections exists
      assert
        .dom('[data-test-catalog-listing-embedded-summary-section]')
        .exists();
      assert
        .dom('[data-test-catalog-listing-embedded-license-section]')
        .exists();
      assert
        .dom('[data-test-catalog-listing-embedded-images-section]')
        .exists();
      assert
        .dom('[data-test-catalog-listing-embedded-examples-section]')
        .exists();
      assert
        .dom('[data-test-catalog-listing-embedded-categories-section]')
        .exists();
      assert.dom('[data-test-catalog-listing-embedded-specs-section]').exists();
      assert
        .dom('[data-test-catalog-listing-embedded-skills-section]')
        .exists();

      //content exists
      assert.dom('[data-test-catalog-listing-embedded-images]').exists();
      assert.dom('[data-test-catalog-listing-embedded-examples]').exists();
      assert.dom('[data-test-catalog-listing-embedded-categories]').exists();
      assert.dom('[data-test-catalog-listing-embedded-skills]').exists();

      assert
        .dom('[data-test-catalog-listing-embedded-summary-section]')
        .containsText(
          'An AI-assisted card for grading assignments. Define questions, collect student answers, and trigger grading through a linked AI skill. The system creates an assistant room, sends the assignment and skill, and executes a grading command. The AI returns a letter grade, individual question scores, and markdown-formatted feedback, which are displayed in a styled summary.',
        );
      assert
        .dom('[data-test-catalog-listing-embedded-license-section]')
        .containsText('No License Provided');

      assert
        .dom('[data-test-catalog-listing-embedded-images] li')
        .exists({ count: 3 });

      assert
        .dom('[data-test-catalog-listing-embedded-examples] li')
        .exists({ count: 2 });
      assert
        .dom('[data-test-catalog-listing-embedded-examples] li:first-child')
        .containsText('Basic Arithmetic');
      assert
        .dom('[data-test-catalog-listing-embedded-examples] li:last-child')
        .containsText('US History');
      assert
        .dom('[data-test-catalog-listing-embedded-categories] li')
        .exists({ count: 1 });
      assert
        .dom('[data-test-catalog-listing-embedded-categories] li:first-child')
        .containsText('Education & Courses');
      assert
        .dom('[data-test-catalog-listing-embedded-skills] li')
        .exists({ count: 1 });
      assert
        .dom('[data-test-catalog-listing-embedded-skills] li:first-child')
        .containsText('Grading Skill');
      assert.dom('[data-test-accordion-item="card"]').exists();
      await click('[data-test-accordion-item="card"] button');
      assert
        .dom('[data-test-selected-accordion-item="card"]')
        .containsText('Homework');
    });

    test('remix button does not exist when a listing has no specs', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: emptyListingId,
              format: 'isolated',
            },
          ],
        ],
      });
      assert
        .dom('[data-test-catalog-listing-embedded-specs-section]')
        .containsText('No Specs Provided');
      assert.dom('[data-test-catalog-listing-action="Remix"]').doesNotExist();
    });

    test('remix button does not exist when a skill listing has no skills', async function (assert) {
      const emptySkillListingId = incompleteSkillListingId;
      await visitOperatorMode({
        stacks: [
          [
            {
              id: emptySkillListingId,
              format: 'isolated',
            },
          ],
        ],
      });
      assert
        .dom('[data-test-catalog-listing-embedded-skills-section]')
        .containsText('No Skills Provided');
      assert.dom('[data-test-catalog-listing-action="Remix"]').doesNotExist();
    });

    test('after clicking "Build" button, the ai room is initiated, and prompt is given correctly', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: apiDocumentationStubListingId,
              format: 'isolated',
            },
          ],
        ],
      });
      await verifyListingAction(
        assert,
        `[data-test-card="${apiDocumentationStubListingId}"] [data-test-catalog-listing-action="Build"]`,
        'Build',
        'Generate .gts card definition for "API Documentation" implementing all requirements from the attached listing specification. Then preview the final code in playground panel.',
        'Test Workspace B',
        false,
      );
    });
  });

  module('listing commands', async function (hooks) {
    hooks.beforeEach(async function () {
      // we always run a command inside interact mode
      await visitOperatorMode({
        stacks: [[]],
      });
    });
    module('"build"', async function () {
      test('card listing', async function (assert) {
        await visitOperatorMode({
          stacks: [
            [
              {
                id: apiDocumentationStubListingId,
                format: 'isolated',
              },
            ],
          ],
        });
        await waitFor(`[data-test-card="${apiDocumentationStubListingId}"]`);
        assert
          .dom(
            `[data-test-card="${apiDocumentationStubListingId}"] [data-test-catalog-listing-action="Build"]`,
          )
          .containsText('Build', 'Build button exist in listing');
      });
    });
    module('"create"', async function () {
      test('card listing with single dependency module', async function (assert) {
        const cardId = mockCatalogURL + 'author/Author/example';
        const commandService = getService('command-service');
        const command = new ListingCreateCommand(commandService.commandContext);
        await command.execute({
          openCardId: cardId,
        });
        await visitOperatorMode({
          submode: 'code',
          fileView: 'browser',
          codePath: `${mockCatalogURL}index`,
        });
        await verifySubmode(assert, 'code');
        const instanceFolder = 'CardListing/';
        await openDir(assert, instanceFolder);
        const listingId = await verifyJSONWithUUIDInFolder(
          assert,
          instanceFolder,
        );
        if (listingId) {
          const listing = (await getService('store').get(
            listingId,
          )) as CardListing;
          assert.ok(listing, 'Listing should be created');
          assert.strictEqual(
            listing.specs.length,
            2,
            'Listing should have two specs',
          );
          assert.strictEqual(
            listing.specs.some((spec) => spec.ref.name === 'Author'),
            true,
            'Listing should have an Author spec',
          );
          assert.strictEqual(
            listing.specs.some((spec) => spec.ref.name === 'AuthorCompany'),
            true,
            'Listing should have an AuthorCompany spec',
          );
        }
      });

      test('app listing', async function (assert) {
        const cardId = mockCatalogURL + 'blog-app/BlogApp/example';
        const commandService = getService('command-service');
        const command = new ListingCreateCommand(commandService.commandContext);
        await command.execute({
          openCardId: cardId,
          targetRealm: testDestinationRealmURL,
        });
        await visitOperatorMode({
          submode: 'code',
          fileView: 'browser',
          codePath: `${testDestinationRealmURL}index`,
        });
        await verifySubmode(assert, 'code');
        const instanceFolder = 'AppListing/';
        await openDir(assert, instanceFolder);
        const listingId = await verifyJSONWithUUIDInFolder(
          assert,
          instanceFolder,
        );
        if (listingId) {
          const listing = (await getService('store').get(
            listingId,
          )) as CardListing;
          assert.ok(listing, 'Listing should be created');
          assert.strictEqual(
            listing.specs.length,
            5,
            'Listing should have five specs',
          );
          ['Author', 'AuthorCompany', 'BlogPost', 'BlogApp', 'AppCard'].forEach(
            (specName) => {
              assert.strictEqual(
                listing.specs.some((spec) => spec.ref.name === specName),
                true,
                `Listing should have a ${specName} spec`,
              );
            },
          );
          assert.strictEqual(
            listing.examples.length,
            1,
            'Listing should have one example',
          );
        }
      });
    });
    skip('"use"', async function () {
      skip('card listing', async function (assert) {
        const listingName = 'author';
        const listingId = mockCatalogURL + 'Listing/author.json';
        await executeCommand(
          ListingUseCommand,
          listingId,
          testDestinationRealmURL,
        );
        await visitOperatorMode({
          submode: 'code',
          fileView: 'browser',
          codePath: `${testDestinationRealmURL}index`,
        });
        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );

        let instanceFolder = `${outerFolder}Author/`;
        await openDir(assert, instanceFolder);
        await verifyJSONWithUUIDInFolder(assert, instanceFolder);
      });
    });
    module('"install"', async function () {
      test('card listing', async function (assert) {
        const listingName = 'author';

        await executeCommand(
          ListingInstallCommand,
          authorListingId,
          testDestinationRealmURL,
        );
        await visitOperatorMode({
          submode: 'code',
          fileView: 'browser',
          codePath: `${testDestinationRealmURL}index`,
        });

        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        let gtsFilePath = `${outerFolder}${listingName}/author.gts`;
        await openDir(assert, gtsFilePath);
        await verifyFileInFileTree(assert, gtsFilePath);
        let examplePath = `${outerFolder}${listingName}/Author/example.json`;
        await openDir(assert, examplePath);
        await verifyFileInFileTree(assert, examplePath);
      });

      test('field listing', async function (assert) {
        const listingName = 'contact-link';
        const contactLinkFieldListingCardId = `${mockCatalogURL}FieldListing/contact-link`;

        await executeCommand(
          ListingInstallCommand,
          contactLinkFieldListingCardId,
          testDestinationRealmURL,
        );

        await visitOperatorMode({
          submode: 'code',
          fileView: 'browser',
          codePath: `${testDestinationRealmURL}index`,
        });

        // contact-link-[uuid]/
        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        await openDir(assert, `${outerFolder}fields/contact-link.gts`);
        let gtsFilePath = `${outerFolder}fields/contact-link.gts`;
        await verifyFileInFileTree(assert, gtsFilePath);
      });

      test('skill listing', async function (assert) {
        const listingName = 'pirate-skill';
        const listingId = `${mockCatalogURL}SkillListing/${listingName}`;
        await executeCommand(
          ListingInstallCommand,
          listingId,
          testDestinationRealmURL,
        );
        await visitOperatorMode({
          submode: 'code',
          fileView: 'browser',
          codePath: `${testDestinationRealmURL}index`,
        });

        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        let instancePath = `${outerFolder}Skill/pirate-speak.json`;
        await openDir(assert, instancePath);
        await verifyFileInFileTree(assert, instancePath);
      });
    });
    module('"remix"', async function () {
      test('card listing: installs the card and redirects to code mode with persisted playground selection for first example successfully', async function (assert) {
        const listingName = 'author';
        const listingId = `${mockCatalogURL}Listing/${listingName}`;
        await visitOperatorMode({
          stacks: [[]],
        });
        await executeCommand(
          ListingRemixCommand,
          listingId,
          testDestinationRealmURL,
        );
        await settled();
        await verifySubmode(assert, 'code');
        await toggleFileTree();
        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        let instanceFile = `${outerFolder}${listingName}/Author/example.json`;
        await openDir(assert, instanceFile);
        await verifyFileInFileTree(assert, instanceFile);
        let gtsFilePath = `${outerFolder}${listingName}/author.gts`;
        await openDir(assert, gtsFilePath);
        await verifyFileInFileTree(assert, gtsFilePath);
        await settled();
        assert
          .dom(
            '[data-test-playground-panel] [data-test-boxel-card-header-title]',
          )
          .hasText('Author - Mike Dane');
      });
      test('skill listing: installs the card and redirects to code mode with preview on first skill successfully', async function (assert) {
        const listingName = 'pirate-skill';
        const listingId = `${mockCatalogURL}SkillListing/${listingName}`;
        await executeCommand(
          ListingRemixCommand,
          listingId,
          testDestinationRealmURL,
        );
        await settled();
        await verifySubmode(assert, 'code');
        await toggleFileTree();
        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        let instancePath = `${outerFolder}Skill/pirate-speak.json`;
        await openDir(assert, instancePath);
        await verifyFileInFileTree(assert, instancePath);
        let cardId =
          testDestinationRealmURL + instancePath.replace('.json', '');
        await waitFor('[data-test-card-resource-loaded]');
        assert
          .dom(`[data-test-code-mode-card-renderer-header="${cardId}"]`)
          .exists();
      });
    });

    skip('"use" is successful even if target realm does not have a trailing slash', async function (assert) {
      const listingName = 'author';
      const listingId = mockCatalogURL + 'Listing/author.json';
      await executeCommand(
        ListingUseCommand,
        listingId,
        removeTrailingSlash(testDestinationRealmURL),
      );
      await visitOperatorMode({
        submode: 'code',
        fileView: 'browser',
        codePath: `${testDestinationRealmURL}index`,
      });
      let outerFolder = await verifyFolderWithUUIDInFileTree(
        assert,
        listingName,
      );

      let instanceFolder = `${outerFolder}Author`;
      await openDir(assert, instanceFolder);
      await verifyJSONWithUUIDInFolder(assert, instanceFolder);
    });

    test('"install" is successful even if target realm does not have a trailing slash', async function (assert) {
      const listingName = 'author';
      await executeCommand(
        ListingInstallCommand,
        authorListingId,
        removeTrailingSlash(testDestinationRealmURL),
      );
      await visitOperatorMode({
        submode: 'code',
        fileView: 'browser',
        codePath: `${testDestinationRealmURL}index`,
      });

      let outerFolder = await verifyFolderWithUUIDInFileTree(
        assert,
        listingName,
      );

      let gtsFilePath = `${outerFolder}${listingName}/author.gts`;
      await openDir(assert, gtsFilePath);
      await verifyFileInFileTree(assert, gtsFilePath);
      let instancePath = `${outerFolder}${listingName}/Author/example.json`;

      await openDir(assert, instancePath);
      await verifyFileInFileTree(assert, instancePath);
    });

    test('"remix" is successful even if target realm does not have a trailing slash', async function (assert) {
      const listingName = 'author';
      const listingId = `${mockCatalogURL}Listing/${listingName}`;
      await visitOperatorMode({
        stacks: [[]],
      });
      await executeCommand(
        ListingRemixCommand,
        listingId,
        removeTrailingSlash(testDestinationRealmURL),
      );
      await settled();
      await verifySubmode(assert, 'code');
      await toggleFileTree();
      let outerFolder = await verifyFolderWithUUIDInFileTree(
        assert,
        listingName,
      );
      let instancePath = `${outerFolder}${listingName}/Author/example.json`;
      await openDir(assert, instancePath);
      await verifyFileInFileTree(assert, instancePath);
      let gtsFilePath = `${outerFolder}${listingName}/author.gts`;
      await openDir(assert, gtsFilePath);
      await verifyFileInFileTree(assert, gtsFilePath);
      await settled();
      assert
        .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
        .hasText('Author - Mike Dane');
    });
  });
});

function removeTrailingSlash(url: string): string {
  return url.endsWith('/') && url.length > 1 ? url.slice(0, -1) : url;
}
