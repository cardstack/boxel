import {
  click,
  waitFor,
  waitUntil,
  fillIn,
  settled,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, skip, test } from 'qunit';

import { validate as uuidValidate } from 'uuid';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import ListingCreateCommand from '@cardstack/host/commands/listing-create';
import ListingInstallCommand from '@cardstack/host/commands/listing-install';
import ListingRemixCommand from '@cardstack/host/commands/listing-remix';
import ListingUseCommand from '@cardstack/host/commands/listing-use';

import { type Submode } from '@cardstack/host/components/submode-switcher';

import { CardDef } from 'https://cardstack.com/base/card-api';

import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupUserSubscription,
  setupAcceptanceTestRealm,
  visitOperatorMode,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

import type { CardListing } from '@cardstack/catalog/listing/listing';

const catalogRealmURL = 'http://localhost:4201/catalog/';
const testRealm2URL = `http://test-realm/test2/`;
const mortgageCalculatorCardId = `${catalogRealmURL}CardListing/4aca5509-09d5-4aec-aeba-1cd26628cca9`;
const leafletMapCardId = `${catalogRealmURL}CardListing/552da558-5642-4541-89b0-28622db3bc84`;
const calculatorTagId = `${catalogRealmURL}Tag/c1fe433a-b3df-41f4-bdcf-d98686ee42d7`;
const gameTagId = `${catalogRealmURL}Tag/51de249c-516a-4c4d-bd88-76e88274c483`;

const authorCardSource = `
  import { field, contains, CardDef } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class Author extends CardDef {
    static displayName = 'Author';
    @field firstName = contains(StringField);
    @field lastName = contains(StringField);
    @field title = contains(StringField, {
      computeVia: function (this: Author) {
        return [this.firstName, this.lastName].filter(Boolean).join(' ');
      },
    });
  }
`;

let matrixRoomId: string;
module('Acceptance | Catalog | catalog app tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL, testRealm2URL],
  });

  let { getRoomIds, getRoomEvents, createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    matrixRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription(matrixRoomId);
    // this setup test realm is pretending to be a mock catalog
    await setupAcceptanceTestRealm({
      realmURL: testRealmURL,
      mockMatrixUtils,
      contents: {
        'author/author.gts': authorCardSource,
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
                module: '../author',
                name: 'Author',
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
                module: '../author/author',
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
        'Listing/author.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Author',
              name: 'Author',
              summary: 'Author',
              images: null,
              description: null,
              thumbnailURL: null,
            },
            relationships: {
              'specs.0': {
                links: {
                  self: '../Spec/author',
                },
              },
              publisher: {
                links: {
                  self: null,
                },
              },
              'categories.0': {
                links: {
                  self: null,
                },
              },
              'tags.0': {
                links: {
                  self: null,
                },
              },
              license: {
                links: {
                  self: null,
                },
              },
              'examples.0': {
                links: {
                  self: '../author/Author/example',
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
        'Listing/empty.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Empty',
              name: 'Empty',
              summary: null,
              images: null,
              description: null,
              thumbnailURL: null,
            },
            relationships: {
              'skills.0': {
                links: {
                  self: `${catalogRealmURL}Skill/homework-grader`,
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
        'Listing/empty-skill.json': {
          data: {
            type: 'card',
            attributes: {
              title: 'Empty',
              name: 'Empty',
              summary: 'Empty',
              images: null,
              description: null,
              thumbnailURL: null,
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}catalog-app/listing/listing`,
                name: 'SkillListing',
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
                  self: './Listing/author',
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
      realmURL: testRealm2URL,
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

  async function verifyButtonAction(
    assert: Assert,
    buttonSelector: string,
    expectedText: string,
    expectedMessage: string,
  ) {
    await waitFor(buttonSelector);
    assert.dom(buttonSelector).containsText(expectedText);
    await click(buttonSelector);
    await click(`[data-test-boxel-menu-item-text="Cardstack Catalog"]`);

    await waitFor(`[data-room-settled]`);
    await waitUntil(() => getRoomIds().length > 0);

    const roomId = getRoomIds().pop()!;
    const message = getRoomEvents(roomId).pop()!;

    assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    assert.strictEqual(message.content.body, expectedMessage);
  }

  async function verifySubmode(assert: Assert, submode: Submode) {
    assert.dom(`[data-test-submode-switcher=${submode}]`).exists();
  }

  async function toggleFileTree() {
    await click('[data-test-file-browser-toggle]');
  }

  //path can be directory/ or directory/file.gts
  async function openDir(assert: Assert, path: string) {
    const isFilePath = !path.endsWith('/');
    const pathToProcess = isFilePath
      ? path.substring(0, path.lastIndexOf('/'))
      : path;

    const pathSegments = pathToProcess
      .split('/')
      .filter((segment) => segment.length > 0);

    let currentPath = '';

    for (const segment of pathSegments) {
      currentPath = currentPath ? `${currentPath}${segment}/` : `${segment}/`;

      let selector = `[data-test-directory="${currentPath}"] .icon`;
      let element = document.querySelector(selector);

      if ((element as HTMLElement)?.classList.contains('closed')) {
        await click(`[data-test-directory="${currentPath}"]`);
      }

      assert.dom(selector).hasClass('open');
    }

    let finalElement = document.querySelector(
      `[data-test-directory="${pathToProcess}"] .icon`,
    );
    let dirName = finalElement?.getAttribute('data-test-directory');
    return dirName;
  }

  async function verifyFolderWithUUIDInFileTree(
    assert: Assert,
    dirNamePrefix: string, //name without UUID
  ) {
    const element = document.querySelector(
      `[data-test-directory^="${dirNamePrefix}-"]`,
    );
    const dirName = element?.getAttribute('data-test-directory');
    const uuid =
      dirName?.replace(`${dirNamePrefix}-`, '').replace('/', '') || '';
    assert.ok(uuidValidate(uuid), 'uuid is a valid uuid');
    return dirName;
  }

  async function verifyFileInFileTree(assert: Assert, fileName: string) {
    const fileSelector = `[data-test-file="${fileName}"]`;
    assert.dom(fileSelector).exists();
  }

  async function verifyJSONWithUUIDInFolder(assert: Assert, dirPath: string) {
    const fileSelector = `[data-test-file^="${dirPath}"]`;
    assert.dom(fileSelector).exists();
    const element = document.querySelector(fileSelector);
    const filePath = element?.getAttribute('data-test-file');
    let parts = filePath?.split('/');
    if (parts) {
      let fileName = parts[parts.length - 1];
      let uuid = fileName.replace(`.json`, '');
      assert.ok(uuidValidate(uuid), 'uuid is a valid uuid');
      return filePath;
    } else {
      throw new Error(
        'file name shape not as expected when checking for [uuid].[extension]',
      );
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

  module('catalog', async function (hooks) {
    hooks.beforeEach(async function () {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${catalogRealmURL}`,
              format: 'isolated',
            },
          ],
        ],
      });

      await waitFor('.catalog-content');
      await waitFor('.showcase-center-div');
    });

    module('listing card', async function () {
      test('after clicking "Remix" button, the ai room is initiated, and prompt is given correctly', async function (assert) {
        await waitFor(
          `[data-test-card="${mortgageCalculatorCardId}"] [data-test-card-title="Mortgage Calculator"]`,
        );
        assert
          .dom(
            `[data-test-card="${mortgageCalculatorCardId}"] [data-test-card-title="Mortgage Calculator"]`,
          )
          .containsText(
            'Mortgage Calculator',
            '"Mortgage Calculator" button exist in listing',
          );
        await verifyButtonAction(
          assert,
          `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-fitted-remix-button]`,
          'Remix',
          'I would like to remix this Mortgage Calculator under the following realm: http://test-realm/test/',
        );
      });

      test('after clicking "Remix" button, current realm (particularly catalog realm) is never displayed in realm options', async function (assert) {
        // testing fitted
        await visitOperatorMode({
          stacks: [
            [
              {
                id: `${testRealmURL}index`,
                format: 'isolated',
              },
            ],
          ],
        });

        const listingId = testRealmURL + 'Listing/author';

        await waitFor(
          `[data-test-card="${listingId}"] [data-test-card-title="Author"]`,
        );
        assert
          .dom(
            `[data-test-card="${listingId}"] [data-test-card-title="Author"]`,
          )
          .containsText('Author', '"Author" button exist in listing');
        await click(
          `[data-test-card="${listingId}"] [data-test-catalog-listing-fitted-remix-button]`,
        );
        assert
          .dom('[data-test-boxel-dropdown-content] [data-test-boxel-menu-item]')
          .exists({ count: 1 });
        assert
          .dom(
            '[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="Cardstack Catalog"]',
          )
          .doesNotExist();
        assert
          .dom(
            '[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="Test Workspace B"]',
          )
          .exists();

        // testing isolated
        await visitOperatorMode({
          stacks: [
            [
              {
                id: listingId,
                format: 'isolated',
              },
            ],
          ],
        });
        await click(
          `[data-test-card="${listingId}"] [data-test-catalog-listing-embedded-remix-button]`,
        );
        assert
          .dom('[data-test-boxel-dropdown-content] [data-test-boxel-menu-item]')
          .exists({ count: 1 });
        assert
          .dom(
            '[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="Cardstack Catalog"]',
          )
          .doesNotExist();
        assert
          .dom(
            '[data-test-boxel-dropdown-content] [data-test-boxel-menu-item-text="Test Workspace B"]',
          )
          .exists();
      });

      test('after clicking "Preview" button, the first example card opens up onto the stack', async function (assert) {
        await waitFor(
          `[data-test-card="${mortgageCalculatorCardId}"] [data-test-card-title="Mortgage Calculator"]`,
        );
        assert
          .dom(
            `[data-test-card="${mortgageCalculatorCardId}"] [data-test-card-title="Mortgage Calculator"]`,
          )
          .containsText(
            'Mortgage Calculator',
            '"Mortgage Calculator" button exist in listing',
          );
        await click(
          `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-fitted-preview-button]`,
        );
        assert
          .dom(
            `[data-test-stack-card="${catalogRealmURL}mortgage-calculator/MortgageCalculator/example"] [data-test-boxel-card-header-title]`,
          )
          .exists();
        assert
          .dom(
            `[data-test-stack-card="${catalogRealmURL}mortgage-calculator/MortgageCalculator/example"] [data-test-boxel-card-header-title]`,
          )
          .hasText('Mortgage Calculator');
      });

      test('after clicking "carousel" area, the first example card opens up onto the stack', async function (assert) {
        await waitFor(
          `[data-test-card="${mortgageCalculatorCardId}"] [data-test-card-title="Mortgage Calculator"]`,
        );
        assert
          .dom(
            `[data-test-card="${mortgageCalculatorCardId}"] [data-test-card-title="Mortgage Calculator"]`,
          )
          .containsText(
            'Mortgage Calculator',
            '"Mortgage Calculator" button exist in listing',
          );
        await click(
          `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-fitted-preview-button]`,
        );
        assert
          .dom(
            `[data-test-stack-card="${catalogRealmURL}mortgage-calculator/MortgageCalculator/example"] [data-test-boxel-card-header-title]`,
          )
          .exists();
        assert
          .dom(
            `[data-test-stack-card="${catalogRealmURL}mortgage-calculator/MortgageCalculator/example"] [data-test-boxel-card-header-title]`,
          )
          .hasText('Mortgage Calculator');
      });

      test('after clicking "Details" button, the listing details card opens up onto the stack', async function (assert) {
        await click(
          `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-fitted-details-button]`,
        );
        assert
          .dom(
            `[data-test-stack-card="${mortgageCalculatorCardId}"] [data-test-boxel-card-header-title]`,
          )
          .exists();
        assert
          .dom(
            `[data-test-stack-card="${mortgageCalculatorCardId}"] [data-test-boxel-card-header-title]`,
          )
          .hasText('CardListing - Mortgage Calculator');
      });

      test('after clicking "info-section" area, the listing details card opens up onto the stack', async function (assert) {
        await click(
          `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-fitted-details]`,
        );
        assert
          .dom(
            `[data-test-stack-card="${mortgageCalculatorCardId}"] [data-test-boxel-card-header-title]`,
          )
          .exists();
        assert
          .dom(
            `[data-test-stack-card="${mortgageCalculatorCardId}"] [data-test-boxel-card-header-title]`,
          )
          .hasText('CardListing - Mortgage Calculator');
      });

      test('no arrows and dots appear when one image exist', async function (assert) {
        await waitFor(
          `[data-test-card="${leafletMapCardId}"] [data-test-card-title="Leaflet Map"]`,
        );

        const carouselNav = document.querySelector(
          `[data-test-card="${leafletMapCardId}"] .carousel-nav`,
        );
        const carouselDots = document.querySelector(
          `[data-test-card="${leafletMapCardId}"] .carousel-dots`,
        );

        if (carouselNav && carouselDots) {
          assert
            .dom(`[data-test-card="${leafletMapCardId}"] .carousel-arrow-prev`)
            .exists();
          assert
            .dom(`[data-test-card="${leafletMapCardId}"] .carousel-arrow-next`)
            .exists();
          assert
            .dom(
              `[data-test-card="${leafletMapCardId}"] .carousel-item-0.is-active`,
            )
            .exists();
        } else {
          assert
            .dom(`[data-test-card="${leafletMapCardId}"] .carousel-nav`)
            .doesNotExist();
          assert
            .dom(`[data-test-card="${leafletMapCardId}"] .carousel-dots`)
            .doesNotExist();
          assert
            .dom(`[data-test-card="${leafletMapCardId}"] .carousel-arrow-prev`)
            .doesNotExist();
          assert
            .dom(`[data-test-card="${leafletMapCardId}"] .carousel-arrow-next`)
            .doesNotExist();
        }
      });

      // leaflet map has 3 slides, so index 2 is the last slide
      test('carousel arrows and dots appear only when multiple images exist and works when triggered', async function (assert) {
        await click(
          `[data-test-card="${leafletMapCardId}"] .carousel-arrow-prev`,
        );
        assert
          .dom(
            `[data-test-card="${leafletMapCardId}"] .carousel-item-2.is-active`,
          )
          .exists('After clicking prev, last slide (index 2) is active');

        await click(
          `[data-test-card="${leafletMapCardId}"] .carousel-arrow-next`,
        );
        assert
          .dom(
            `[data-test-card="${leafletMapCardId}"] .carousel-item-0.is-active`,
          )
          .exists('After clicking next, first slide (index 0) is active');

        const dots = document.querySelectorAll(
          `[data-test-card="${leafletMapCardId}"] .carousel-dot`,
        );

        if (dots.length > 1) {
          await click(dots[1]);
          assert
            .dom(
              `[data-test-card="${leafletMapCardId}"] .carousel-item-1.is-active`,
            )
            .exists('After clicking dot 1, slide 1 is active');
        }
      });

      test('preview button appears only when examples exist', async function (assert) {
        await waitFor(
          `[data-test-card="${mortgageCalculatorCardId}"] [data-test-card-title="Mortgage Calculator"]`,
        );

        const previewButton = document.querySelector(
          `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-fitted-preview-button]`,
        );

        if (previewButton) {
          assert
            .dom(
              `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-fitted-preview-button]`,
            )
            .exists();
        } else {
          assert
            .dom(
              `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-fitted-preview-button]`,
            )
            .doesNotExist();
        }
      });
    });

    module('tab navigation', async function () {
      // showcase tab has different behavior compared to other tabs (apps, cards, fields, skills)
      module('show results as per catalog tab selected', async function () {
        test('switch to showcase tab', async function (assert) {
          await click('[data-tab-label="Showcase"]');
          assert
            .dom('[data-test-navigation-reset-button="showcase"]')
            .exists(`"Catalog Home" button should exist`)
            .hasClass('is-selected');
          assert.dom('[data-test-boxel-radio-option-id="grid"]').doesNotExist();
        });

        test('switch to apps tab', async function (assert) {
          await click('[data-tab-label="Apps"]');
          assert
            .dom('[data-test-navigation-reset-button="app"]')
            .exists(`"All Apps" button should exist`)
            .hasClass('is-selected');
          assert.dom('[data-test-boxel-radio-option-id="grid"]').exists();
        });
      });
    });

    module('filters', async function () {
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
          .exists('Should return to showcase view after clicking Catalog Home');

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
        await click('[data-tab-label="Apps"]');
        assert
          .dom('[data-tab-label="Apps"]')
          .hasClass('active', 'Apps tab should be active');

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

      test('updates the card count correctly when filtering by a sphere group', async function (assert) {
        await click('[data-test-boxel-filter-list-button="LIFE"]');
        assert
          .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
          .exists({ count: 12 });
      });

      test('updates the card count correctly when filtering by a category', async function (assert) {
        await click('[data-test-filter-list-item="LIFE"] .dropdown-toggle');
        await click('[data-test-boxel-filter-list-button="Health & Wellness"]');
        assert
          .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
          .exists({ count: 2 });
      });

      test('updates the card count correctly when filtering by a search input', async function (assert) {
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
          .exists({ count: 2 });
      });

      test('updates the card count correctly when filtering by multiple tags', async function (assert) {
        await click(`[data-test-tag-list-pill="${calculatorTagId}"]`);
        await click(`[data-test-tag-list-pill="${gameTagId}"]`);
        assert
          .dom('[data-test-cards-grid-cards] [data-test-cards-grid-item]')
          .exists({ count: 3 });
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
          realmURL: testRealmURL,
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
                    module: `${catalogRealmURL}catalog-app/listing/category`,
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
                id: `${catalogRealmURL}`,
                format: 'isolated',
              },
            ],
          ],
        });

        assert
          .dom('[data-test-boxel-filter-list-button="CategoryWithNullSphere"]')
          .doesNotExist(
            'Category with null sphere should not appear in filter list',
          );
      });
    });
  });

  module('listing isolated', async function (hooks) {
    hooks.beforeEach(async function () {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: mortgageCalculatorCardId,
              format: 'isolated',
            },
          ],
        ],
      });
    });

    test('after clicking "Test Skills" button, the skill is attached to the skill menu', async function (assert) {
      const skillListingId = `${catalogRealmURL}SkillListing/talk-like-a-pirate`;
      await visitOperatorMode({
        stacks: [
          [
            {
              id: skillListingId,
              format: 'isolated',
            },
          ],
        ],
      });

      await click(
        '[data-test-catalog-listing-embedded-add-skill-to-room-button]',
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
      await verifyButtonAction(
        assert,
        `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-embedded-remix-button]`,
        'Remix',
        'I would like to remix this Mortgage Calculator under the following realm: http://test-realm/test/',
      );
    });

    test('after clicking "Preview" button, the first example card opens up onto the stack', async function (assert) {
      await click(
        `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-embedded-preview-button]`,
      );
      assert
        .dom(
          `[data-test-stack-card="${catalogRealmURL}mortgage-calculator/MortgageCalculator/example"] [data-test-boxel-card-header-title]`,
        )
        .exists();
      assert
        .dom(
          `[data-test-stack-card="${catalogRealmURL}mortgage-calculator/MortgageCalculator/example"] [data-test-boxel-card-header-title]`,
        )
        .hasText('Mortgage Calculator');
    });

    test('display of sections when viewing listing details', async function (assert) {
      const homeworkGraderId = `${catalogRealmURL}CardListing/cbe2c79b-60aa-4dca-bc13-82b610e31653`;
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

    test('remix button is disabled when remix a listing has no examples and no specs', async function (assert) {
      const emptyListingId = `${testRealmURL}Listing/empty`;
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
        .dom('[data-test-catalog-listing-embedded-summary-section]')
        .containsText('No Summary Provided');

      assert
        .dom('[data-test-catalog-listing-embedded-examples-section]')
        .containsText('No Examples Provided');

      assert
        .dom('[data-test-catalog-listing-embedded-specs-section]')
        .containsText('No Specs Provided');

      assert
        .dom('[data-test-catalog-listing-embedded-remix-button]')
        .isDisabled();
    });

    test('remix button is disabled when remix a skill listing has no skills', async function (assert) {
      const emptySkillListingId = `${testRealmURL}Listing/empty-skill`;
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

      assert
        .dom('[data-test-catalog-listing-embedded-remix-button]')
        .isDisabled(
          'Remix button should be disabled when skill listing has no skills',
        );
    });
  });

  module('commands', async function (hooks) {
    hooks.beforeEach(async function () {
      // we always run a command inside interact mode
      await visitOperatorMode({
        stacks: [[]],
      });
    });
    module('"create"', async function () {
      test('card listing', async function (assert) {
        const cardId = testRealmURL + 'author/Author/example';
        const commandService = getService('command-service');
        const command = new ListingCreateCommand(commandService.commandContext);
        await command.execute({
          openCardId: cardId,
        });
        await visitOperatorMode({
          submode: 'code',
          fileView: 'browser',
          codePath: `${testRealmURL}index`,
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
            1,
            'Listing should have one spec',
          );
          assert.strictEqual(
            listing.specs[0].ref.name,
            'Author',
            'Listing should have an Author spec',
          );
          assert.strictEqual(
            listing.examples.length,
            1,
            'Listing should have one example',
          );
        }
      });
    });
    module('"use"', async function () {
      skip('card listing', async function (assert) {
        const listingName = 'author';
        const listingId = testRealmURL + 'Listing/author.json';
        await executeCommand(ListingUseCommand, listingId, testRealm2URL);
        await visitOperatorMode({
          submode: 'code',
          fileView: 'browser',
          codePath: `${testRealm2URL}index`,
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
        const listingName = 'mortgage-calculator';

        await executeCommand(
          ListingInstallCommand,
          mortgageCalculatorCardId,
          testRealm2URL,
        );
        await visitOperatorMode({
          submode: 'code',
          fileView: 'browser',
          codePath: `${testRealm2URL}index`,
        });

        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        let gtsFilePath = `${outerFolder}${listingName}/mortgage-calculator.gts`;
        await openDir(assert, gtsFilePath);
        await verifyFileInFileTree(assert, gtsFilePath);
        let examplePath = `${outerFolder}mortgage-calculator/MortgageCalculator/example.json`;
        await openDir(assert, examplePath);
        await verifyFileInFileTree(assert, examplePath);
      });

      test('field listing', async function (assert) {
        const listingName = 'contact-link';
        const contactLinkFieldListingCardId = `${catalogRealmURL}FieldListing/fb9494c4-0d61-4d2d-a6c0-7b16ca40b42b`;

        await executeCommand(
          ListingInstallCommand,
          contactLinkFieldListingCardId,
          testRealm2URL,
        );

        await visitOperatorMode({
          submode: 'code',
          fileView: 'browser',
          codePath: `${testRealm2URL}index`,
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
        const listingName = 'talk-like-a-pirate';
        const listingId = `${catalogRealmURL}SkillListing/${listingName}`;
        await executeCommand(ListingInstallCommand, listingId, testRealm2URL);
        await visitOperatorMode({
          submode: 'code',
          fileView: 'browser',
          codePath: `${testRealm2URL}index`,
        });

        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        let instancePath = `${outerFolder}Skill/skill-pirate-speak.json`;
        await openDir(assert, instancePath);
        await verifyFileInFileTree(assert, instancePath);
      });
    });
    module('"remix"', async function () {
      test('card listing: installs the card and redirects to code mode with persisted playground selection for first example successfully', async function (assert) {
        const listingName = 'author';
        const listingId = `${testRealmURL}Listing/${listingName}`;
        await visitOperatorMode({
          stacks: [[]],
        });
        await executeCommand(ListingRemixCommand, listingId, testRealm2URL);
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
        const listingName = 'talk-like-a-pirate';
        const listingId = `${catalogRealmURL}SkillListing/${listingName}`;
        await executeCommand(ListingRemixCommand, listingId, testRealm2URL);
        await settled();
        await verifySubmode(assert, 'code');
        await toggleFileTree();
        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        let instancePath = `${outerFolder}Skill/skill-pirate-speak.json`;
        await openDir(assert, instancePath);
        await verifyFileInFileTree(assert, instancePath);
        let cardId = testRealm2URL + instancePath.replace('.json', '');
        await waitFor('[data-test-card-resource-loaded]');
        assert
          .dom(`[data-test-code-mode-card-renderer-header="${cardId}"]`)
          .exists();
      });
    });

    skip('"use" is successful even if target realm does not have a trailing slash', async function (assert) {
      const listingName = 'author';
      const listingId = testRealmURL + 'Listing/author.json';
      await executeCommand(
        ListingUseCommand,
        listingId,
        removeTrailingSlash(testRealm2URL),
      );
      await visitOperatorMode({
        submode: 'code',
        fileView: 'browser',
        codePath: `${testRealm2URL}index`,
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
      const listingName = 'mortgage-calculator';
      await executeCommand(
        ListingInstallCommand,
        mortgageCalculatorCardId,
        removeTrailingSlash(testRealm2URL),
      );
      await visitOperatorMode({
        submode: 'code',
        fileView: 'browser',
        codePath: `${testRealm2URL}index`,
      });

      let outerFolder = await verifyFolderWithUUIDInFileTree(
        assert,
        listingName,
      );

      let gtsFilePath = `${outerFolder}${listingName}/mortgage-calculator.gts`;
      await openDir(assert, gtsFilePath);
      await verifyFileInFileTree(assert, gtsFilePath);
      let instancePath = `${outerFolder}${listingName}/MortgageCalculator/example.json`;

      await openDir(assert, instancePath);
      await verifyFileInFileTree(assert, instancePath);
    });

    test('"remix" is successful even if target realm does not have a trailing slash', async function (assert) {
      const listingName = 'author';
      const listingId = `${testRealmURL}Listing/${listingName}`;
      await visitOperatorMode({
        stacks: [[]],
      });
      await executeCommand(
        ListingRemixCommand,
        listingId,
        removeTrailingSlash(testRealm2URL),
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
