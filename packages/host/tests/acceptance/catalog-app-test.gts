import { click, waitFor, waitUntil } from '@ember/test-helpers';

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
module('Acceptance | catalog app tests', function (hooks) {
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
    await setupAcceptanceTestRealm({
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
    await click(`[data-test-boxel-menu-item-text="Test Workspace B"]`);

    await waitFor(`[data-room-settled]`);
    await waitUntil(() => getRoomIds().length > 0);

    const roomId = getRoomIds().pop()!;
    const message = getRoomEvents(roomId).pop()!;

    assert.strictEqual(message.content.msgtype, APP_BOXEL_MESSAGE_MSGTYPE);
    assert.strictEqual(message.content.body, expectedMessage);
  }

  async function verifySubmode(assert: Assert, submode: Submode) {
    assert.dom(`[data-test-submode-switcher=${submode}]`);
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
         * contact-link-[uuid]/contact-link.gts
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
        let gtsFilePath = outerFolder + 'contact-link.gts';
        // contact-link-[uuid]/contact-link.gts
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
        await executeCommand(
          ListingInstallCommand,
          `${catalogRealmURL}SkillListing/${listingName}`,
          testRealm2URL,
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
        // await verifyFileInFielTree(assert, instancePath)
        let gtsFilePath = outerFolder + `${listingName}.gts`;
        await verifyFileInFileTree(assert, gtsFilePath);
        await waitForCodeEditor();
        assert
          .dom(
            '[data-test-playground-panel] [data-test-boxel-card-header-title]',
          )
          .hasText('Author');
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
      // await verifyFileInFielTree(assert, instancePath)
      let gtsFilePath = outerFolder + `${listingName}.gts`;
      await verifyFileInFileTree(assert, gtsFilePath);
      await waitForCodeEditor();
      assert
        .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
        .hasText('Author');
    });
  });
});

function removeTrailingSlash(url: string): string {
  return url.endsWith('/') && url.length > 1 ? url.slice(0, -1) : url;
}
