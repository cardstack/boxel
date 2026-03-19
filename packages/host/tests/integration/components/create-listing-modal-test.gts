import { waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import { testRealmURL } from '../../helpers';
import { renderComponent } from '../../helpers/render-component';

import { setupOperatorModeTests } from './operator-mode/setup';

module('Integration | components | create-listing-modal', function (hooks) {
  let ctx = setupOperatorModeTests(hooks);

  let noop = () => {};

  test('modal renders when payload is set', async function (assert) {
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

  test('shows example instances for a card type', async function (assert) {
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
    await waitFor('[data-test-examples-container]');

    assert.dom('[data-test-examples-container]').exists();
    assert
      .dom('[data-test-card-instance-picker]')
      .exists('shows the card instance picker for examples');
  });

  test('auto-selects the instance when opened from an instance', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    ctx.operatorModeStateService.showCreateListingModal({
      codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
      targetRealm: testRealmURL,
      openCardIds: [`${testRealmURL}Pet/mango`],
    });

    await waitFor('[data-test-create-listing-modal]');
    await waitFor('[data-test-card-instance-picker]');

    assert
      .dom('[data-test-boxel-picker-selected-item]')
      .exists('picker has a selected item');
    assert
      .dom('[data-test-boxel-picker-selected-item] .picker-selected-item__text')
      .hasText('Mango', 'the opened instance is auto-selected');
  });

  test('auto-selects the first instance when opened from a module', async function (assert) {
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
    await waitFor('[data-test-card-instance-picker]');

    assert
      .dom('[data-test-boxel-picker-selected-item]')
      .exists({ count: 1 }, 'picker has exactly one selected item');
    assert
      .dom('[data-test-boxel-picker-selected-item] .picker-selected-item__text')
      .exists('first instance is auto-selected');
  });
});
