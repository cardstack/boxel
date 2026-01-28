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

import { ensureTrailingSlash } from '@cardstack/runtime-common';

import ListingCreateCommand from '@cardstack/host/commands/listing-create';
import ListingInstallCommand from '@cardstack/host/commands/listing-install';
import ListingRemixCommand from '@cardstack/host/commands/listing-remix';
import ListingUseCommand from '@cardstack/host/commands/listing-use';

import ENV from '@cardstack/host/config/environment';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL as mockCatalogURL,
  setupAuthEndpoints,
  setupUserSubscription,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  verifySubmode,
  toggleFileTree,
  openDir,
  verifyFolderWithUUIDInFileTree,
  verifyFileInFileTree,
  verifyJSONWithUUIDInFolder,
  setupRealmServerEndpoints,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

import type { CardListing } from '@cardstack/catalog/listing/listing';

const catalogRealmURL = ensureTrailingSlash(ENV.resolvedCatalogRealmURL);
const testDestinationRealmURL = `http://test-realm/test2/`;

//listing
const authorListingId = `${mockCatalogURL}Listing/author`;
const personListingId = `${mockCatalogURL}Listing/person`;
const emptyListingId = `${mockCatalogURL}Listing/empty`;
const pirateSkillListingId = `${mockCatalogURL}SkillListing/pirate-skill`;
const incompleteSkillListingId = `${mockCatalogURL}Listing/incomplete-skill`;
const apiDocumentationStubListingId = `${mockCatalogURL}Listing/api-documentation-stub`;
const themeListingId = `${mockCatalogURL}ThemeListing/cardstack-theme`;
const blogPostListingId = `${mockCatalogURL}Listing/blog-post`;
//license
const mitLicenseId = `${mockCatalogURL}License/mit`;
//category
const writingCategoryId = `${mockCatalogURL}Category/writing`;
//publisher
const publisherId = `${mockCatalogURL}Publisher/boxel-publisher`;

//skills
const pirateSkillId = `${mockCatalogURL}Skill/pirate-speak`;

//tags
const calculatorTagId = `${mockCatalogURL}Tag/c1fe433a-b3df-41f4-bdcf-d98686ee42d7`;
const gameTagId = `${mockCatalogURL}Tag/51de249c-516a-4c4d-bd88-76e88274c483`;
const stubTagId = `${mockCatalogURL}Tag/stub`;

//specs
const authorSpecId = `${mockCatalogURL}Spec/author`;
const unknownSpecId = `${mockCatalogURL}Spec/unknown-no-type`;

//examples
const authorExampleId = `${mockCatalogURL}author/Author/example`;
const authorCompanyExampleId = `${mockCatalogURL}author/AuthorCompany/example`;

const authorCardSource = `
  import { field, contains, linksTo, CardDef } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';


  export class AuthorCompany extends CardDef {
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
    @field cardTitle = contains(StringField, {
      computeVia: function (this: Author) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
    @field company = linksTo(AuthorCompany);
  }
`;

const blogPostCardSource = `
  import { field, contains, CardDef, linksTo } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  import { Author } from '../author/author';

  export class BlogPost extends CardDef {
    static displayName = 'BlogPost';
    @field cardTitle = contains(StringField);
    @field content = contains(StringField);
    @field author = linksTo(Author);
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
    @field cardTitle = contains(StringField);
    @field posts = containsMany(BlogPost);
  }
`;

const cardWithUnrecognisedImports = `
  import { field, CardDef, linksTo } from 'https://cardstack.com/base/card-api';
  // External import that should be ignored by sanitizeDeps
  import { Chess as _ChessJS } from 'https://cdn.jsdelivr.net/npm/chess.js/+esm';
  import { Author } from './author/author';

  export class UnrecognisedImports extends CardDef {
    static displayName = 'Unrecognised Imports';
    @field author = linksTo(Author);
  }
`;

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
    createAndJoinRoom({
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
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'author/author.gts': authorCardSource,
        'blog-post/blog-post.gts': blogPostCardSource,
        'fields/contact-link.gts': contactLinkFieldSource,
        'app-card.gts': appCardSource,
        'blog-app/blog-app.gts': blogAppCardSource,
        'card-with-unrecognised-imports.gts': cardWithUnrecognisedImports,
        'theme/theme-example.json': {
          data: {
            type: 'card',
            attributes: {
              cssVariables:
                ':root { --background: #ffffff; } .dark { --background: #000000; }',
              cssImports: [],
              cardInfo: {
                cardTitle: 'Sample Theme',
                cardDescription: 'A sample theme for testing remix.',
                cardThumbnailURL: null,
                notes: null,
              },
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'Theme',
              },
            },
          },
        },
        'ThemeListing/cardstack-theme.json': {
          data: {
            meta: {
              adoptsFrom: {
                name: 'ThemeListing',
                module: `${catalogRealmURL}catalog-app/listing/listing`,
              },
            },
            type: 'card',
            attributes: {
              name: 'Cardstack Theme',
              images: [],
              summary: 'Cardstack base theme listing.',
            },
            relationships: {
              specs: {
                links: {
                  self: null,
                },
              },
              skills: {
                links: {
                  self: null,
                },
              },
              tags: {
                links: {
                  self: null,
                },
              },
              license: {
                links: {
                  self: null,
                },
              },
              publisher: {
                links: {
                  self: null,
                },
              },
              'examples.0': {
                links: {
                  self: '../theme/theme-example',
                },
              },
              categories: {
                links: {
                  self: null,
                },
              },
            },
          },
        },
        'author/Author/example.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Mike',
              lastName: 'Dane',
              summary: 'Author',
            },
            relationships: {
              company: {
                links: {
                  self: authorCompanyExampleId,
                },
              },
            },
            meta: {
              adoptsFrom: {
                module: `${mockCatalogURL}author/author`,
                name: 'Author',
              },
            },
          },
        },
        'author/AuthorCompany/example.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Cardstack Labs',
              address: '123 Main St',
              city: 'Portland',
              state: 'OR',
              zip: '97205',
            },
            meta: {
              adoptsFrom: {
                module: `${mockCatalogURL}author/author`,
                name: 'AuthorCompany',
              },
            },
          },
        },
        'UnrecognisedImports/example.json': {
          data: {
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: {
                module: `${mockCatalogURL}card-with-unrecognised-imports`,
                name: 'UnrecognisedImports',
              },
            },
          },
        },
        'blog-post/BlogPost/example.json': {
          data: {
            type: 'card',
            attributes: {
              cardTitle: 'Blog Post',
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
              cardTitle: 'My Blog App',
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
              readMe: 'This is the author spec readme',
              ref: {
                name: 'Author',
                module: `${mockCatalogURL}author/author`,
              },
            },
            specType: 'card',
            containedExamples: [],
            cardTitle: 'Author',
            cardDescription: 'Spec for Author card',
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
            cardTitle: 'ContactLink',
            cardDescription: 'Spec for ContactLink field',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/spec',
                name: 'Spec',
              },
            },
          },
        },
        'Spec/unknown-no-type.json': {
          data: {
            type: 'card',
            attributes: {
              readMe: 'Spec without specType to trigger unknown grouping',
              ref: {
                name: 'UnknownNoType',
                module: `${mockCatalogURL}unknown/unknown-no-type`,
              },
            },
            // intentionally omitting specType so it falls into 'unknown'
            containedExamples: [],
            cardTitle: 'UnknownNoType',
            cardDescription: 'Spec lacking specType',
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
              cardTitle: 'Author', // hardcoding title otherwise test will be flaky when waiting for a computed
              summary: 'A card for representing an author.',
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
              'categories.0': {
                links: {
                  self: writingCategoryId,
                },
              },
              license: {
                links: {
                  self: mitLicenseId,
                },
              },
              publisher: {
                links: {
                  self: publisherId,
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
        'Listing/blog-post.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Blog Post',
              cardTitle: 'Blog Post',
            },
            relationships: {
              'examples.0': {
                links: {
                  self: `${mockCatalogURL}blog-post/BlogPost/example`,
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
        'Publisher/boxel-publisher.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Boxel Publishing',
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/publisher`,
                name: 'Publisher',
              },
            },
          },
        },
        'License/mit.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'MIT License',
              content: 'MIT License',
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/license`,
                name: 'License',
              },
            },
          },
        },
        'Listing/person.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Person',
              cardTitle: 'Person', // hardcoding title otherwise test will be flaky when waiting for a computed
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
        'Listing/unknown-only.json': {
          data: {
            type: 'card',
            attributes: {},
            relationships: {
              'specs.0': {
                links: {
                  self: unknownSpecId,
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
              cardTitle: 'Blog App', // hardcoding title otherwise test will be flaky when waiting for a computed
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
              cardTitle: 'Empty', // hardcoding title otherwise test will be flaky when waiting for a computed
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
              cardTitle: 'Pirate Skill', // hardcoding title otherwise test will be flaky when waiting for a computed
            },
            relationships: {
              'skills.0': {
                links: {
                  self: pirateSkillId,
                },
              },
            },
            'categories.0': {
              links: {
                self: writingCategoryId,
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
        'Category/writing.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Writing',
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/category`,
                name: 'Category',
              },
            },
          },
        },
        'Listing/incomplete-skill.json': {
          data: {
            type: 'card',
            attributes: {
              name: 'Incomplete Skill',
              cardTitle: 'Incomplete Skill', // hardcoding title otherwise test will be flaky when waiting for a computed
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
              cardTitle: 'Talk Like a Pirate',
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
              cardTitle: 'API Documentation', // hardcoding title otherwise test will be flaky when waiting for a computed
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
              cardTitle: 'Contact Link', // hardcoding title otherwise test will be flaky when waiting for a computed
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
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
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

  module('catalog index', function (hooks) {
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

    module('listing fitted', function () {
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

    module('navigation', function () {
      // showcase tab has different behavior compared to other tabs (apps, cards, fields, skills)
      module('show results as per catalog tab selected', function () {
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
              ...SYSTEM_CARD_FIXTURE_CONTENTS,
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

  module('listing isolated', function (hooks) {
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

    test('listing card shows more options dropdown in stack item', async function (assert) {
      let triggerSelector = `[data-test-stack-card="${authorListingId}"] [data-test-more-options-button]`;
      await waitFor(triggerSelector);
      await click(triggerSelector);
      await waitFor('[data-test-boxel-dropdown-content]');
      assert
        .dom('[data-test-boxel-dropdown-content] [data-test-boxel-menu-item]')
        .exists('Listing card dropdown renders menu items');
      assert
        .dom(
          `[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="Generate Example with AI"]`,
        )
        .exists('Generate Example with AI action is present');
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

    test('display of sections when viewing listing details', async function (assert) {
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

      assert
        .dom('[data-test-catalog-listing-embedded-summary-section]')
        .containsText('A card for representing an author');

      // Publisher (rendered in header)
      assert
        .dom('[data-test-app-listing-header-publisher]')
        .containsText('By Boxel Publishing');

      assert
        .dom('[data-test-catalog-listing-embedded-license-section]')
        .containsText('MIT License');

      assert
        .dom('[data-test-catalog-listing-embedded-images-section]')
        .exists({ count: 1 });
      assert
        .dom('[data-test-catalog-listing-embedded-examples-section]')
        .exists();

      assert
        .dom('[data-test-catalog-listing-embedded-examples] li')
        .exists({ count: 1 });
      assert.dom('[data-test-catalog-listing-embedded-tags-section]').exists();

      //TODO: this assertion is wrong, there is some issue with rendering of specType
      // also the format of the isolated has some weird css behaviour like Examples title running out of position
      // assert
      //   .dom('[data-test-catalog-listing-embedded-specs-section]')
      //   .containsText('Unknown');

      assert.dom('[data-test-catalog-listing-embedded-specs-section]').exists();

      assert
        .dom('[data-test-catalog-listing-embedded-tags-section]')
        .containsText('Calculator');
      assert
        .dom('[data-test-catalog-listing-embedded-categories-section]')
        .containsText('Writing');
    });

    test('listing with spec that has a missing specType groups it under unknown (accordion assertion)', async function (assert) {
      const unknownListingId = `${mockCatalogURL}Listing/unknown-only`;
      await visitOperatorMode({
        stacks: [
          [
            {
              id: unknownListingId,
              format: 'isolated',
            },
          ],
        ],
      });

      assert
        .dom(
          '[data-test-catalog-listing-embedded-specs-section] [data-test-accordion-item]',
        )
        .exists({ count: 1 });
      assert
        .dom(
          '[data-test-catalog-listing-embedded-specs-section] [data-test-accordion-item="unknown"]',
        )
        .exists('Unknown group item exists');

      assert
        .dom(
          '[data-test-catalog-listing-embedded-specs-section] [data-test-accordion-item="unknown"]',
        )
        .containsText('unknown (1)');
    });

    test('unknown-only listing shows all default fallback texts', async function (assert) {
      const unknownListingId = `${mockCatalogURL}Listing/unknown-only`;
      await visitOperatorMode({
        stacks: [
          [
            {
              id: unknownListingId,
              format: 'isolated',
            },
          ],
        ],
      });

      assert
        .dom('[data-test-catalog-listing-embedded-summary-section]')
        .containsText('No Summary Provided');
      assert
        .dom('[data-test-catalog-listing-embedded-license-section]')
        .containsText('No License Provided');
      assert
        .dom('[data-test-catalog-listing-embedded-images-section]')
        .containsText('No Images Provided');
      assert
        .dom('[data-test-catalog-listing-embedded-examples-section]')
        .containsText('No Examples Provided');
      assert
        .dom('[data-test-catalog-listing-embedded-categories-section]')
        .containsText('No Categories Provided');
      assert
        .dom('[data-test-catalog-listing-embedded-tags-section]')
        .containsText('No Tags Provided');
      assert
        .dom('[data-test-catalog-listing-embedded-skills-section]')
        .containsText('No Skills Provided');
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

  module('listing commands', function (hooks) {
    hooks.beforeEach(async function () {
      // we always run a command inside interact mode
      await visitOperatorMode({
        stacks: [[]],
      });
    });
    module('"build"', function () {
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
    module('"create"', function (hooks) {
      // Mock proxy LLM endpoint only for create-related tests
      setupRealmServerEndpoints(hooks, [
        {
          route: '_request-forward',
          getResponse: async (req: Request) => {
            try {
              const body = await req.json();
              if (
                body.url === 'https://openrouter.ai/api/v1/chat/completions'
              ) {
                let requestBody: any = {};
                try {
                  requestBody = body.requestBody
                    ? JSON.parse(body.requestBody)
                    : {};
                } catch {
                  // ignore parse failure
                }
                const messages = requestBody.messages || [];
                const system: string =
                  messages.find((m: any) => m.role === 'system')?.content || '';
                const user: string =
                  messages.find((m: any) => m.role === 'user')?.content || '';
                const systemLower = system.toLowerCase();
                let content: string | undefined;
                if (
                  systemLower.includes(
                    'respond only with one token: card, app, skill, or theme',
                  )
                ) {
                  // Heuristic moved from production code into test mock:
                  // If the serialized example or prompts reference an App construct
                  // (e.g. AppCard base class, module paths with /App/, or a name ending with App)
                  // then classify as 'app'. If it references Skill, classify as 'skill'.
                  const userLower = user.toLowerCase();
                  if (
                    /(appcard|blogapp|"appcard"|\.appcard|name: 'appcard')/.test(
                      userLower,
                    )
                  ) {
                    content = 'app';
                  } else if (
                    /(cssvariables|css imports|theme card|themecreator|theme listing)/.test(
                      userLower,
                    )
                  ) {
                    content = 'theme';
                  } else if (/skill/.test(userLower)) {
                    content = 'skill';
                  } else {
                    content = 'card';
                  }
                } else if (systemLower.includes('catalog listing title')) {
                  content = 'Mock Listing Title';
                } else if (systemLower.includes('spec-style summary')) {
                  content = 'Mock listing summary sentence.';
                } else if (
                  systemLower.includes("boxel's sample data assistant")
                ) {
                  content = JSON.stringify({
                    examples: [
                      {
                        label: 'Generated field value',
                        url: 'https://example.com/contact',
                      },
                    ],
                  });
                } else if (systemLower.includes('representing tag')) {
                  // Deterministic tag selection
                  content = JSON.stringify([calculatorTagId]);
                } else if (systemLower.includes('representing category')) {
                  // Deterministic category selection
                  content = JSON.stringify([writingCategoryId]);
                } else if (systemLower.includes('representing license')) {
                  // Deterministic license selection
                  content = JSON.stringify([mitLicenseId]);
                }

                return new Response(
                  JSON.stringify({
                    choices: [
                      {
                        message: {
                          content,
                        },
                      },
                    ],
                  }),
                  {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                  },
                );
              }
            } catch (e) {
              return new Response(
                JSON.stringify({
                  error: 'mock forward error',
                  details: (e as Error).message,
                }),
                {
                  status: 500,
                  headers: { 'Content-Type': 'application/json' },
                },
              );
            }
            return new Response(
              JSON.stringify({ error: 'Unknown proxy path' }),
              {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          },
        },
      ]);
      test('card listing with single dependency module', async function (assert) {
        const cardId = mockCatalogURL + 'author/Author/example';
        const commandService = getService('command-service');
        const command = new ListingCreateCommand(commandService.commandContext);
        const result = await command.execute({
          openCardId: cardId,
          codeRef: {
            module: `${mockCatalogURL}author/author.gts`,
            name: 'Author',
          },
          targetRealm: mockCatalogURL,
        });
        const interim = result?.listing as any;
        assert.ok(interim, 'Interim listing exists');
        assert.strictEqual((interim as any).name, 'Mock Listing Title');
        assert.strictEqual(
          (interim as any).summary,
          'Mock listing summary sentence.',
        );
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
          // Assertions for AI generated fields coming from proxy mock
          assert.strictEqual(
            (listing as any).name,
            'Mock Listing Title',
            'Listing name populated from autoPatchName mock response',
          );
          assert.strictEqual(
            (listing as any).summary,
            'Mock listing summary sentence.',
            'Listing summary populated from autoPatchSummary mock response',
          );
          assert.strictEqual(
            listing.specs.length,
            2,
            'Listing should have two specs',
          );
          assert.true(
            listing.specs.some((spec) => spec.ref.name === 'Author'),
            'Listing should have an Author spec',
          );
          assert.true(
            listing.specs.some((spec) => spec.ref.name === 'AuthorCompany'),
            'Listing should have an AuthorCompany spec',
          );
          // Deterministic autoLink assertions from proxy mock
          assert.ok((listing as any).license, 'License linked');
          assert.strictEqual(
            (listing as any).license.id,
            mitLicenseId,
            'License id matches mitLicenseId',
          );
          assert.ok(Array.isArray((listing as any).tags), 'Tags array exists');
          assert.true(
            (listing as any).tags.some((t: any) => t.id === calculatorTagId),
            'Contains calculator tag id',
          );
          assert.ok(
            Array.isArray((listing as any).categories),
            'Categories array exists',
          );
          assert.true(
            (listing as any).categories.some(
              (c: any) => c.id === writingCategoryId,
            ),
            'Contains writing category id',
          );
        }
      });

      test('listing will only create specs with recognised imports from realms it can read from', async function (assert) {
        const cardId = mockCatalogURL + 'UnrecognisedImports/example';
        const commandService = getService('command-service');
        const command = new ListingCreateCommand(commandService.commandContext);
        await command.execute({
          openCardId: cardId,
          codeRef: {
            module: `${mockCatalogURL}card-with-unrecognised-imports.gts`,
            name: 'UnrecognisedImports',
          },
          targetRealm: mockCatalogURL,
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
          assert.true(
            listing.specs.every(
              (spec) =>
                spec.ref.module != 'https://cdn.jsdelivr.net/npm/chess.js/+esm',
            ),
            'Listing should does not have unrecognised import',
          );
        }
      });

      test('app listing', async function (assert) {
        const cardId = mockCatalogURL + 'blog-app/BlogApp/example';
        const commandService = getService('command-service');
        const command = new ListingCreateCommand(commandService.commandContext);
        const createResult = await command.execute({
          openCardId: cardId,
          codeRef: {
            module: `${mockCatalogURL}blog-app/blog-app.gts`,
            name: 'BlogApp',
          },
          targetRealm: testDestinationRealmURL,
        });
        // Assert store-level (in-memory) results BEFORE navigating to code mode
        let immediateListing = createResult?.listing as any;
        assert.ok(immediateListing, 'Listing object returned from command');
        assert.strictEqual(
          immediateListing.name,
          'Mock Listing Title',
          'Immediate listing has patched name before persistence',
        );
        assert.strictEqual(
          immediateListing.summary,
          'Mock listing summary sentence.',
          'Immediate listing has patched summary before persistence',
        );
        assert.ok(
          immediateListing.license,
          'Immediate listing has linked license before persistence',
        );
        assert.strictEqual(
          immediateListing.license?.id,
          mitLicenseId,
          'Immediate listing license id matches mitLicenseId',
        );
        // Lint: avoid logical expression inside assertion
        assert.ok(
          Array.isArray(immediateListing.tags),
          'Immediate listing tags is an array before persistence',
        );
        if (Array.isArray(immediateListing.tags)) {
          assert.ok(
            immediateListing.tags.length > 0,
            'Immediate listing has linked tag(s) before persistence',
          );
        }
        assert.true(
          immediateListing.tags.some((t: any) => t.id === calculatorTagId),
          'Immediate listing includes calculator tag id',
        );
        assert.ok(
          Array.isArray(immediateListing.categories),
          'Immediate listing categories is an array before persistence',
        );
        if (Array.isArray(immediateListing.categories)) {
          assert.ok(
            immediateListing.categories.length > 0,
            'Immediate listing has linked category(ies) before persistence',
          );
        }
        assert.true(
          immediateListing.categories.some(
            (c: any) => c.id === writingCategoryId,
          ),
          'Immediate listing includes writing category id',
        );
        assert.ok(
          Array.isArray(immediateListing.specs),
          'Immediate listing specs is an array before persistence',
        );
        if (Array.isArray(immediateListing.specs)) {
          assert.strictEqual(
            immediateListing.specs.length,
            5,
            'Immediate listing has expected number of specs before persistence',
          );
        }
        assert.ok(
          Array.isArray(immediateListing.examples),
          'Immediate listing examples is an array before persistence',
        );
        if (Array.isArray(immediateListing.examples)) {
          assert.strictEqual(
            immediateListing.examples.length,
            1,
            'Immediate listing has expected examples before persistence',
          );
        }
        // Header/title: wait for persisted id (listing.id) then assert via stack card selector
        const persistedId = immediateListing.id;
        assert.ok(persistedId, 'Immediate listing has a persisted id');
        await waitForCardOnStack(persistedId);
        assert
          .dom(
            `[data-test-stack-card="${persistedId}"] [data-test-boxel-card-header-title]`,
          )
          .containsText(
            'Mock Listing Title',
            'Isolated view shows patched name (persisted id)',
          );
        // Summary section
        assert
          .dom('[data-test-catalog-listing-embedded-summary-section]')
          .containsText(
            'Mock listing summary sentence.',
            'Isolated view shows patched summary',
          );

        // License section should not show fallback text
        assert
          .dom('[data-test-catalog-listing-embedded-license-section]')
          .doesNotContainText(
            'No License Provided',
            'License section populated (autoLinkLicense)',
          );

        // Tags section
        assert
          .dom('[data-test-catalog-listing-embedded-tags-section]')
          .doesNotContainText(
            'No Tags Provided',
            'Tags section populated (autoLinkTag)',
          );

        // Categories section
        assert
          .dom('[data-test-catalog-listing-embedded-categories-section]')
          .doesNotContainText(
            'No Categories Provided',
            'Categories section populated (autoLinkCategory)',
          );
        await visitOperatorMode({
          submode: 'code',
          fileView: 'browser',
          codePath: `${testDestinationRealmURL}index`,
        });
        await verifySubmode(assert, 'code');
        const instanceFolder = 'AppListing/';
        await openDir(assert, instanceFolder);
        const persistedListingId = await verifyJSONWithUUIDInFolder(
          assert,
          instanceFolder,
        );
        if (persistedListingId) {
          const listing = (await getService('store').get(
            persistedListingId,
          )) as CardListing;
          assert.ok(listing, 'Listing should be created');
          assert.strictEqual(
            listing.specs.length,
            5,
            'Listing should have five specs',
          );
          ['Author', 'AuthorCompany', 'BlogPost', 'BlogApp', 'AppCard'].forEach(
            (specName) => {
              assert.true(
                listing.specs.some((spec) => spec.ref.name === specName),
                `Listing should have a ${specName} spec`,
              );
            },
          );
          assert.strictEqual(
            listing.examples.length,
            1,
            'Listing should have one example',
          );

          // Assert autoPatch fields populated (from proxy mock responses)
          assert.strictEqual(
            (listing as any).name,
            'Mock Listing Title',
            'autoPatchName populated listing.name',
          );
          assert.strictEqual(
            (listing as any).summary,
            'Mock listing summary sentence.',
            'autoPatchSummary populated listing.summary',
          );

          // Basic object-level sanity for autoLink fields (they should exist, may be arrays)
          assert.ok(
            (listing as any).license,
            'autoLinkLicense populated listing.license',
          );
          assert.strictEqual(
            (listing as any).license?.id,
            mitLicenseId,
            'Persisted listing license id matches mitLicenseId',
          );
          assert.ok(
            Array.isArray((listing as any).tags),
            'autoLinkTag populated listing.tags array',
          );
          if (Array.isArray((listing as any).tags)) {
            assert.ok(
              (listing as any).tags.length > 0,
              'autoLinkTag populated listing.tags with at least one tag',
            );
          }
          assert.true(
            (listing as any).tags.some((t: any) => t.id === calculatorTagId),
            'Persisted listing includes calculator tag id',
          );
          assert.ok(
            Array.isArray((listing as any).categories),
            'autoLinkCategory populated listing.categories array',
          );
          if (Array.isArray((listing as any).categories)) {
            assert.ok(
              (listing as any).categories.length > 0,
              'autoLinkCategory populated listing.categories with at least one category',
            );
          }
          assert.true(
            (listing as any).categories.some(
              (c: any) => c.id === writingCategoryId,
            ),
            'Persisted listing includes writing category id',
          );
        }
      });

      test('after create command, listing card opens on stack in interact mode', async function (assert) {
        const cardId = mockCatalogURL + 'author/Author/example';
        const commandService = getService('command-service');
        const command = new ListingCreateCommand(commandService.commandContext);

        let r = await command.execute({
          openCardId: cardId,
          codeRef: {
            module: `${mockCatalogURL}author/author.gts`,
            name: 'Author',
          },
          targetRealm: mockCatalogURL,
        });

        await verifySubmode(assert, 'interact');
        const listing = r?.listing as any;
        const createdId = listing.id;
        assert.ok(createdId, 'Listing id should be present');
        await waitForCardOnStack(createdId);
        assert
          .dom(`[data-test-stack-card="${createdId}"]`)
          .exists(
            'Created listing card (by persisted id) is displayed on stack after command execution',
          );
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
    module('"install"', function () {
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

      test('listing installs relationships of examples and its modules', async function (assert) {
        const listingName = 'blog-post';

        await executeCommand(
          ListingInstallCommand,
          blogPostListingId,
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
        let blogPostModulePath = `${outerFolder}blog-post/blog-post.gts`;
        let authorModulePath = `${outerFolder}author/author.gts`;
        await openDir(assert, blogPostModulePath);
        await verifyFileInFileTree(assert, blogPostModulePath);
        await openDir(assert, authorModulePath);
        await verifyFileInFileTree(assert, authorModulePath);

        let blogPostExamplePath = `${outerFolder}blog-post/BlogPost/example.json`;
        let authorExamplePath = `${outerFolder}author/Author/example.json`;
        let authorCompanyExamplePath = `${outerFolder}author/AuthorCompany/example.json`;
        await openDir(assert, blogPostExamplePath);
        await verifyFileInFileTree(assert, blogPostExamplePath);
        await openDir(assert, authorExamplePath);
        await verifyFileInFileTree(assert, authorExamplePath);
        await openDir(assert, authorCompanyExamplePath);
        await verifyFileInFileTree(assert, authorCompanyExamplePath);
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
    module('"remix"', function () {
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
      test('theme listing: installs the theme example and redirects to code mode successfully', async function (assert) {
        const listingName = 'cardstack-theme';
        await executeCommand(
          ListingRemixCommand,
          themeListingId,
          testDestinationRealmURL,
        );
        await settled();
        await verifySubmode(assert, 'code');
        await toggleFileTree();
        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        let instancePath = `${outerFolder}theme/theme-example.json`;
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
