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
      .dom(`[data-test-create-listing-example="${testRealmURL}Pet/mango"]`)
      .exists('shows the Pet instance as an example');
    assert
      .dom(`[data-test-card-catalog-item-selected="true"]`)
      .exists('example is auto-selected');
  });
});
