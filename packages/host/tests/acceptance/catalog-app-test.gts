import { click, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { validate as uuidValidate } from 'uuid';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import ListingInstallCommand from '@cardstack/host/commands/listing-install';
import ListingRemixCommand from '@cardstack/host/commands/listing-remix';
import ListingUseCommand from '@cardstack/host/commands/listing-use';

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
    buttonSelector: string,
    expectedText: string,
    expectedMessage: string,
    assert: Assert,
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

  async function verifyInstanceExists(
    targetRealm: string,
    targetDirPrefix: string,
    dirName: string,
    assert: Assert,
  ) {
    await visitOperatorMode({
      submode: 'code',
      fileView: 'browser',
      codePath: `${targetRealm}index`,
    });
    await waitForCodeEditor();

    await waitFor(`[data-test-directory^="${targetDirPrefix}"]`);
    const element = document.querySelector(
      `[data-test-directory^="${targetDirPrefix}"]`,
    );
    const fullPath = element?.getAttribute('data-test-directory');
    await click(`[data-test-directory="${fullPath}"]`);

    assert.dom(`[data-test-directory="${fullPath}"] .icon`).hasClass('open');

    const instancePath = `${fullPath}${dirName}/`;
    await waitFor(`[data-test-directory="${instancePath}"]`);
    await click(`[data-test-directory="${instancePath}"]`);

    assert
      .dom(`[data-test-directory="${instancePath}"] .icon`)
      .hasClass('open');

    await waitFor(
      `[data-test-file^="${instancePath}"][data-test-file$=".json"]`,
    );
    await click(`[data-test-file^="${instancePath}"][data-test-file$=".json"]`);
    assert
      .dom(`[data-test-file^="${instancePath}"][data-test-file$=".json"]`)
      .exists()
      .hasClass('selected');
  }

  async function verifyFileExists(
    targetRealm: string,
    targetDirPrefix: string,
    dirName: string,
    assert: Assert,
  ) {
    await visitOperatorMode({
      submode: 'code',
      fileView: 'browser',
      codePath: `${targetRealm}index`,
    });
    await waitForCodeEditor();

    await waitFor(`[data-test-directory^="${targetDirPrefix}"]`);
    const element = document.querySelector(
      `[data-test-directory^="${targetDirPrefix}"]`,
    );
    const fullPath = element?.getAttribute('data-test-directory');
    await click(`[data-test-directory="${fullPath}"]`);

    const filePath = `${fullPath}${dirName}`;
    await waitFor(`[data-test-file="${filePath}"]`);
    await click(`[data-test-file="${filePath}"]`);
    assert
      .dom(`[data-test-file="${filePath}"]`)
      .exists('file exists')
      .hasClass('selected', 'file is selected');
  }

  async function verifyFolderWithUUID(
    targetRealm: string,
    targetDirPrefix: string,
    assert: Assert,
  ) {
    await visitOperatorMode({
      submode: 'code',
      fileView: 'browser',
      codePath: `${targetRealm}index`,
    });
    await waitForCodeEditor();
    await waitFor(`[data-test-directory^="${targetDirPrefix}-"]`);
    const element = document.querySelector(
      `[data-test-directory^="${targetDirPrefix}-"]`,
    );
    const fullPath = element?.getAttribute('data-test-directory');

    // installed folder should be tailing with uuid
    const uuid =
      fullPath?.replace(`${targetDirPrefix}-`, '').replace('/', '') || '';
    assert.ok(uuidValidate(uuid), 'uuid is a valid uuid');
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

  module('catalog listing', async function () {
    test('after clicking "Use" button, the ai room is initiated, and prompt is given correctly', async function (assert) {
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
      await verifyButtonAction(
        '[data-test-catalog-listing-use-button]',
        'Use',
        'I would like to use this Mortgage Calculator under the following realm: http://test-realm/test/',
        assert,
      );
    });

    test('after clicking "Install" button, the ai room is initiated, and prompt is given correctly', async function (assert) {
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
      await verifyButtonAction(
        '[data-test-catalog-listing-install-button]',
        'Install',
        'I would like to install this Mortgage Calculator under the following realm: http://test-realm/test/',
        assert,
      );
    });

    test('after clicking "Remix" button, the ai room is initiated, and prompt is given correctly', async function (assert) {
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
        `[data-test-card="${mortgageCalculatorCardId}"] [data-test-catalog-listing-remix-button]`,
        'Remix',
        'I would like to remix this Mortgage Calculator under the following realm: http://test-realm/test/',
        assert,
      );
    });

    test('use command copy the card to the workspace successfully', async function (assert) {
      await visitOperatorMode({
        stacks: [[]],
      });

      await executeCommand(
        ListingUseCommand,
        testRealmURL + 'Listing/author.json',
        testRealm2URL,
      );

      await verifyFolderWithUUID(testRealm2URL, 'author', assert);

      await verifyInstanceExists(testRealm2URL, 'author', 'Author', assert);
    });

    test('use command copy skills from skill listing to the workspace successfully', async function (assert) {
      let listingName = 'talk-like-a-pirate';
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${catalogRealmURL}SkillListing/${listingName}`,
              format: 'isolated',
            },
          ],
        ],
      });
      await executeCommand(
        ListingUseCommand,
        `${catalogRealmURL}SkillListing/${listingName}`,
        testRealm2URL,
      );
      await verifyInstanceExists(testRealm2URL, listingName, 'Skill', assert);
    });

    test('install command installs the card and example successfully', async function (assert) {
      await visitOperatorMode({
        stacks: [[]],
      });

      await executeCommand(
        ListingInstallCommand,
        testRealmURL + 'Listing/author.json',
        testRealm2URL,
      );

      await verifyInstanceExists(testRealm2URL, 'author', 'Author', assert);
    });

    module(
      'install command installs the listing with expected folder and file structure',
      async function () {
        test('card listing ', async function (assert) {
          // Given a listing:
          /*
           * mortgage-calculator/
           * mortgage-calculator/mortgage-calculator.gts
           * mortgage-calculator/MortgageCalculator/example.json
           */

          // When I install the listing into my selected realm, it should be:
          /*
           *  mortgage-calculator-[uuid]/
           *  mortgage-calculator-[uuid]/mortgage-calculator.gts
           *  mortgage-calculator-[uuid]/MortgageCalculator/example.json
           */

          await visitOperatorMode({
            stacks: [[]],
          });

          await executeCommand(
            ListingInstallCommand,
            mortgageCalculatorCardId,
            testRealm2URL,
          );

          await verifyFolderWithUUID(
            testRealm2URL,
            'mortgage-calculator',
            assert,
          );

          await verifyFileExists(
            testRealm2URL,
            'mortgage-calculator',
            'mortgage-calculator.gts',
            assert,
          );

          await verifyInstanceExists(
            testRealm2URL,
            'mortgage-calculator',
            'MortgageCalculator',
            assert,
          );
        });

        test('field listing', async function (assert) {
          // Given a listing:
          /*
           * fields/contact-link.gts
           */

          // When I install the listing into my selected realm, it should be:
          /*
           * contact-link-[uuid]/contact-link.gts
           */

          const contactLinkFieldListingCardId = `${catalogRealmURL}FieldListing/fb9494c4-0d61-4d2d-a6c0-7b16ca40b42b`;

          await visitOperatorMode({
            stacks: [[]],
          });

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

          await waitFor('[data-test-directory^="contact-link-"]');
          const element = document.querySelector(
            '[data-test-directory^="contact-link-"]',
          );
          const fullPath = element?.getAttribute('data-test-directory');

          // installed field should be tailing with uuid
          const uuid =
            fullPath?.replace('contact-link-', '').replace('/', '') || '';
          assert.ok(uuidValidate(uuid), 'uuid is a valid uuid');

          await verifyFileExists(
            testRealm2URL,
            'contact-link',
            'contact-link.gts',
            assert,
          );
        });
      },
    );

    test('remix command installs the card and redirects to code mode with persisted playground selection for first example successfully', async function (assert) {
      await visitOperatorMode({
        stacks: [[]],
      });

      await executeCommand(
        ListingRemixCommand,
        testRealmURL + 'Listing/author.json',
        testRealm2URL,
      );

      await waitFor('[data-test-module-inspector-view="preview"]', {
        timeout: 5_000,
      });
      await click('[data-test-module-inspector-view="preview"]');
      assert
        .dom('[data-test-playground-panel] [data-test-boxel-card-header-title]')
        .hasText('Author');
    });
  });
});
