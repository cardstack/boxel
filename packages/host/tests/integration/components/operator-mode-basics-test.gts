import { click, fillIn, waitFor, waitUntil } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  percySnapshot,
  testRealmURL,
  type TestContextWithSave,
  withSlowSave,
} from '../../helpers';
import setupOperatorModeTest from '../../helpers/operator-mode-test-setup';
import { renderComponent } from '../../helpers/render-component';

module('Integration | operator-mode | basics and autosave', function (hooks) {
  let {
    noop,
    operatorModeStateService,
    setCardInOperatorModeState,
    testRealm,
  } = setupOperatorModeTest(hooks);

  test('it loads a card and renders its isolated view', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    assert
      .dom('[data-test-boxel-card-header-title]')
      .hasText('Person - Fadhlan');
    assert
      .dom(
        `[data-test-card-header-realm-icon="https://boxel-images.boxel.ai/icons/Letter-o.png"]`,
      )
      .exists();
    assert.dom('[data-test-person]').hasText('Fadhlan');
    assert.dom('[data-test-first-letter-of-the-name]').hasText('F');
    assert.dom('[data-test-city]').hasText('Bandung');
    assert.dom('[data-test-country]').hasText('Indonesia');
    assert.dom('[data-test-stack-card]').exists({ count: 1 });
    await waitFor('[data-test-pet="Mango"]');
    await click('[data-test-pet="Mango"]');
    await waitFor(`[data-test-stack-card="${testRealmURL}Pet/mango"]`);
    assert.dom('[data-test-stack-card]').exists({ count: 2 });
    assert.dom('[data-test-stack-card-index="1"]').includesText('Mango');
  });

  test('it renders a card with an error that has does not have a last known good state', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}FriendWithCSS/missing-link`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    assert
      .dom('[data-test-boxel-card-header-title]')
      .includesText('Link Not Found', 'card error title is displayed');
    assert
      .dom('[data-test-error-message]')
      .containsText(
        `missing file ${testRealmURL}FriendWithCSS/does-not-exist.json`,
      );
    await click('[data-test-toggle-details]');
    assert
      .dom('[data-test-error-details]')
      .containsText(`FriendWithCSS/does-not-exist.json not found`);
    assert
      .dom('[data-test-error-stack]')
      .containsText('at Realm.getSourceOrRedirect');
    assert.strictEqual(
      operatorModeStateService.state?.submode,
      'interact',
      'in interact mode',
    );
    await click('[data-test-view-in-code-mode-button]');
    assert.strictEqual(
      operatorModeStateService.state?.submode,
      'code',
      'in code mode',
    );
    assert.strictEqual(
      operatorModeStateService.state?.codePath?.href,
      `${testRealmURL}FriendWithCSS/missing-link.json`,
      'codePath is correct',
    );
  });

  module(
    'card with an error that has a last known good state',
    function (hooks) {
      hooks.beforeEach(async function () {
        await testRealm.write(
          'FriendWithCSS/friend-a.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                name: 'Friend A',
              },
              relationships: {
                friend: {
                  links: {
                    self: './does-not-exist',
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  module: '../friend-with-css.gts',
                  name: 'FriendWithCSS',
                },
              },
            },
          } as LooseSingleCardDocument),
        );
      });

      test('it renders a card with an error that has a last known good state', async function (assert) {
        setCardInOperatorModeState(`${testRealmURL}FriendWithCSS/friend-a`);
        await renderComponent(
          class TestDriver extends GlimmerComponent {
            <template>
              <OperatorMode @onClose={{noop}} />
            </template>
          },
        );

        assert
          .dom('[data-test-boxel-card-header-title]')
          .includesText('Link Not Found', 'card error title is displayed');
        assert
          .dom('[data-test-card-error]')
          .includesText(
            'Hassan has a friend Jade',
            'the last known good HTML is rendered',
          );

        // use percy snapshot to ensure the CSS has been applied--a red color
        await percySnapshot(assert);

        await click('[data-test-toggle-details]');
        assert
          .dom('[data-test-error-details]')
          .containsText(`FriendWithCSS/does-not-exist.json not found`);
        assert
          .dom('[data-test-error-stack]')
          .containsText('at Realm.getSourceOrRedirect');
        assert.strictEqual(
          operatorModeStateService.state?.submode,
          'interact',
          'in interact mode',
        );
        await click('[data-test-view-in-code-mode-button]');
        assert.strictEqual(
          operatorModeStateService.state?.submode,
          'code',
          'in code mode',
        );
        assert.strictEqual(
          operatorModeStateService.state?.codePath?.href,
          `${testRealmURL}FriendWithCSS/friend-a.json`,
          'codePath is correct',
        );
      });

      test('it has the ability to delete the card that has an error', async function (assert) {
        setCardInOperatorModeState(`${testRealmURL}FriendWithCSS/friend-a`);
        await renderComponent(
          class TestDriver extends GlimmerComponent {
            <template>
              <OperatorMode @onClose={{noop}} />
            </template>
          },
        );

        await click('[data-test-more-options-button]');
        await click('[data-test-boxel-menu-item-text="Delete Card"]');
        assert
          .dom('[data-test-delete-modal-container]')
          .includesText('Delete the card Hassan?');
        await click('[data-test-confirm-delete-button]');

        assert
          .dom(`[data-test-stack-card="${testRealmURL}FriendWithCSS/friend-a"]`)
          .doesNotExist();
        assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();
      });
    },
  );

  test<TestContextWithSave>('it auto saves the field value', async function (assert) {
    assert.expect(7);
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor('[data-test-person]');
    await click('[data-test-edit-button]');
    let finishedSaving = false;
    this.onSave((_, json) => {
      if (typeof json === 'string') {
        throw new Error('expected JSON save data');
      }
      finishedSaving = true;
      assert.strictEqual(json.data.attributes?.firstName, 'EditedName');
    });
    // not awaiting so that we can test in-between the test waiter
    fillIn(
      '[data-test-field="firstName"] [data-test-boxel-input]',
      'EditedName',
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() === 'Saving…',
      { timeout: 5000 },
    );
    assert.dom('[data-test-auto-save-indicator]').containsText('Saving…');
    assert.false(finishedSaving, 'save in-flight message is correct');
    await waitUntil(() => finishedSaving, { timeout: 10000 });
    assert.true(finishedSaving, 'finished saving message is correct');
    await waitFor('[data-test-last-saved]');
    assert.dom('[data-test-last-saved]').containsText('Saved');

    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await waitFor('[data-test-person="EditedName"]');
    assert.dom('[data-test-person]').hasText('EditedName');
    assert.dom('[data-test-first-letter-of-the-name]').hasText('E');
  });

  test<TestContextWithSave>('it does not auto save when exiting edit mode when there are no changes made', async function (assert) {
    // note that because of the test waiters we can't do the inverse of this
    // test because it is impossible to tell the difference between a normal
    // autosave and an auto save as a result of clicking on the edit button since
    // the test waiters include the auto save async.
    assert.expect(0);
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor('[data-test-person]');
    await click('[data-test-edit-button]');
    this.onSave(() => {
      assert.ok(false, 'does not save when file is not changed');
    });
    await click('[data-test-edit-button]');
  });

  test<TestContextWithSave>('it does not wait for save to complete before switching from edit to isolated mode', async function (assert) {
    assert.expect(2);
    let cardId = `${testRealmURL}Person/fadhlan`;
    setCardInOperatorModeState(cardId);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor('[data-test-person]');
    await click('[data-test-edit-button]');
    let finishedSaving = false;
    this.onSave(() => {
      finishedSaving = true;
    });
    // slow down the save so we can make sure that the format switch is
    // not tied to the save completion
    await withSlowSave(3000, async () => {
      // intentionally not awaiting the fillIn so we can ignore the test waiters
      fillIn('[data-test-field="firstName"] input', 'FadhlanX');
      // intentionally not awaiting the click so we can ignore the test waiters
      click('[data-test-edit-button]');
      await waitUntil(
        () =>
          operatorModeStateService.state.stacks.some((stack) =>
            stack.some(
              (item) => item.id === cardId && item.format === 'isolated',
            ),
          ),
        { timeout: 10000 },
      );
      assert.false(
        finishedSaving,
        'the view switches to isolated while save is still in flight',
      );
      await waitUntil(() => finishedSaving, { timeout: 10000 });
      assert.true(finishedSaving, 'save eventually completes');
    });
  });

  test('an error in auto-save is handled gracefully', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}BoomPet/paper`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor('[data-test-pet]');
    await waitFor('[data-test-edit-button]');
    await click('[data-test-edit-button]');
    fillIn('[data-test-field="boom"] input', 'Bad cat!');
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() == 'Saving…',
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() == 'Failed to save: Boom!',
    );
    await click('[data-test-edit-button]');
    // TODO consider adding a mechanism to go back to edit mode in order to try to fix the error with edit template
    assert
      .dom('[data-test-card-error]')
      .exists('last known good state is displayed in isolated mode');
  });

  test('a 403 from Web Application Firewall is handled gracefully when auto-saving', async function (assert) {
    let networkService = getService('network');
    networkService.virtualNetwork.mount(
      async (req: Request) => {
        if (req.method === 'PATCH' && req.url.includes('test/Pet/buzz')) {
          return new Response(
            '{ message: "Request blocked by Web Application Firewall. See x-blocked-by-waf-rule response header for detail." }',
            {
              status: 403,
              headers: {
                'Content-Type': 'application/json',
                'X-Blocked-By-WAF-Rule': 'CrossSiteScripting_BODY',
              },
            },
          );
        }
        return null;
      },
      { prepend: true },
    );
    setCardInOperatorModeState(`${testRealmURL}Pet/buzz`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor('[data-test-field="name"]');
    await waitFor('[data-test-edit-button]');
    await click('[data-test-edit-button]');
    fillIn('[data-test-field="name"] input', 'Fuzz');
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() == 'Saving…',
      { timeoutMessage: 'Waiting for Saving... to appear' },
    );
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-auto-save-indicator]')
          ?.textContent?.trim() == 'Failed to save: Rejected by firewall',
      { timeoutMessage: 'Waiting for "Failed to save" to appear' },
    );
    assert
      .dom('[data-test-auto-save-indicator]')
      .containsText('Failed to save: Rejected by firewall');
  });

  test('opens workspace chooser after closing the only remaining card on the stack', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    await waitFor('[data-test-person]');
    assert.dom('[data-test-person]').isVisible();

    await click('[data-test-close-button]');
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
      .doesNotExist();
    assert.dom(`[data-test-stack-card="${testRealmURL}index"]`).exists();
    await percySnapshot(assert);
  });
});
