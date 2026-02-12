import {
  currentURL,
  click,
  fillIn,
  find,
  typeIn,
  triggerKeyEvent,
  settled,
  waitUntil,
} from '@ember/test-helpers';

import { triggerEvent } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  Deferred,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common/realm';

import type {
  IncrementalIndexEventContent,
  RealmEventContent,
} from 'https://cardstack.com/base/matrix-event';

import {
  percySnapshot,
  testRealmURL,
  visitOperatorMode,
  type TestContextWithSave,
} from '../helpers';

import {
  setupInteractSubmodeTests,
  testRealm2URL,
} from '../helpers/interact-submode-setup';

module('Acceptance | interact submode tests', function (hooks) {
  let realm: Realm;

  let { setActiveRealms } = setupInteractSubmodeTests(hooks, {
    setRealm(value) {
      realm = value;
    },
  });

  module('0 stacks', function () {
    test('Clicking card in search panel opens card on a new stack', async function (assert) {
      await visitOperatorMode({});

      assert.dom('[data-test-operator-mode-stack]').doesNotExist();
      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // Click on search-input
      await click('[data-test-open-search-field]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await fillIn('[data-test-search-field]', 'Mango');

      assert.dom('[data-test-search-sheet]').hasClass('results'); // Search open

      // Click on search result
      await click(`[data-test-search-result="${testRealmURL}Pet/mango"]`);

      // Search closed

      // The card appears on a new stack
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert
        .dom(
          '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="0"]',
        )
        .includesText('Mango');
      assert
        .dom(
          '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="1"]',
        )
        .doesNotExist();
      assert.dom('[data-test-open-search-field]').hasValue('');
    });

    test('Can search for an index card by URL (without "index" in path)', async function (assert) {
      await visitOperatorMode({});

      await click('[data-test-open-search-field]');

      await fillIn('[data-test-search-field]', testRealmURL);

      assert
        .dom('[data-test-search-label]')
        .includesText('1 result from 1 realm');
      assert
        .dom(
          '[data-test-search-result="http://test-realm/test/index"], [data-test-card="http://test-realm/test/index"]',
        )
        .exists({ count: 1 });
    });

    test('Can open a recent card in empty stack', async function (assert) {
      await visitOperatorMode({});

      await click('[data-test-open-search-field]');
      await fillIn('[data-test-search-field]', `${testRealmURL}person-entry`);

      await click('[data-test-card="http://test-realm/test/person-entry"]');

      assert
        .dom(`[data-test-stack-card="${testRealmURL}person-entry"]`)
        .containsText('http://test-realm/test/person');

      // Close the card, find it in recent cards, and reopen it
      await click(
        `[data-test-stack-card="${testRealmURL}person-entry"] [data-test-close-button]`,
      );

      await click('[data-test-open-search-field]');
      assert.dom('[data-test-search-sheet]').hasClass('prompt');

      await click(`[data-test-search-result="${testRealmURL}person-entry"]`);

      assert
        .dom(`[data-test-stack-card="${testRealmURL}person-entry"]`)
        .exists();
    });
  });

  module('1 stack', function (_hooks) {
    test('restoring the stack from query param', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
        ],
      });

      await percySnapshot(assert);

      assert
        .dom(
          '[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]',
        )
        .includesText('Person');

      assert
        .dom(
          '[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]',
        )
        .includesText('Pet');

      // Remove mango (the dog) from the stack
      await click('[data-test-stack-card-index="1"] [data-test-close-button]');

      assert.operatorModeParametersMatch(currentURL(), {
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });

      await click('[data-test-operator-mode-stack] [data-test-pet="Mango"]');
      assert.operatorModeParametersMatch(currentURL(), {
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
        ],
        submode: 'interact',
        cardPreviewFormat: 'isolated',
        fileView: 'inspector',
        openDirs: {},
        moduleInspector: 'schema',
        trail: [],
      });

      // Click Edit on the top card
      await click('[data-test-stack-card-index="1"] [data-test-edit-button]');

      // The edit format should be reflected in the URL
      assert.operatorModeParametersMatch(currentURL(), {
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'edit',
            },
          ],
        ],
        submode: 'interact',
        fileView: 'inspector',
        openDirs: {},
        cardPreviewFormat: 'isolated',
        moduleInspector: 'schema',
        trail: [],
      });
    });

    test<TestContextWithSave>('a realm event with known clientRequestId is ignored', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Pet/vangogh`,
              format: 'edit',
            },
          ],
        ],
        codePath: `${testRealmURL}Pet/vangogh.json`,
      });

      let deferred = new Deferred<void>();

      this.onSave(() => {
        deferred.fulfill();
      });

      await fillIn(`[data-test-field="name"] input`, 'Renamed via UI');
      await deferred.promise;
      await click('[data-test-edit-button]');

      let knownClientRequestIds =
        getService('card-service').clientRequestIds.values();

      let knownClientRequestId = knownClientRequestIds.next().value;

      await realm.write(
        'Pet/vangogh.json',
        JSON.stringify({
          data: {
            type: 'card',
            attributes: {
              name: 'Renamed via realm call',
            },
            meta: {
              adoptsFrom: { module: 'http://test-realm/test/pet', name: 'Pet' },
            },
          },
        }),
        {
          clientRequestId: knownClientRequestId,
        },
      );

      await settled();

      assert.dom('[data-test-pet-title]').containsText('Renamed via UI');
    });

    test('restoring the stack from query param when card is in edit format', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'edit',
            },
          ],
        ],
      });

      await percySnapshot(assert);

      assert.dom('[data-test-field="firstName"] input').exists(); // Existence of an input field means it is in edit mode
    });

    test('click left or right add card button will open the search panel and then click on a recent card will open a new stack on the left or right', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'edit',
            },
          ],
        ],
      });

      let operatorModeStateService = getService('operator-mode-state-service');
      let recentCardsService = getService('recent-cards-service');

      operatorModeStateService.state.stacks[0].map((item) =>
        recentCardsService.add(item.id),
      );

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert.dom('[data-test-add-card-left-stack]').exists();
      assert.dom('[data-test-add-card-right-stack]').exists();
      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // Add a card to the left stack
      await click('[data-test-add-card-left-stack]');

      assert.dom('[data-test-search-field]').isFocused();
      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await click(`[data-test-search-result="${testRealmURL}Pet/mango"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed
      assert.dom('[data-test-operator-mode-stack="0"]').includesText('Mango'); // Mango goes on the left stack
      assert.dom('[data-test-operator-mode-stack="1"]').includesText('Fadhlan');

      // Buttons to add a neighbor stack are gone
      assert.dom('[data-test-add-card-left-stack]').doesNotExist();
      assert.dom('[data-test-add-card-right-stack]').doesNotExist();

      // Close the only card in the 1st stack
      await click(
        '[data-test-operator-mode-stack="0"] [data-test-close-button]',
      );

      assert
        .dom('[data-test-operator-mode-stack]')
        .exists({ count: 1 }, 'after close, expect 1 stack');
      assert
        .dom('[data-test-add-card-left-stack]')
        .exists('after close, expect add to left stack button');
      assert
        .dom('[data-test-add-card-right-stack]')
        .exists('after close, expect add to right stack button');

      // Add a card to the left stack
      await click('[data-test-add-card-left-stack]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await click(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // There are now 2 stacks
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });
      assert.dom('[data-test-operator-mode-stack="0"]').includesText('Fadhlan');
      assert.dom('[data-test-operator-mode-stack="1"]').includesText('Mango'); // Mango gets moved onto the right stack

      // Buttons to add a neighbor stack are gone
      assert.dom('[data-test-add-card-left-stack]').doesNotExist();
      assert.dom('[data-test-add-card-right-stack]').doesNotExist();

      // Close the only card in the 1st stack
      await click(
        '[data-test-operator-mode-stack="0"] [data-test-close-button]',
      );

      // There is now only 1 stack and the buttons to add a neighbor stack are back
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert.dom('[data-test-add-card-left-stack]').exists();
      assert.dom('[data-test-add-card-right-stack]').exists();

      // Replace the current stack by interacting with search prompt directly
      // Click on search-input
      await click('[data-test-open-search-field]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      await click(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // There is still only 1 stack
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert.dom('[data-test-neighbor-stack-trigger]').exists({ count: 2 });

      await click('[data-test-workspace-chooser-toggle]');
      assert.dom('[data-test-workspace-chooser]').exists();
      assert.dom('[data-test-neighbor-stack-trigger]').doesNotExist();
    });

    test('Clicking search panel (without left and right buttons activated) replaces open card on existing stack', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
        ],
      });

      let operatorModeStateService = getService('operator-mode-state-service');
      let recentCardsService = getService('recent-cards-service');

      operatorModeStateService.state.stacks[0].map((item) =>
        recentCardsService.add(item.id),
      );

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert.dom('[data-test-add-card-left-stack]').exists();
      assert.dom('[data-test-add-card-right-stack]').exists();
      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // Click on search-input
      await click('[data-test-open-search-field]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      // Click on a recent search
      await click(`[data-test-search-result="${testRealmURL}Pet/mango"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      // The recent card REPLACES onto on current stack
      assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
      assert
        .dom(
          '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="0"]',
        )
        .includesText('Mango');
      assert
        .dom(
          '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="1"]',
        )
        .doesNotExist();
    });

    test('search can be dismissed with escape', async function (assert) {
      await visitOperatorMode({});
      await click('[data-test-open-search-field]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt');

      await triggerKeyEvent(
        '[data-test-search-sheet] input',
        'keydown',
        'Escape',
      );

      assert.dom('[data-test-search-sheet]').hasClass('closed');
    });

    test('duplicate card in a stack is not allowed', async function (assert) {
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

      await click('[data-test-boxel-filter-list-button="All Cards"]');
      // Simulate simultaneous clicks for spam-clicking
      let cardSelector = `[data-test-operator-mode-stack="0"] [data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`;
      await Promise.all([click(cardSelector), click(cardSelector)]);

      assert
        .dom(`[data-stack-card="${testRealmURL}Person/fadhlan"]`)
        .exists({ count: 1 });
    });

    test('embedded card from writable realm shows pencil icon in edit mode', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealm2URL}Person/hassan`,
              format: 'edit',
            },
          ],
        ],
      });
      await triggerEvent(
        `[data-test-stack-card="${testRealm2URL}Person/hassan"] [data-test-links-to-editor="pet"] [data-test-field-component-card]`,
        'mouseenter',
      );
      assert
        .dom(
          `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-edit]`,
        )
        .exists();
      await click(
        `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-edit]`,
      );
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-card-format="edit"]`,
        )
        .exists('linked card now rendered as a stack item in edit format');
    });

    test('clicking a linked file opens it as a new isolated stack item', async function (assert) {
      let fileId = `${testRealmURL}FileLinkCard/notes.txt`;
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}FileLinkCard/with-file`,
              format: 'isolated',
            },
          ],
        ],
      });

      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}FileLinkCard/with-file"] [data-test-card="${fileId}"]`,
        )
        .exists('linked file is rendered in the card');

      await click(
        `[data-test-stack-card="${testRealmURL}FileLinkCard/with-file"] [data-test-card="${fileId}"]`,
      );

      assert.operatorModeParametersMatch(currentURL(), {
        stacks: [
          [
            {
              id: `${testRealmURL}FileLinkCard/with-file`,
              format: 'isolated',
            },
            {
              id: fileId,
              format: 'isolated',
            },
          ],
        ],
      });
    });

    test('can save mutated card without having opened in stack', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealm2URL}Person/hassan`,
              format: 'isolated',
            },
          ],
        ],
      });
      await click('[data-test-update-and-save-pet]');
      await triggerEvent(
        `[data-test-stack-card="${testRealm2URL}Person/hassan"] [data-test-pet]`,
        'mouseenter',
      );
      await click(
        `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-edit]`,
      );
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-field="name"] input`,
        )
        .hasValue('Updated Pet');
    });
  });

  module('2 stacks', function () {
    test('restoring the stacks from query param', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
          [
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
        ],
      });

      await percySnapshot(assert); // 2 stacks from the same realm share the same background

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });
      assert.dom('[data-test-operator-mode-stack="0"]').includesText('Fadhlan');
      assert.dom('[data-test-operator-mode-stack="1"]').includesText('Mango');

      // Close the card in the 2nd stack
      await click(
        '[data-test-operator-mode-stack="1"] [data-test-close-button]',
      );
      assert.dom('[data-test-operator-mode-stack="0"]').exists();

      // 2nd stack is removed, 1st stack remains
      assert.dom('[data-test-operator-mode-stack="1"]').doesNotExist();
      assert.dom('[data-test-operator-mode-stack="0"]').includesText('Fadhlan');

      assert.operatorModeParametersMatch(currentURL(), {
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });

      // Close the last card in the last stack that is left
      await click(
        '[data-test-operator-mode-stack="0"] [data-test-close-button]',
      );

      assert
        .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
        .doesNotExist();
      assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();
    });

    test<TestContextWithSave>('can create a card when 2 stacks are present', async function (assert) {
      assert.expect(1);
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
          [{ id: `${testRealmURL}index`, format: 'isolated' }],
        ],
      });
      let petId: string | undefined;
      this.onSave((id, json) => {
        if (id.href.includes('Pet/')) {
          petId = id.href;
          if (typeof json === 'string') {
            throw new Error('expected JSON save data');
          }
        }
      });
      await click(
        `[data-test-operator-mode-stack="0"] [data-test-edit-button]`,
      );
      await click(
        `[data-test-operator-mode-stack="0"] [data-test-links-to-editor="pet"] [data-test-remove-card]`,
      );
      await click(
        `[data-test-operator-mode-stack="0"] [data-test-links-to-editor="pet"] [data-test-add-new]`,
      );
      await click(
        `[data-test-card-catalog-create-new-button="${testRealmURL}"]`,
      );
      await click(`[data-test-card-catalog-go-button]`);
      await click(
        `[data-test-operator-mode-stack="0"] [data-test-stack-card-index="1"] [data-test-edit-button]`,
      );
      assert
        .dom(`[data-test-stack-card="${petId}"]`)
        .exists('the card is rendered correctly');
    });

    test('visiting 2 stacks from differing realms', async function (assert) {
      setActiveRealms([testRealmURL, 'http://localhost:4202/test/']);
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
          [
            {
              id: 'http://localhost:4202/test/hassan',
              format: 'isolated',
            },
          ],
        ],
      });

      await percySnapshot(assert); // 2 stacks from the different realms have different backgrounds

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });
    });

    test('Clicking search panel (without left and right buttons activated) replaces all cards in the rightmost stack', async function (assert) {
      // creates a recent search
      let recentCardsService = getService('recent-cards-service');
      recentCardsService.add(`${testRealmURL}Person/fadhlan`);

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
          [
            {
              id: `${testRealmURL}index`,
              format: 'isolated',
            },
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
        ],
      });

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });

      // Click on search-input
      await click('[data-test-open-search-field]');

      assert.dom('[data-test-search-sheet]').hasClass('prompt'); // Search opened

      // Click on a recent search
      await click(`[data-test-search-result="${testRealmURL}Person/fadhlan"]`);

      assert.dom('[data-test-search-sheet]').doesNotHaveClass('prompt'); // Search closed

      assert.dom('[data-test-operator-mode-stack]').exists({ count: 2 });
      assert
        .dom(
          '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="0"]',
        )
        .includesText('Fadhlan');
      assert
        .dom(
          '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="1"]',
        )
        .doesNotExist();
      assert
        .dom(
          '[data-test-operator-mode-stack="1"] [data-test-stack-card-index="0"]',
        )
        .includesText('Fadhlan');
      assert
        .dom(
          '[data-test-operator-mode-stack="1"] [data-test-stack-card-index="1"]',
        )
        .doesNotExist();
    });

    test('card that has already been opened before will reflect its latest state after being mutated through a relationship', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Pet/mango`,
              format: 'isolated',
            },
          ],
        ],
      });

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealm2URL}Person/hassan`,
              format: 'isolated',
            },
          ],
        ],
      });

      await click('[data-test-update-and-save-pet]');

      await triggerEvent(
        `[data-test-stack-card="${testRealm2URL}Person/hassan"] [data-test-pet]`,
        'mouseenter',
      );

      await click(
        `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-edit]`,
      );

      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-field="name"] input`,
        )
        .hasValue('Updated Pet');
    });
  });

  module('index changes', function () {
    test('stack item live updates when index changes', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });
      assert
        .dom('[data-test-operator-mode-stack="0"] [data-test-person]')
        .hasText('Fadhlan');

      await realm.write(
        'Person/fadhlan.json',
        JSON.stringify({
          data: {
            type: 'card',
            attributes: {
              firstName: 'FadhlanXXX',
            },
            meta: {
              adoptsFrom: {
                module: '../person',
                name: 'Person',
              },
            },
          },
        } as LooseSingleCardDocument),
      );

      await settled();

      assert
        .dom('[data-test-operator-mode-stack="0"] [data-test-person]')
        .hasText('FadhlanXXX');
    });

    test('stack item live updates with error in isolated mode', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });

      assert
        .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
        .exists('card is displayed');
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-card-error]`,
        )
        .doesNotExist('card error state is NOT displayed');

      await realm.write(
        'Person/fadhlan.json',
        JSON.stringify({
          data: {
            type: 'card',
            relationships: {
              pet: {
                links: { self: './missing' },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../person',
                name: 'Person',
              },
            },
          },
        } as LooseSingleCardDocument),
      );

      await settled();

      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-card-error]`,
        )
        .exists('card error state is displayed');

      await realm.write(
        'Person/fadhlan.json',
        JSON.stringify({
          data: {
            type: 'card',
            relationships: {
              pet: { links: { self: null } },
            },
            meta: {
              adoptsFrom: {
                module: '../person',
                name: 'Person',
              },
            },
          },
        } as LooseSingleCardDocument),
      );

      await settled();

      assert
        .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
        .exists('card is displayed');
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-card-error]`,
        )
        .doesNotExist('card error state is NOT displayed');
    });

    test('stack item live shows stale card when server has an error in edit mode', async function (assert) {
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'edit',
            },
          ],
        ],
      });

      assert
        .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
        .exists('card is displayed');
      assert
        .dom(
          `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-card-error]`,
        )
        .doesNotExist('card error state is NOT displayed');
      assert.dom('[data-test-field="firstName"] input').hasValue('Fadhlan');

      // TODO should we show a message that the card is currently in an error
      // state on the server? note that this error state did not occur from an
      // auto save, but rather an external event put the server into an error...
    });

    test('stack item edit results in index event that is ignored', async function (assert) {
      assert.expect(6);
      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}Person/fadhlan`,
              format: 'isolated',
            },
          ],
        ],
      });
      const messageService = getService('message-service');
      const receivedEventDeferred = new Deferred<void>();
      messageService.listenerCallbacks
        .get(testRealmURL)!
        .push((ev: RealmEventContent) => {
          if (
            ev.eventName === 'index' &&
            ev.indexType === 'incremental-index-initiation'
          ) {
            // eslint-disable-next-line qunit/no-early-return
            return; // ignore the index initiation event
          }
          ev = ev as IncrementalIndexEventContent;
          assert.ok(
            ev.clientRequestId,
            'client request ID is included in event',
          );
          assert.strictEqual(
            ev.eventName,
            'index',
            'the event name is "index"',
          );
          assert.strictEqual(
            ev.indexType,
            'incremental',
            'the event type is "incremental"',
          );
          assert.deepEqual(
            ev.invalidations,
            [`${testRealmURL}Person/fadhlan`],
            'invalidations are correct',
          ); // the card that was edited
          receivedEventDeferred.fulfill();
        });
      await click('[data-test-edit-button]');
      fillIn('[data-test-field="firstName"] input', 'FadhlanXXX');
      let inputElement = find(
        '[data-test-field="firstName"] input',
      ) as HTMLInputElement;
      inputElement.focus();
      inputElement.select();
      inputElement.setSelectionRange(0, 3);
      await receivedEventDeferred.promise;
      await settled();
      inputElement = find(
        '[data-test-field="firstName"] input',
      ) as HTMLInputElement;
      assert.strictEqual(
        document.activeElement,
        inputElement,
        'focus is preserved on the input element',
      );
      assert.strictEqual(
        document.getSelection()?.anchorOffset,
        3,
        'select is preserved',
      );
    });

    test('containsMany string field preserves focus while typing', async function (assert) {
      const receivedEventDeferred = new Deferred<void>();
      const messageService = getService('message-service');
      const typedText = 'Ada';
      const inputSelector =
        '[data-test-contains-many="names"] [data-test-item="0"] input';

      messageService.listenerCallbacks.get(testRealmURL)!.push((e) => {
        if (
          e.eventName === 'index' &&
          e.indexType === 'incremental-index-initiation'
        ) {
          return; // ignore the index initiation event
        }
        receivedEventDeferred.fulfill();
      });

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}FocusTest/1`,
              format: 'edit',
            },
          ],
        ],
      });

      await click('[data-test-contains-many="names"] [data-test-add-new]');
      let inputElement = find(inputSelector) as HTMLInputElement;

      let focusStates: boolean[] = [];
      let inputEventCount = 0;
      const handleInputEvent = (event: Event) => {
        let target = event.target;
        if (!(target instanceof HTMLInputElement)) {
          return;
        }
        if (!target.matches(inputSelector)) {
          return;
        }
        inputEventCount += 1;
        focusStates.push(document.activeElement === target);
      };

      document.addEventListener('input', handleInputEvent, true);
      try {
        inputElement.focus();
        await typeIn(inputSelector, typedText);
      } finally {
        document.removeEventListener('input', handleInputEvent, true);
      }

      await receivedEventDeferred.promise;
      await settled();

      assert.strictEqual(
        inputEventCount,
        typedText.length,
        'input events are triggered for each keystroke',
      );
      assert.true(
        focusStates.every(Boolean),
        'focus is preserved on the input element during typing',
      );
      inputElement = find(inputSelector) as HTMLInputElement;
      assert.strictEqual(
        document.activeElement,
        inputElement,
        'focus is preserved on the input element after typing',
      );
      assert.dom(inputSelector).hasValue(typedText);
    });

    test('containsMany field def preserves focus while typing', async function (assert) {
      const messageService = getService('message-service');
      const typedText = 'Ada';
      const withoutLinksSelector =
        '[data-test-contains-many="items"] [data-test-item="0"] [data-test-field="label"] input';
      const withLinksSelector =
        '[data-test-contains-many="items"] [data-test-item="1"] [data-test-field="label"] input';

      const waitForIndexEvent = () => {
        const receivedEventDeferred = new Deferred<void>();
        const callbacks = messageService.listenerCallbacks.get(testRealmURL)!;
        const callback = (e: RealmEventContent) => {
          if (
            e.eventName === 'index' &&
            e.indexType === 'incremental-index-initiation'
          ) {
            return; // ignore the index initiation event
          }
          const index = callbacks.indexOf(callback);
          if (index !== -1) {
            callbacks.splice(index, 1);
          }
          receivedEventDeferred.fulfill();
        };
        callbacks.push(callback);
        return receivedEventDeferred;
      };

      const assertFocusPreserved = async (
        selector: string,
        expectedValue: string,
      ) => {
        const receivedEventDeferred = waitForIndexEvent();
        let inputElement = find(selector) as HTMLInputElement;
        let focusStates: boolean[] = [];
        let inputEventCount = 0;
        const handleInputEvent = (event: Event) => {
          let target = event.target;
          if (!(target instanceof HTMLInputElement)) {
            return;
          }
          if (!target.matches(selector)) {
            return;
          }
          inputEventCount += 1;
          focusStates.push(document.activeElement === target);
        };

        document.addEventListener('input', handleInputEvent, true);
        try {
          inputElement.focus();
          inputElement.setSelectionRange(
            inputElement.value.length,
            inputElement.value.length,
          );
          await typeIn(selector, typedText);
        } finally {
          document.removeEventListener('input', handleInputEvent, true);
        }

        await receivedEventDeferred.promise;
        await settled();

        assert.strictEqual(
          inputEventCount,
          typedText.length,
          'input events are triggered for each keystroke',
        );
        assert.true(
          focusStates.every(Boolean),
          'focus is preserved on the input element during typing',
        );
        inputElement = find(selector) as HTMLInputElement;
        assert.strictEqual(
          document.activeElement,
          inputElement,
          'focus is preserved on the input element after typing',
        );
        assert.dom(selector).hasValue(expectedValue);
      };

      await visitOperatorMode({
        stacks: [
          [
            {
              id: `${testRealmURL}FocusNested/1`,
              format: 'edit',
            },
          ],
        ],
      });

      assert.dom(withoutLinksSelector).hasValue('Plain');
      await assertFocusPreserved(withoutLinksSelector, `Plain${typedText}`);

      assert
        .dom(
          '[data-test-contains-many="items"] [data-test-item="1"] [data-test-links-to-many="pets"] [data-test-pill-item="0"]',
        )
        .exists('linksToMany field has a linked card');
      assert.dom(withLinksSelector).hasValue('With Pet');
      await assertFocusPreserved(withLinksSelector, `With Pet${typedText}`);
    });
  });

  module('size limit errors', function () {
    test('edit view shows size limit error when save exceeds limit', async function (assert) {
      let environmentService = getService('environment-service') as any;
      let originalMaxSize = environmentService.cardSizeLimitBytes;
      environmentService.cardSizeLimitBytes = 1000;

      try {
        await visitOperatorMode({
          stacks: [
            [
              {
                id: `${testRealmURL}Pet/mango`,
                format: 'edit',
              },
            ],
          ],
        });

        await fillIn(
          `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-field="name"] input`,
          'x'.repeat(5000),
        );

        await waitUntil(() =>
          Boolean(
            !find(
              `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-auto-save-indicator]`,
            )?.textContent?.includes('Saving'),
          ),
        );

        assert
          .dom(
            `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-auto-save-indicator]`,
          )
          .includesText(
            `exceeds maximum allowed size (${environmentService.cardSizeLimitBytes} bytes)`,
          );
      } finally {
        environmentService.cardSizeLimitBytes = originalMaxSize;
      }
    });
  });
});
