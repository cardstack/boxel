import { click, waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import { testRealmURL } from '../../helpers';
import { renderComponent } from '../../helpers/render-component';

import { setupOperatorModeTests } from './operator-mode/setup';

module(
  'Integration | components | create-listing-modal',
  function (hooks) {
    let ctx = setupOperatorModeTests(hooks);

    let noop = () => {};

    test('modal is hidden by default', async function (assert) {
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );

      assert.dom('[data-test-create-listing-modal]').doesNotExist();
    });

    test('modal renders when request is set', async function (assert) {
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );

      ctx.operatorModeStateService.openCreateListingModal({
        codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
        targetRealm: testRealmURL,
      });

      await waitFor('[data-test-create-listing-modal]');

      assert.dom('[data-test-create-listing-modal]').exists();
      assert
        .dom('[data-test-create-listing-modal]')
        .includesText('Create Listing');
    });

    test('shows target realm name', async function (assert) {
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );

      ctx.operatorModeStateService.openCreateListingModal({
        codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
        targetRealm: testRealmURL,
      });

      await waitFor('[data-test-create-listing-modal]');

      assert
        .dom('[data-test-create-listing-target-realm]')
        .includesText(ctx.realmName);
    });

    test('source select defaults to definition when no openCardId', async function (assert) {
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );

      ctx.operatorModeStateService.openCreateListingModal({
        codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
        targetRealm: testRealmURL,
      });

      await waitFor('[data-test-create-listing-modal]');

      assert
        .dom(
          '.ember-power-select-trigger [data-test-create-listing-definition-option]',
        )
        .exists('definition option is selected in the trigger');
    });

    test('source select pre-selects instance when openCardId is provided', async function (assert) {
      let openCardId = `${testRealmURL}Pet/mango`;

      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );

      ctx.operatorModeStateService.openCreateListingModal({
        codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
        targetRealm: testRealmURL,
        openCardId,
      });

      await waitFor('[data-test-create-listing-modal]');

      assert
        .dom(
          `.ember-power-select-trigger [data-test-create-listing-instance-option="${openCardId}"]`,
        )
        .exists(
          'instance option matching openCardId is selected in the trigger',
        );
    });

    test('cancel button closes modal', async function (assert) {
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );

      ctx.operatorModeStateService.openCreateListingModal({
        codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
        targetRealm: testRealmURL,
      });

      await waitFor('[data-test-create-listing-modal]');
      await click('[data-test-create-listing-cancel-button]');

      assert.dom('[data-test-create-listing-modal]').doesNotExist();
    });

    test('shows error when listing creation fails', async function (assert) {
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template><OperatorMode @onClose={{noop}} /></template>
        },
      );

      // Provide an incomplete codeRef (missing 'module') so the create task
      // fails synchronously with a descriptive error message.
      ctx.operatorModeStateService.openCreateListingModal({
        codeRef: { name: 'Pet' } as any,
        targetRealm: testRealmURL,
      });

      await waitFor('[data-test-create-listing-modal]');
      await click('[data-test-create-listing-confirm-button]');

      await waitFor('[data-test-create-listing-error]');

      assert
        .dom('[data-test-create-listing-error]')
        .includesText('Cannot create listing without a resolved code ref');
    });
  },
);
