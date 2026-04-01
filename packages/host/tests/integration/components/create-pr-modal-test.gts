import { click, waitFor, waitUntil } from '@ember/test-helpers';
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
    assert.dom('[data-test-create-pr-modal]').includesText('Make a PR');
  });

  test('shows the listing pill in modal', async function (assert) {
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

    assert.dom('[data-test-create-pr-listing-name]').includesText('My Listing');
  });

  test('does not show change action when catalog chooser is unavailable', async function (assert) {
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

    assert.dom('[data-test-create-pr-change-listing-button]').doesNotExist();
  });

  test('does not show a separate realm field in modal', async function (assert) {
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

    assert.dom('[data-test-create-pr-realm]').doesNotExist();
  });

  test('cancel button dismisses the modal', async function (assert) {
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

    await click('[data-test-create-pr-cancel-button]');

    await waitUntil(
      () => !document.querySelector('[data-test-create-pr-modal]'),
    );
    assert.dom('[data-test-create-pr-modal]').doesNotExist();
    assert.strictEqual(
      ctx.operatorModeStateService.createPRModalPayload,
      undefined,
      'modal payload is cleared after cancel',
    );
  });

  test('submit shows success state', async function (assert) {
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

    await click('[data-test-create-pr-confirm-button]');

    await waitFor('[data-test-create-pr-success]');

    assert
      .dom('[data-test-create-pr-success]')
      .includesText('has been submitted for review.');
    assert.dom('[data-test-create-pr-done-button]').exists();
  });
});
