import { waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import { testRealmURL } from '../../helpers';
import { renderComponent } from '../../helpers/render-component';

import { setupOperatorModeTests } from './operator-mode/setup';

module('Integration | components | create-pr-modal', function (hooks) {
  let ctx = setupOperatorModeTests(hooks);

  let noop = () => {};

  test('modal renders when payload is set', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    ctx.operatorModeStateService.showCreatePRModal({
      realm: testRealmURL,
      listingId: `${testRealmURL}Listing/1`,
      listingName: 'My Listing',
    });

    await waitFor('[data-test-create-pr-modal]');

    assert.dom('[data-test-create-pr-modal]').exists();
    assert
      .dom('[data-test-create-pr-modal]')
      .includesText('Make a PR');
  });

  test('shows listing name in modal', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    ctx.operatorModeStateService.showCreatePRModal({
      realm: testRealmURL,
      listingId: `${testRealmURL}Listing/1`,
      listingName: 'My Listing',
    });

    await waitFor('[data-test-create-pr-modal]');

    assert
      .dom('[data-test-create-pr-listing-name]')
      .includesText('My Listing');
  });

  test('shows realm info in modal', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    ctx.operatorModeStateService.showCreatePRModal({
      realm: testRealmURL,
      listingId: `${testRealmURL}Listing/1`,
      listingName: 'My Listing',
    });

    await waitFor('[data-test-create-pr-modal]');

    assert.dom('[data-test-create-pr-realm]').exists();
  });
});
