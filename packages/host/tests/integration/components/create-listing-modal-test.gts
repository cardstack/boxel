import { click, waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import { testRealmURL, testRRI } from '../../helpers';
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
      codeRef: {
        module: testRRI('pet'),
        name: 'Pet',
      },
      targetRealm: testRealmURL,
      declarationKind: 'card',
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
      codeRef: {
        module: testRRI('pet'),
        name: 'Pet',
      },
      targetRealm: testRealmURL,
      declarationKind: 'card',
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
      codeRef: {
        module: testRRI('pet'),
        name: 'Pet',
      },
      targetRealm: testRealmURL,
      declarationKind: 'card',
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
      codeRef: {
        module: testRRI('pet'),
        name: 'Pet',
      },
      targetRealm: testRealmURL,
      declarationKind: 'card',
    });

    await waitFor('[data-test-create-listing-modal]');
    await waitFor('[data-test-create-listing-examples]');

    assert.dom('[data-test-create-listing-examples]').exists();
    assert.dom('[data-test-choose-examples-button]').hasText('Add Examples');
  });

  test('shows selected example atom when opened from an instance', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    ctx.operatorModeStateService.showCreateListingModal({
      codeRef: {
        module: testRRI('pet'),
        name: 'Pet',
      },
      targetRealm: testRealmURL,
      openCardIds: [rri(`${testRealmURL}Pet/mango`)],
      declarationKind: 'card',
    });

    await waitFor('[data-test-create-listing-modal]');
    await waitFor(`[data-test-selected-example="${testRealmURL}Pet/mango"]`);

    assert
      .dom(`[data-test-selected-example="${testRealmURL}Pet/mango"]`)
      .exists();
    assert
      .dom('[data-test-selected-examples] [data-test-card-format="atom"]')
      .exists({ count: 1 });
    assert
      .dom(`[data-test-selected-example-remove="${testRealmURL}Pet/mango"]`)
      .exists();
    assert.dom('[data-test-choose-examples-button]').hasText('Add Examples');
  });

  test('clicking a selected example remove icon removes it', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    ctx.operatorModeStateService.showCreateListingModal({
      codeRef: {
        module: testRRI('pet'),
        name: 'Pet',
      },
      targetRealm: testRealmURL,
      openCardIds: [rri(`${testRealmURL}Pet/mango`)],
      declarationKind: 'card',
    });

    await waitFor('[data-test-create-listing-modal]');
    await waitFor(
      `[data-test-selected-example-remove="${testRealmURL}Pet/mango"]`,
    );

    await click(
      `[data-test-selected-example-remove="${testRealmURL}Pet/mango"]`,
    );

    assert
      .dom(`[data-test-selected-example="${testRealmURL}Pet/mango"]`)
      .doesNotExist();
    assert.dom('[data-test-choose-examples-button]').hasText('Add Examples');
  });

  test('hides examples for field listings', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    ctx.operatorModeStateService.showCreateListingModal({
      codeRef: {
        module: testRRI('pet'),
        name: 'PetName',
      },
      targetRealm: testRealmURL,
      declarationKind: 'field',
    });

    await waitFor('[data-test-create-listing-modal]');

    assert.dom('[data-test-create-listing-examples]').doesNotExist();
    assert.dom('[data-test-choose-examples-button]').doesNotExist();
  });

  test('shows supporting cards row for a card type', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    ctx.operatorModeStateService.showCreateListingModal({
      codeRef: {
        module: testRRI('pet'),
        name: 'Pet',
      },
      targetRealm: testRealmURL,
      declarationKind: 'card',
    });

    await waitFor('[data-test-create-listing-modal]');
    await waitFor('[data-test-create-listing-supporting-cards]');

    assert.dom('[data-test-create-listing-supporting-cards]').exists();
    assert
      .dom('[data-test-create-listing-supporting-cards]')
      .includesText('not shown on the listing page');
    assert
      .dom('[data-test-selected-supporting-cards]')
      .doesNotExist('no supporting cards are preselected');
    assert
      .dom('[data-test-choose-supporting-cards-button]')
      .hasText('Add Supporting Cards');
  });

  test('hides supporting cards for field listings', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    ctx.operatorModeStateService.showCreateListingModal({
      codeRef: {
        module: testRRI('pet'),
        name: 'PetName',
      },
      targetRealm: testRealmURL,
      declarationKind: 'field',
    });

    await waitFor('[data-test-create-listing-modal]');

    assert.dom('[data-test-create-listing-supporting-cards]').doesNotExist();
    assert.dom('[data-test-choose-supporting-cards-button]').doesNotExist();
  });
});
