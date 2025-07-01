import { click, waitFor, waitUntil, fillIn } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { validate as uuidValidate } from 'uuid';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

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
  waitForCodeEditor,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const catalogRealmURL = 'http://localhost:4201/catalog/';
const testRealm2URL = `http://test-realm/test2/`;
const mortgageCalculatorCardId = `${catalogRealmURL}CardListing/4aca5509-09d5-4aec-aeba-1cd26628cca9`;

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

  // open directory if it is not already open and verify its in an open state
  async function openDir(assert: Assert, dirPath: string) {
    let selector = `[data-test-directory="${dirPath}"] .icon`; //.icon is the tag with open state class
    let element = document.querySelector(selector);
    if ((element as HTMLElement)?.classList.contains('closed')) {
      await click(`[data-test-directory="${dirPath}"]`);
    }
    assert.dom(selector).hasClass('open');
    let dirName = element?.getAttribute('data-test-directory');
    return dirName;
  }

  async function verifyFolderInFileTree(assert: Assert, dirName: string) {
    let dirSelector = `[data-test-directory="${dirName}"]`;
    assert.dom(dirSelector).exists();
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
        .dom(`[data-test-card="${listingId}"] [data-test-card-title="Author"]`)
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
        `[data-test-card="${listingId}"] [data-test-catalog-listing-isolated-remix-button]`,
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

    test('after clicking "Preview" button, the example card opens up onto the stack', async function (assert) {
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

    module('clicking home button resets filters', async function () {
      // showcase tab has different behavior compared to other tabs (apps, cards, fields, skills)
      test('when showcase tab is active - catalog grid/list view is shown when filters are applied', async function (assert) {
        // Apply some filters on the catalog
        // ** filter by search
        await waitFor('[data-test-filter-search-input]');
        await click('[data-test-filter-search-input]');
        await fillIn('[data-test-filter-search-input]', 'Mortgage');

        // verify you looking at catalog grid view / list view
        assert
          .dom('[data-test-catalog-list-view]')
          .exists(
            'Catalog list view should be visible when filters are applied',
          );
      });

      test('when showcase tab is active - filters reset when clicking "Catalog Home" button', async function (assert) {
        // Apply some filters first
        await waitFor('[data-test-filter-search-input]');
        await click('[data-test-filter-search-input]');
        await fillIn('[data-test-filter-search-input]', 'Mortgage');
        // ** filter by category
        await click('[data-test-filter-list-item="All"]');
        // ** filter by tag
        let tagPill = document.querySelector('[data-test-tag-list-pill]');
        if (tagPill) {
          await click(tagPill);
        }

        // Verify we're in catalog grid / list view (not showcase view)
        assert
          .dom('[data-test-showcase-view]')
          .doesNotExist('Should be in list view after applying filter');

        //step 4: click on the home button
        await click('[data-test-navigation-reset-button="showcase"]');

        // Verify you looking at showcase view
        assert
          .dom('[data-test-showcase-view]')
          .exists('Should return to showcase view after clicking Catalog Home');

        // Verify filters are reset - make sure you reset category/tag/search state
        assert
          .dom('[data-test-filter-search-input]')
          .hasValue('', 'Search input should be cleared');
        // Category and tag filters should be unselected
        assert
          .dom('[data-test-filter-list-item].is-selected')
          .doesNotExist('No category should be selected after reset');
        assert
          .dom('[data-test-tag-list-pill].selected')
          .doesNotExist('No tag should be selected after reset');
      });

      test('when apps tab is active - filters reset when clicking "All Apps" button', async function (assert) {
        // Switch to Apps tab
        await click('[data-tab-label="Apps"]');
        assert
          .dom('[data-tab-label="Apps"]')
          .hasClass('active', 'Apps tab should be active');

        //  Apply some filters first
        // ** filter by search
        await waitFor('[data-test-filter-search-input]');
        await click('[data-test-filter-search-input]');
        await fillIn('[data-test-filter-search-input]', 'Test');
        // ** filter by category
        await click('[data-test-filter-list-item="All"]');
        // ** filter by tag
        let tagPill = document.querySelector('[data-test-tag-list-pill]');
        if (tagPill) {
          await click(tagPill);
        }

        // click on the home button
        await click('[data-test-navigation-reset-button="app"]');
        // Verify you only looking at catalog grid view / list view
        assert
          .dom('[data-test-showcase-view]')
          .doesNotExist('Should remain in list view, not return to showcase');
        assert
          .dom('[data-test-catalog-list-view]')
          .exists('Catalog list view should still be visible');
        // Verify filters are reset - make sure you reset category/tag/search state
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

    test('after clicking "Remix" button, the ai room is initiated, and prompt is given correctly', async function (assert) {
      await verifyButtonAction(
        assert,
        `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-isolated-remix-button]`,
        'Remix',
        'I would like to remix this Mortgage Calculator under the following realm: http://test-realm/test/',
      );
    });

    test('after clicking "Preview" button, the example card opens up onto the stack', async function (assert) {
      await click(
        `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-isolated-preview-button]`,
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
  });

  module('commands', async function (hooks) {
    hooks.beforeEach(async function () {
      // we always run a command inside interact mode
      await visitOperatorMode({
        stacks: [[]],
      });
    });
    module('"use"', async function () {
      test('card listing', async function (assert) {
        const listingName = 'author';
        const listingId = testRealmURL + 'Listing/author.json';
        await executeCommand(ListingUseCommand, listingId, testRealm2URL);
        await visitOperatorMode({
          submode: 'code',
          fileView: 'browser',
          codePath: `${testRealm2URL}index`,
        });
        await waitForCodeEditor();
        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        if (outerFolder) {
          await openDir(assert, outerFolder);
        }

        let instanceFolder = outerFolder + 'Author' + '/';
        await verifyFolderInFileTree(assert, instanceFolder);
        if (instanceFolder) {
          await openDir(assert, instanceFolder);
        }
        await verifyJSONWithUUIDInFolder(assert, instanceFolder);
      });
    });
    module('"install"', async function () {
      test('card listing ', async function (assert) {
        // Given a card listing named "mortgage-calculator":
        /*
         * mortgage-calculator/mortgage-calculator.gts <- spec points to this
         * mortgage-calculator/MortgageCalculator/example.json <- listing points to this
         */

        // When I install the listing into my selected realm, it should be:
        /*
         *  mortgage-calculator-[uuid]/
         *  mortgage-calculator-[uuid]/mortgage-calculator.gts
         *  mortgage-calculator-[uuid]/MortgageCalculator/[uuid].json
         */

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
        await waitForCodeEditor();

        // mortgage-calculator-[uuid]/
        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        if (outerFolder) {
          await openDir(assert, outerFolder);
        }
        // mortgage-calculator-[uuid]/mortgage-calculator.gts
        let gtsFilePath = outerFolder + 'mortgage-calculator.gts';
        await verifyFileInFileTree(assert, gtsFilePath);
        // mortgage-calculator-[uuid]/MortgageCalculator/example.json
        let instanceFolder = outerFolder + 'MortgageCalculator' + '/';
        await verifyFolderInFileTree(assert, instanceFolder);
        if (instanceFolder) {
          await openDir(assert, instanceFolder);
        }
        await verifyJSONWithUUIDInFolder(assert, instanceFolder);
      });

      test('field listing', async function (assert) {
        // Given a field listing named "contact-link":
        /*
         * fields/contact-link.gts <- spec points to this
         */
        // When I install the listing into my selected realm, it should be:
        /*
         * contact-link-[uuid]/fields/contact-link.gts
         */

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

        await waitForCodeEditor();

        // contact-link-[uuid]/
        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        if (outerFolder) {
          await openDir(assert, outerFolder);
        }
        await openDir(assert, `${outerFolder}fields/`);
        let gtsFilePath = `${outerFolder}fields/contact-link.gts`;
        // contact-link-[uuid]/fields/contact-link.gts
        await verifyFileInFileTree(assert, gtsFilePath);
      });

      test('skill listing', async function (assert) {
        // Given a skill listing named "talk-like-a-pirate":
        /*
         * SkillListing/talk-like-a-pirate.json <- listing points to this
         */
        // When I install the listing into my selected realm, it should be:
        /*
         * talk-like-a-pirate-[uuid]/Skill/[uuid].json
         */
        const listingName = 'talk-like-a-pirate';
        const listingId = `${catalogRealmURL}SkillListing/${listingName}`;
        await executeCommand(ListingInstallCommand, listingId, testRealm2URL);
        await visitOperatorMode({
          submode: 'code',
          fileView: 'browser',
          codePath: `${testRealm2URL}index`,
        });
        await waitForCodeEditor();

        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        if (outerFolder) {
          await openDir(assert, outerFolder);
        }
        let instanceFolder = outerFolder + 'Skill' + '/';
        await verifyFolderInFileTree(assert, instanceFolder);
        if (instanceFolder) {
          await openDir(assert, instanceFolder);
        }
        await verifyJSONWithUUIDInFolder(assert, instanceFolder);
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
        await waitForCodeEditor();
        await verifySubmode(assert, 'code');
        await toggleFileTree();
        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        let instanceFolder = outerFolder + 'Author/';
        await verifyFolderInFileTree(assert, instanceFolder);
        let gtsFilePath = outerFolder + `${listingName}.gts`;
        await verifyFileInFileTree(assert, gtsFilePath);
        await waitForCodeEditor();
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
        await waitForCodeEditor();
        await verifySubmode(assert, 'code');
        await toggleFileTree();
        let outerFolder = await verifyFolderWithUUIDInFileTree(
          assert,
          listingName,
        );
        if (outerFolder) {
          await openDir(assert, outerFolder);
        }
        let instanceFolder = outerFolder + 'Skill' + '/';
        await verifyFolderInFileTree(assert, instanceFolder);
        if (instanceFolder) {
          await openDir(assert, instanceFolder);
        }
        let filePath = await verifyJSONWithUUIDInFolder(assert, instanceFolder);
        let cardId = testRealm2URL + filePath;
        let headerId = cardId.replace('.json', '');
        await waitFor('[data-test-card-resource-loaded]');
        assert
          .dom(`[data-test-code-mode-card-renderer-header="${headerId}"]`)
          .exists();
      });
    });

    test('"use" is successful even if target realm does not have a trailing slash', async function (assert) {
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
      await waitForCodeEditor();
      let outerFolder = await verifyFolderWithUUIDInFileTree(
        assert,
        listingName,
      );
      if (outerFolder) {
        await openDir(assert, outerFolder);
      }

      let instanceFolder = outerFolder + 'Author' + '/';
      await verifyFolderInFileTree(assert, instanceFolder);
      if (instanceFolder) {
        await openDir(assert, instanceFolder);
      }
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
      await waitForCodeEditor();

      // mortgage-calculator-[uuid]/
      let outerFolder = await verifyFolderWithUUIDInFileTree(
        assert,
        listingName,
      );
      if (outerFolder) {
        await openDir(assert, outerFolder);
      }
      // mortgage-calculator-[uuid]/mortgage-calculator.gts
      let gtsFilePath = outerFolder + 'mortgage-calculator.gts';
      await verifyFileInFileTree(assert, gtsFilePath);
      // mortgage-calculator-[uuid]/MortgageCalculator/example.json
      let instanceFolder = outerFolder + 'MortgageCalculator' + '/';
      await verifyFolderInFileTree(assert, instanceFolder);
      if (instanceFolder) {
        await openDir(assert, instanceFolder);
      }
      await verifyJSONWithUUIDInFolder(assert, instanceFolder);
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
      await waitForCodeEditor();
      await verifySubmode(assert, 'code');
      await toggleFileTree();
      let outerFolder = await verifyFolderWithUUIDInFileTree(
        assert,
        listingName,
      );
      let instanceFolder = outerFolder + 'Author/';
      await verifyFolderInFileTree(assert, instanceFolder);
      let gtsFilePath = outerFolder + `${listingName}.gts`;
      await verifyFileInFileTree(assert, gtsFilePath);
      await waitForCodeEditor();
      assert
        .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
        .hasText('Author - Mike Dane');
    });
  });
});

function removeTrailingSlash(url: string): string {
  return url.endsWith('/') && url.length > 1 ? url.slice(0, -1) : url;
}
