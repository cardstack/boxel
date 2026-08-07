import { currentURL, click, triggerEvent, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  percySnapshot,
  testModuleRealm,
  testRealmURL,
  visitOperatorMode,
  type TestContextWithSave,
} from '../../helpers';
import {
  setupInteractSubmodeTests,
  testRealm2URL,
} from '../../helpers/interact-submode-setup';

module(
  'Acceptance | interact submode | multiple stacks tests',
  function (hooks) {
    let { setActiveRealms } = setupInteractSubmodeTests(hooks, {
      setRealm() {},
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
        assert
          .dom('[data-test-operator-mode-stack="0"]')
          .includesText('Fadhlan');
        assert.dom('[data-test-operator-mode-stack="1"]').includesText('Mango');

        // Close the card in the 2nd stack
        await click(
          '[data-test-operator-mode-stack="1"] [data-test-close-button]',
        );
        assert.dom('[data-test-operator-mode-stack="0"]').exists();

        // 2nd stack is removed, 1st stack remains
        assert.dom('[data-test-operator-mode-stack="1"]').doesNotExist();
        assert
          .dom('[data-test-operator-mode-stack="0"]')
          .includesText('Fadhlan');

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
        await click(`[data-test-item-button-create-new="${testRealmURL}"]`);
        await click(
          `[data-test-operator-mode-stack="0"] [data-test-stack-card-index="1"] [data-test-edit-button]`,
        );
        assert
          .dom(`[data-test-stack-card="${petId}"]`)
          .exists('the card is rendered correctly');
      });

      test('visiting 2 stacks from differing realms', async function (assert) {
        setActiveRealms([testRealmURL, `${testModuleRealm}`]);
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
                id: `${testModuleRealm}hassan`,
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
        await click(
          `[data-test-search-result="${testRealmURL}Person/fadhlan"]`,
        );

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
          `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-more-options]`,
        );
        await click('[data-test-boxel-menu-item-text="Edit"]');

        assert
          .dom(
            `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-field="name"] input`,
          )
          .hasValue('Updated Pet');
      });
    });

    module('expand to full width', function () {
      test('expanding a card in a two-stack layout hides the other stack', async function (assert) {
        let fadhlanId = `${testRealmURL}Person/fadhlan`;
        let mangoId = `${testRealmURL}Pet/mango`;
        await visitOperatorMode({
          stacks: [
            [{ id: fadhlanId, format: 'isolated' }],
            [{ id: mangoId, format: 'isolated' }],
          ],
        });

        assert
          .dom('[data-test-operator-mode-stack="0"]')
          .exists('stack 0 exists');
        assert
          .dom('[data-test-operator-mode-stack="1"]')
          .exists('stack 1 exists');

        await waitFor(
          '[data-test-operator-mode-stack="0"] [data-test-more-options-button]',
        );
        await click(
          '[data-test-operator-mode-stack="0"] [data-test-more-options-button]',
        );
        await click('[data-test-boxel-menu-item-text="Expand to Full Width"]');

        assert
          .dom(
            `[data-test-operator-mode-stack="0"] [data-test-stack-card="${fadhlanId}"]`,
          )
          .hasClass('expanded', 'fadhlan card is expanded');
        assert
          .dom('[data-test-operator-mode-stack="1"]')
          .isNotVisible('stack 1 is hidden when stack 0 has an expanded card');
      });

      test('expanding the same card open in two stacks only expands one', async function (assert) {
        let fadhlanId = `${testRealmURL}Person/fadhlan`;
        await visitOperatorMode({
          stacks: [
            [{ id: fadhlanId, format: 'isolated' }],
            [{ id: fadhlanId, format: 'isolated' }],
          ],
        });

        assert
          .dom('[data-test-operator-mode-stack="0"]')
          .exists('stack 0 exists');
        assert
          .dom('[data-test-operator-mode-stack="1"]')
          .exists('stack 1 exists');

        await waitFor(
          '[data-test-operator-mode-stack="0"] [data-test-more-options-button]',
        );
        await click(
          '[data-test-operator-mode-stack="0"] [data-test-more-options-button]',
        );
        await click('[data-test-boxel-menu-item-text="Expand to Full Width"]');

        assert
          .dom('[data-test-operator-mode-stack="0"] [data-test-stack-card]')
          .hasClass('expanded', 'stack 0 card is expanded');
        assert
          .dom('[data-test-operator-mode-stack="1"]')
          .isNotVisible('stack 1 is hidden');
        assert
          .dom('[data-test-stack-card].expanded')
          .exists({ count: 1 }, 'only one card has the expanded class');
      });
    });
  },
);
