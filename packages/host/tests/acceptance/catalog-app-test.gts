import { click, waitFor, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { SearchCardsByQueryCommand } from '@cardstack/host/commands/search-cards';
import type CommandService from '@cardstack/host/services/command-service';

import {
  lookupService,
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

let matrixRoomId: string;
module('Acceptance | catalog app tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(async function () {
    matrixRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription(matrixRoomId);
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
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
  });

  module('catalog listing', async function () {
    test('able to "Use"', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `http://localhost:4201/catalog/CardListing/4aca5509-09d5-4aec-aeba-1cd26628cca9`,
              format: 'isolated',
            },
          ],
        ],
      });

      await waitFor('[data-test-catalog-listing-use-button]');
      assert
        .dom('[data-test-catalog-listing-use-button]')
        .containsText('Use', '"Use" button exist in listing');
      await click('[data-test-catalog-listing-use-button]');
      await click('[data-test-boxel-menu-item-text="http://test-realm/test/"]');

      await waitFor('[data-test-catalog-listing-use-button]');

      await waitUntil(() => {
        return document
          .querySelector('[data-test-catalog-listing-use-button]')
          ?.textContent?.includes('Created Instances');
      });

      let commandService = lookupService<CommandService>('command-service');
      let searchCommand = new SearchCardsByQueryCommand(
        commandService.commandContext,
      );
      let result = await searchCommand.execute({
        query: {
          filter: {
            type: {
              module:
                'http://localhost:4201/catalog/mortgage-calculator/mortgage-calculator',
              name: 'MortgageCalculator',
            },
          },
        },
      });
      assert.ok(
        result.cardIds.some(
          (id) =>
            id.includes(`${testRealmURL}mortgage-calculator`) &&
            id.includes('MortgageCalculator'),
        ),
        'Listing should create a new instance from the example',
      );
    });

    test('able to "Install"', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `http://localhost:4201/catalog/CardListing/4aca5509-09d5-4aec-aeba-1cd26628cca9`,
              format: 'isolated',
            },
          ],
        ],
      });

      await waitFor('[data-test-catalog-listing-install-button]');
      await click('[data-test-catalog-listing-install-button]');
      await click('[data-test-boxel-menu-item-text="http://test-realm/test/"]');

      assert
        .dom('[data-test-catalog-listing-install-button]')
        .containsText('Install', '"Install" button exist in listing');

      await waitFor('[data-test-catalog-listing-install-button]');

      await waitUntil(() => {
        return document
          .querySelector('[data-test-catalog-listing-install-button]')
          ?.textContent?.includes('Installed');
      });

      // Check gts file is installed/copied successfully
      await visitOperatorMode({
        submode: 'code',
        fileView: 'browser',
        codePath: `${testRealmURL}index`,
      });

      await waitForCodeEditor();

      await waitFor('[data-test-directory^="mortgage-calculator-"]');
      const element = document.querySelector(
        '[data-test-directory^="mortgage-calculator-"]',
      );
      const fullPath = element?.getAttribute('data-test-directory');
      await click(`[data-test-directory="${fullPath}"]`);

      assert.dom(`[data-test-directory="${fullPath}"] .icon`).hasClass('open');

      const filePath = `${fullPath}mortgage-calculator.gts`;
      await waitFor(`[data-test-file="${filePath}"]`);
      await click(`[data-test-file="${filePath}"]`);
      assert
        .dom(`[data-test-file="${filePath}"]`)
        .exists('mortgage-calculator.gts file exists')
        .hasClass('selected', 'mortgage-calculator.gts file is selected');

      // able to see example install successfully
      const examplePath = `${fullPath}MortgageCalculator/`;
      await waitFor(`[data-test-directory="${examplePath}"]`);
      await click(`[data-test-directory="${examplePath}"]`);

      assert
        .dom(`[data-test-directory="${examplePath}"] .icon`)
        .hasClass('open');

      await waitFor(
        `[data-test-file^="${examplePath}"][data-test-file$=".json"]`,
      );
      await click(
        `[data-test-file^="${examplePath}"][data-test-file$=".json"]`,
      );

      assert
        .dom(`[data-test-file^="${examplePath}"][data-test-file$=".json"]`)
        .exists('Mortgage Calculator Example with uuid instance exists')
        .hasClass(
          'selected',
          'Mortgage Calculator Example with uuid instance is selected',
        );
    });
  });
});
