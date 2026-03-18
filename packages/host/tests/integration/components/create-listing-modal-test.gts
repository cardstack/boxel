import { click, waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import { testRealmURL } from '../../helpers';
import { renderComponent } from '../../helpers/render-component';

import { setupOperatorModeTests } from './operator-mode/setup';

module('Integration | components | create-listing-modal', function (hooks) {
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

    ctx.operatorModeStateService.showCreateListingModal({
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

    ctx.operatorModeStateService.showCreateListingModal({
      codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
      targetRealm: testRealmURL,
    });

    await waitFor('[data-test-create-listing-modal]');

    assert
      .dom('[data-test-create-listing-target-realm]')
      .includesText(ctx.realmName);
  });

  test('shows codeRef in modal', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    ctx.operatorModeStateService.showCreateListingModal({
      codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
      targetRealm: testRealmURL,
    });

    await waitFor('[data-test-create-listing-modal]');

    assert.dom('[data-test-create-listing-coderef]').includesText('Pet');
  });

  test('cancel button closes modal', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    ctx.operatorModeStateService.showCreateListingModal({
      codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
      targetRealm: testRealmURL,
    });

    await waitFor('[data-test-create-listing-modal]');
    await click('[data-test-create-listing-cancel-button]');

    assert.dom('[data-test-create-listing-modal]').doesNotExist();
  });

  test('shows create button', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    ctx.operatorModeStateService.showCreateListingModal({
      codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
      targetRealm: testRealmURL,
    });

    await waitFor('[data-test-create-listing-modal]');

    assert
      .dom('[data-test-create-listing-confirm-button]')
      .includesText('Create');
    assert.dom('[data-test-create-listing-confirm-button]').isNotDisabled();
  });
});
