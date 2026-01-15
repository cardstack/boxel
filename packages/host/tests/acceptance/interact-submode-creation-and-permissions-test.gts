import {
  click,
  currentURL,
  fillIn,
  triggerKeyEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { triggerEvent } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import window from 'ember-window-mock';
import { module, test } from 'qunit';

import type { SingleCardDocument } from '@cardstack/runtime-common';
import { Deferred, isLocalId } from '@cardstack/runtime-common';

import { claimsFromRawToken } from '@cardstack/host/services/realm';
import { RecentCards } from '@cardstack/host/utils/local-storage-keys';

import {
  assertMessages,
  percySnapshot,
  testRealmURL,
  visitOperatorMode,
  type TestContextWithSave,
} from '../helpers';
import {
  personalRealmURL,
  setupInteractSubmodeTests,
  testRealm2URL,
  testRealm3URL,
} from '../helpers/interact-submode-setup';

module(
  'Acceptance | interact submode creation & permissions',
  function (hooks) {
    let { setRealmPermissions, setActiveRealms } = setupInteractSubmodeTests(
      hooks,
      {
        setRealm() {},
      },
    );

    module('1 stack creation flows', function () {
      test<TestContextWithSave>('can create a card from the index stack item', async function (assert) {
        assert.expect(7);
        await visitOperatorMode({
          stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
        });
        let deferred = new Deferred<void>();
        let id: string | undefined;
        this.onSave((url, json) => {
          if (typeof json === 'string') {
            throw new Error('expected JSON save data');
          }
          if (json.data.attributes?.firstName === null) {
            // Because we create an empty card, upon choosing a catalog item, we must skip the scenario where attributes null
            // eslint-disable-next-line qunit/no-early-return
            return;
          }
          id = url.href;
          assert.strictEqual(json.data.attributes?.firstName, 'Hassan');
          assert.strictEqual(json.data.meta.realmURL, testRealmURL);
          deferred.fulfill();
        });

        await click('[data-test-boxel-filter-list-button="All Cards"]');
        await click('[data-test-create-new-card-button]');
        assert
          .dom('[data-test-card-catalog-item-selected]')
          .doesNotExist('No card is pre-selected');
        assert.dom('[data-test-card-catalog-item]').exists();
        assert
          .dom('[data-test-show-more-cards]')
          .containsText('not shown', 'Entries are paginated');
        await click(`[data-test-select="${testRealmURL}person-entry"]`);
        await click('[data-test-card-catalog-go-button]');

        await fillIn(`[data-test-field="firstName"] input`, 'Hassan');
        await click(
          '[data-test-stack-card-index="1"] [data-test-close-button]',
        );

        await deferred.promise;
        await waitUntil(() => id, {
          timeoutMessage: 'waiting for id to be assigned to new card',
        });
        id = id!;

        let recentCards: { cardId: string; timestamp: number }[] = JSON.parse(
          window.localStorage.getItem(RecentCards) ?? '[]',
        );
        assert.ok(
          recentCards.find((c) => c.cardId === id),
          `the newly created card's remote id is in recent cards`,
        );
        assert.notOk(
          recentCards.find((c) => isLocalId(c.cardId)),
          `no local ID's are in recent cards`,
        );
      });

      // TODO we don't yet support viewing an unsaved card in code mode since it has no URL
      test<TestContextWithSave>('can switch to submode after newly created card is saved', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
        });

        let id: string | undefined;
        this.onSave((url) => {
          id = url.href;
        });

        await click('[data-test-boxel-filter-list-button="All Cards"]');
        await click('[data-test-create-new-card-button]');
        assert
          .dom('[data-test-card-catalog-item-selected]')
          .doesNotExist('No card is pre-selected');
        assert.dom('[data-test-card-catalog-item]').exists();
        assert
          .dom('[data-test-show-more-cards]')
          .containsText('not shown', 'Entries are paginated');
        await click(`[data-test-select="${testRealmURL}person-entry"]`);
        await click('[data-test-card-catalog-go-button]');

        await fillIn(`[data-test-field="firstName"] input`, 'Hassan');

        await click('[data-test-submode-switcher] button');
        await click('[data-test-boxel-menu-item-text="Code"]');
        assert.ok(id, 'new card has been assign an id');

        assert
          .dom(`[data-test-card-url-bar-input]`)
          .hasValue(
            `${id}.json`,
            "the new card's url appears in the card URL field",
          );
      });

      test<TestContextWithSave>('create a new card instance when type is seleted in CardsGrid', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
        });

        assert.dom('[data-test-stack-card-index]').exists({ count: 1 });
        await click('[data-test-boxel-filter-list-button="All Cards"]');
        await click('[data-test-create-new-card-button]');
        assert.dom('[data-test-card-catalog-item]').exists();
        await click('[data-test-card-catalog-cancel-button]');

        await click('[data-test-boxel-filter-list-button="Person"]');
        await click('[data-test-create-new-card-button]');
        assert.dom('[data-test-card-catalog-item]').doesNotExist();
        assert.dom('[data-test-stack-card-index]').exists({ count: 2 });
        assert
          .dom(
            '[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]',
          )
          .hasText('Person');
        assert
          .dom(
            '[data-test-stack-card-index="1"] [data-test-card-format="edit"]',
          )
          .exists();
      });

      test('New card is auto-attached once it is saved', async function (assert) {
        let indexCardId = `${testRealm2URL}index`;
        await visitOperatorMode({
          stacks: [
            [
              {
                id: indexCardId,
                format: 'isolated',
              },
            ],
          ],
        });
        assert.dom(`[data-test-stack-card="${indexCardId}"]`).exists();
        await click('[data-test-open-ai-assistant]');
        assert.dom('[data-test-attached-card]').doesNotExist();
        // Press the + button to create a new card instance
        await click('[data-test-boxel-filter-list-button="All Cards"]');
        await click('[data-test-create-new-card-button]');
        await fillIn('[data-test-search-field]', 'Skill');
        // Select a card from catalog entries
        await click(
          `[data-test-select="https://cardstack.com/base/cards/skill"]`,
        );

        await click(`[data-test-card-catalog-go-button]`);

        await fillIn('[data-test-field="title"] input', 'new skill');
        assert.dom(`[data-test-attached-card]`).containsText('new skill');
      });

      test<TestContextWithSave>("new card's remote ID is reflected in the URL once it is saved", async function (assert) {
        let indexCardId = `${testRealm2URL}index`;
        await visitOperatorMode({
          stacks: [
            [
              {
                id: indexCardId,
                format: 'isolated',
              },
            ],
          ],
        });
        await click('[data-test-boxel-filter-list-button="All Cards"]');
        await click('[data-test-create-new-card-button]');
        await fillIn('[data-test-search-field]', 'Skill');
        await click(
          `[data-test-select="https://cardstack.com/base/cards/skill"]`,
        );

        let id: string | undefined;
        this.onSave((url) => {
          id = url.href;
        });

        // intentionally not awaiting the click
        click(`[data-test-card-catalog-go-button]`);

        // new card is not serialized into the url before it is saved
        assert.operatorModeParametersMatch(currentURL(), {
          stacks: [
            [
              {
                id: indexCardId,
                format: 'isolated',
              },
            ],
          ],
        });

        await waitUntil(() => id, { timeout: 5000 });

        assert.ok(id, 'new card has been assigned a remote id');
        id = id!;

        // new card is serialized into the url after it is saved
        assert.operatorModeParametersMatch(currentURL(), {
          stacks: [
            [
              {
                id: indexCardId,
                format: 'isolated',
              },
              {
                format: 'edit',
                id,
              },
            ],
          ],
        });
      });

      test<TestContextWithSave>('new card is created in the selected realm', async function (assert) {
        assert.expect(1);
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
        this.onSave((url) => {
          if (url.href.includes('Pet')) {
            assert.ok(
              url.href.startsWith(testRealmURL),
              `The pet card is saved in the selected realm ${testRealmURL}`,
            );
          }
        });
        await click('[data-test-add-new="friends"]');
        await click(
          `[data-test-card-catalog-create-new-button="${testRealmURL}"]`,
        );
        await click(`[data-test-card-catalog-go-button]`);
      });

      test<TestContextWithSave>('new card can enter edit mode', async function (assert) {
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
        await click('[data-test-create-new-card-button]');
        await fillIn('[data-test-search-field]', 'Skill');
        await click(
          `[data-test-select="https://cardstack.com/base/cards/skill"]`,
        );

        let id: string | undefined;
        this.onSave((url) => {
          id = url.href;
        });

        await click(`[data-test-card-catalog-go-button]`);
        await waitUntil(() => id);
        await click(`[data-test-edit-button]`);
        assert
          .dom(
            `[data-test-stack-card="${id}"] [data-test-card-format="isolated"]`,
          )
          .exists('new card is in isolated format');
        await click(`[data-test-edit-button]`);
        assert
          .dom(`[data-test-stack-card="${id}"] [data-test-card-format="edit"]`)
          .exists('new card is in edit format');
      });

      test<TestContextWithSave>('new linked card is created in a different realm than its consuming reference', async function (assert) {
        assert.expect(5);
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

        let consumerSaved = new Deferred<void>();
        let consumerSaveCount = 0;
        let newLinkId: string | undefined;
        this.onSave((url, doc) => {
          doc = doc as SingleCardDocument;
          if (url.href === `${testRealmURL}Person/fadhlan`) {
            consumerSaveCount++;
            if (consumerSaveCount === 1) {
              // the first time we save the consumer we set the relationship to null
              // as we are still waiting for the other realm to assign an ID to the new linked card
              assert.strictEqual(doc.included!.length, 1);
              assert.strictEqual(
                doc.included![0].id,
                `${testRealmURL}Pet/mango`,
                "the side loaded resources don't include the newly created card yet",
              );
            }
            if (consumerSaveCount === 2) {
              // as soon as the other realm assigns an id to the linked card we then
              // save the consumer with a relationship to the linked card's id
              assert.deepEqual(
                doc.data?.relationships?.['friends.1'],
                {
                  links: { self: newLinkId! },
                  data: { type: 'card', id: newLinkId! },
                },
                'the "friends.1" relationship was populated with the linked card\'s new id',
              );
              consumerSaved.fulfill();
            }
          }
          if (url.href.includes('Pet')) {
            newLinkId = url.href;
            assert.ok(
              url.href.startsWith(testRealm3URL),
              `The pet card is saved in the selected realm ${testRealm3URL}`,
            );
          }
        });
        await click('[data-test-add-new="friends"]');
        assert
          .dom(`[data-test-realm="Test Workspace C"] header`)
          .containsText('Test Workspace C No results');
        await click(
          `[data-test-card-catalog-create-new-button="${testRealm3URL}"]`,
        );
        await click(`[data-test-card-catalog-go-button]`);
        await consumerSaved.promise;
      });

      test<TestContextWithSave>('open a stack item of a new card instance when the "New Card of This Type" is clicked', async function (assert) {
        await visitOperatorMode({
          stacks: [
            [
              {
                id: `${testRealm2URL}`,
                format: 'isolated',
              },
            ],
          ],
        });

        assert.dom('[data-test-operator-mode-stack]').exists({ count: 1 });
        assert.dom('[data-test-stack-card-index]').exists({ count: 1 });
        await click('[data-test-boxel-filter-list-button="All Cards"]');
        await click('[data-test-more-options-button]');
        assert
          .dom('[data-test-boxel-menu-item-text="New Card of This Type"]')
          .doesNotExist();
        await click(
          `[data-cards-grid-item="${testRealm2URL}Pet/ringo"] .field-component-card`,
        );
        assert.dom('[data-test-stack-card-index]').exists({ count: 2 });

        await click('[data-test-more-options-button]');
        assert
          .dom('[data-test-boxel-menu-item-text="New Card of This Type"]')
          .exists();

        await click('[data-test-boxel-menu-item-text="New Card of This Type"]');
        assert.dom('[data-test-stack-card-index]').exists({ count: 3 });
        assert
          .dom(
            '[data-test-stack-card-index="2"] [data-test-card-format="edit"]',
          )
          .exists();
        assert
          .dom(
            '[data-test-stack-card-index="2"] [data-test-boxel-card-header-title]',
          )
          .containsText('Pet');
      });
    });

    module('1 stack, when the user lacks write permissions', function (hooks) {
      hooks.beforeEach(async function () {
        setRealmPermissions({
          [testRealmURL]: ['read'],
          [testRealm2URL]: ['read', 'write'],
        });
      });

      test('the edit button is hidden when the user lacks permissions', async function (assert) {
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
        assert.dom('[data-test-edit-button]').doesNotExist();
      });

      test('the card format components are informed whether it is editable', async function (assert) {
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

        assert
          .dom('[data-test-editable-meta]')
          .containsText('Mango is NOT editable');

        await visitOperatorMode({
          stacks: [
            [
              {
                id: `${testRealm2URL}Pet/ringo`,
                format: 'isolated',
              },
            ],
          ],
        });

        assert
          .dom('[data-test-editable-meta]')
          .containsText('Ringo is editable');

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
          .dom('[data-test-editable-meta]')
          .containsText('address is NOT editable');

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
          .dom("[data-test-contains-many='additionalAddresses'] input:enabled")
          .doesNotExist();

        assert
          .dom(
            "[data-test-contains-many='additionalAddresses'] [data-test-remove]",
          )
          .doesNotExist();
        assert
          .dom(
            "[data-test-contains-many='additionalAddresses'] [data-test-add-new]",
          )
          .doesNotExist();

        assert
          .dom("[data-test-field='pet'] [data-test-remove-card]")
          .doesNotExist();

        assert
          .dom("[data-test-field='friends'] [data-test-add-new]")
          .doesNotExist();
        assert
          .dom("[data-test-field='friends'] [data-test-remove-card]")
          .doesNotExist();

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

        assert
          .dom('[data-test-editable-meta]')
          .containsText('address is editable');

        await click('[data-test-operator-mode-stack] [data-test-edit-button]');
        assert
          .dom(
            "[data-test-contains-many='additionalAddresses'] [data-test-field='title'] input",
          )
          .doesNotExist();
        assert
          .dom(
            "[data-test-contains-many='additionalAddresses'] [data-test-field='title']",
          )
          .exists({ count: 1 });

        assert
          .dom(
            "[data-test-contains-many='additionalAddresses'] [data-test-remove]",
          )
          .exists();

        assert
          .dom(
            "[data-test-contains-many='additionalAddresses'] [data-test-add-new]",
          )
          .exists();

        assert.dom("[data-test-field='pet'] [data-test-remove-card]").exists();
        assert.dom("[data-test-field='friends'] [data-test-add-new]").exists();
        assert
          .dom("[data-test-field='friends'] [data-test-remove-card]")
          .exists();
      });

      test('card catalog create buttons respect realm write permissions for linksTo field', async function (assert) {
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

        await click('[data-test-stack-card-index="0"] [data-test-edit-button]');
        await click('[data-test-add-new="friends"]');

        await waitFor('[data-test-card-catalog]');
        await waitFor('[data-test-realm="Test Workspace A"]');
        await waitFor('[data-test-realm="Test Workspace B"]');

        assert
          .dom(`[data-test-card-catalog-create-new-button="${testRealm2URL}"]`)
          .exists('create button is shown for writable realm');

        assert
          .dom(`[data-test-card-catalog-create-new-button="${testRealmURL}"]`)
          .doesNotExist('create button is hidden for read-only realm');

        await triggerKeyEvent(
          '[data-test-card-catalog-modal]',
          'keydown',
          'Escape',
        );
        await waitFor('[data-test-card-catalog]', { count: 0 });
      });

      test('the delete item is not present in "..." menu of stack item', async function (assert) {
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
        await click('[data-test-more-options-button]');
        assert
          .dom('[data-test-boxel-menu-item-text="Delete"]')
          .doesNotExist('delete menu item is not rendered');
      });

      test('the "..."" menu does not exist for card overlay in index view (since delete is the only item in this menu)', async function (assert) {
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
        assert
          .dom(
            `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-more-options]`,
          )
          .doesNotExist('"..." menu does not exist');
      });

      test('embedded card from read-only realm does not show pencil icon in edit mode', async (assert) => {
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
          .dom(`[data-test-overlay-card="${testRealmURL}Pet/mango"]`)
          .exists();
        assert
          .dom(
            `[data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-edit]`,
          )
          .doesNotExist('edit icon not displayed for linked card');
        await click(
          `[data-test-links-to-editor="pet"] [data-test-field-component-card]`,
        );
        assert
          .dom(
            `[data-test-stack-card="${testRealmURL}Pet/mango"] [data-test-card-format="isolated"]`,
          )
          .exists(
            'linked card now rendered as a stack item in isolated (non-edit) format',
          );
      });
    });

    module('2 stacks with differing permissions', function (hooks) {
      hooks.beforeEach(async function () {
        setRealmPermissions({
          [testRealmURL]: ['read'],
          [testRealm2URL]: ['read', 'write'],
        });
      });

      test('the edit button respects the realm permissions of the cards in differing realms', async function (assert) {
        assert.expect(6);
        await visitOperatorMode({
          stacks: [
            [
              {
                id: `${testRealmURL}Pet/mango`,
                format: 'isolated',
              },
            ],
            [
              {
                id: `${testRealm2URL}Pet/ringo`,
                format: 'isolated',
              },
            ],
          ],
        });

        let didAssertAuth = false;
        getService('network').mount(
          async (req) => {
            let shouldAssertAuth =
              !didAssertAuth &&
              req.url.startsWith(testRealm2URL) &&
              ['POST', 'PATCH'].includes(req.method);
            if (shouldAssertAuth) {
              let token = req.headers.get('Authorization');
              assert.notStrictEqual(token, null);

              let claims = claimsFromRawToken(token!);
              assert.deepEqual(claims.user, '@testuser:localhost');
              assert.strictEqual(claims.realm, 'http://test-realm/test2/');
              assert.deepEqual(claims.permissions, ['read', 'write']);
              didAssertAuth = true;
            }
            return null;
          },
          { prepend: true },
        );

        assert
          .dom('[data-test-operator-mode-stack="0"] [data-test-edit-button]')
          .doesNotExist();
        assert
          .dom('[data-test-operator-mode-stack="1"] [data-test-edit-button]')
          .exists();
        await click(
          '[data-test-operator-mode-stack="1"] [data-test-edit-button]',
        );
        await fillIn(
          '[data-test-operator-mode-stack="1"] [data-test-field="name"] [data-test-boxel-input]',
          'Updated Ringo',
        );
        await click(
          '[data-test-operator-mode-stack="1"] [data-test-edit-button]',
        );
      });

      test('the delete item in "..." menu of stack item respects realm permissions of the cards in differing realms', async function (assert) {
        await visitOperatorMode({
          stacks: [
            [
              {
                id: `${testRealmURL}Pet/mango`,
                format: 'isolated',
              },
            ],
            [
              {
                id: `${testRealm2URL}Pet/ringo`,
                format: 'isolated',
              },
            ],
          ],
        });
        await click(
          '[data-test-operator-mode-stack="0"] [data-test-more-options-button]',
        );
        assert
          .dom('[data-test-boxel-menu-item-text="Delete"]')
          .doesNotExist('delete menu item is not rendered');

        await click(
          '[data-test-operator-mode-stack="1"] [data-test-more-options-button]',
        );
        assert
          .dom('[data-test-boxel-menu-item-text="Delete"]')
          .exists('delete menu is rendered');
      });

      test('the "..."" menu for card overlay in index view respects realm permissions of cards in differing realms', async function (assert) {
        await visitOperatorMode({
          stacks: [
            [
              {
                id: `${testRealmURL}index`,
                format: 'isolated',
              },
            ],
            [
              {
                id: `${testRealm2URL}index`,
                format: 'isolated',
              },
            ],
          ],
        });
        assert
          .dom(
            `[data-test-operator-mode-stack="0"] [data-test-overlay-card="${testRealmURL}Pet/mango"] [data-test-overlay-more-options]`,
          )
          .doesNotExist('"..." menu does not exist');

        await click(
          '[data-test-operator-mode-stack="0"] [data-test-boxel-filter-list-button="All Cards"]',
        );
        await click(
          '[data-test-operator-mode-stack="1"] [data-test-boxel-filter-list-button="All Cards"]',
        );
        await triggerEvent(
          `[data-test-operator-mode-stack="1"] [data-test-cards-grid-item="${testRealm2URL}Pet/ringo"] .field-component-card`,
          'mouseenter',
        );
        assert
          .dom(
            `[data-test-operator-mode-stack="1"] [data-test-overlay-card="${testRealm2URL}Pet/ringo"] [data-test-overlay-more-options]`,
          )
          .exists('"..." menu exists');
      });
    });

    module('workspace index card', function () {
      test('cannot be deleted', async function (assert) {
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
        await click('[data-test-more-options-button]');
        assert.dom('[data-test-boxel-menu-item-text="Delete"]').doesNotExist();
      });

      test('opens index card when non-index card is closed and workspace chooser opens when index card is closed', async function (assert) {
        // Start with a non-index card in the stack
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

        // Verify the non-index card is displayed
        assert.dom('[data-test-stack-card-index="0"]').includesText('Fadhlan');
        assert.dom('[data-test-workspace-chooser]').doesNotExist();

        // Close the non-index card
        await click(
          '[data-test-stack-card-index="0"] [data-test-close-button]',
        );

        // Verify that an index card is automatically added to the stack
        assert.dom('[data-test-stack-card-index="0"]').exists();
        assert
          .dom(
            '[data-test-stack-card-index="0"] [data-test-boxel-card-header-title]',
          )
          .hasText('Workspace - Test Workspace B');
        assert.dom('[data-test-workspace-chooser]').doesNotExist();

        // Close the index card
        await click(
          '[data-test-stack-card-index="0"] [data-test-close-button]',
        );

        // Verify that the workspace chooser opens
        await waitFor('[data-test-workspace-chooser]');
        assert.dom('[data-test-workspace-chooser]').exists();
        assert.dom('[data-test-operator-mode-stack]').doesNotExist();
      });

      test('does not display highlights filter for non-personal realms', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: `${testRealmURL}index`, format: 'isolated' }]],
        });

        assert
          .dom('[data-test-boxel-filter-list-button="Highlights"]')
          .doesNotExist();
        assert.dom('[data-test-selected-filter="All Cards"]').exists();
        assert.dom('[data-test-highlights-layout]').doesNotExist();
      });

      test('displays highlights filter with special layout and community cards', async function (assert) {
        setActiveRealms([
          testRealmURL,
          testRealm2URL,
          testRealm3URL,
          personalRealmURL,
        ]);
        await visitOperatorMode({
          stacks: [[{ id: `${personalRealmURL}index`, format: 'isolated' }]],
          selectAllCardsFilter: false,
        });

        assert.dom('[data-test-selected-filter="Highlights"]').exists();
        assert.dom('[data-test-highlights-layout]').exists();

        // Verify the NEW FEATURE section with AI App Generator
        assert
          .dom('[data-test-section-header="new-feature"]')
          .containsText('NEW FEATURE');
        assert
          .dom('[data-test-highlights-card-container="ai-app-generator"]')
          .exists();
        assert
          .dom(
            '[data-test-card="https://cardstack.com/base/ai-app-generator"] textarea',
          )
          .hasValue(
            'Create a sprint-planning tool that lets users define backlogs, estimate stories, assign owners, and track burndown.',
          );
        await click('[data-test-boxel-button][title="About Me"]');
        assert
          .dom(
            '[data-test-card="https://cardstack.com/base/ai-app-generator"] textarea',
          )
          .hasValue(
            'Build a personal portfolio page with your background, skills, and contact information',
          );
        await click('[data-test-create-this-for-me]');
        await waitFor('[data-test-room-settled]');
        assertMessages(assert, [
          {
            from: 'testuser',
            message:
              'Build a personal portfolio page with your background, skills, and contact information',
            cards: [
              {
                id: `${personalRealmURL}index`,
                title: 'Test Personal Workspace',
              },
            ],
          },
        ]);
        assert
          .dom('[data-test-llm-mode-option="act"]')
          .hasClass('selected', 'LLM mode starts in act mode');

        // Verify the GETTING STARTED section with Welcome to Boxel
        assert
          .dom('[data-test-section-header="getting-started"]')
          .containsText('GETTING STARTED');
        assert
          .dom('[data-test-highlights-card-container="welcome-to-boxel"]')
          .exists();

        // Verify the JOIN THE COMMUNITY section
        assert.dom('[data-test-highlights-section="join-community"]').exists();

        // Verify that the specific sections are displayed
        assert.dom('[data-test-highlights-section]').exists({ count: 3 });
        assert
          .dom('[data-test-highlights-card-container]')
          .exists({ count: 2 }); // AI App Generator and Welcome to Boxel

        // Verify social media links exist
        assert.dom('[data-test-community-link]').exists({ count: 4 }); // Discord, Twitter, YouTube, Reddit

        // Take a snapshot of the highlights layout
        await click('[data-test-close-ai-assistant]');
        await percySnapshot(assert);

        // Verify the community cards have the correct content
        assert
          .dom('[data-test-community-title="Discord"]')
          .containsText('Discord');
        assert
          .dom('[data-test-community-title="Twitter"]')
          .containsText('Twitter');
        assert
          .dom('[data-test-community-title="YouTube"]')
          .containsText('YouTube');
        assert
          .dom('[data-test-community-title="Reddit"]')
          .containsText('Reddit');

        // Verify the filter icon is displayed
        assert.dom('.content-icon').exists();

        // Verify the content header has the border bottom
        assert
          .dom('.content-header')
          .hasStyle({ 'border-bottom': '1px solid rgb(226, 226, 226)' });

        // Test switching to "All Cards" filter to verify highlights layout is hidden
        await click('[data-test-boxel-filter-list-button="All Cards"]');
        assert.dom('[data-test-highlights-layout]').doesNotExist();
        assert.dom('[data-test-section-header]').doesNotExist();
        assert.dom('[data-test-community-link]').doesNotExist();

        // Switch back to Highlights filter
        await click('[data-test-boxel-filter-list-button="Highlights"]');
        assert.dom('[data-test-highlights-layout]').exists();
        assert.dom('[data-test-section-header]').exists({ count: 3 });
        assert.dom('[data-test-community-link]').exists({ count: 4 });
      });

      test('sends typed prompt to ask ai when creating app', async function (assert) {
        await visitOperatorMode({
          stacks: [[{ id: `${personalRealmURL}index`, format: 'isolated' }]],
          selectAllCardsFilter: false,
        });

        await click('[data-test-boxel-button][title="About Me"]');
        let typedPrompt =
          'Design a travel planner dashboard that tracks itineraries, bookings, and budgets';

        await fillIn(
          '[data-test-card="https://cardstack.com/base/ai-app-generator"] textarea',
          typedPrompt,
        );
        assert
          .dom(
            '[data-test-card="https://cardstack.com/base/ai-app-generator"] textarea',
          )
          .hasValue(typedPrompt);

        await click('[data-test-create-this-for-me]');
        await waitFor('[data-test-room-settled]');
        assertMessages(assert, [
          {
            from: 'testuser',
            message: typedPrompt,
            cards: [
              {
                id: `${personalRealmURL}index`,
                title: 'Test Personal Workspace',
              },
            ],
          },
        ]);
      });
    });
  },
);
