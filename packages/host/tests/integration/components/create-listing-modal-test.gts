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

  test('modal renders when payload is set', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    ctx.operatorModeStateService.showCreateListingModal({
      codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
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
      codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
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
      codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
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
      codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
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
      codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
      targetRealm: testRealmURL,
      openCardIds: [`${testRealmURL}Pet/mango`],
      declarationKind: 'card',
    });

    await waitFor('[data-test-create-listing-modal]');
    await waitFor(
      `[data-test-selected-example="${testRealmURL}Pet/mango.json"]`,
    );

    assert
      .dom(`[data-test-selected-example="${testRealmURL}Pet/mango.json"]`)
      .exists();
    assert
      .dom('[data-test-selected-examples] [data-test-card-format="atom"]')
      .exists({ count: 1 });
    assert
      .dom(
        `[data-test-selected-example-remove="${testRealmURL}Pet/mango.json"]`,
      )
      .exists();
    assert
      .dom('[data-test-choose-examples-button]')
      .hasText('1 example selected');
  });

  test('clicking a selected example remove icon removes it', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    ctx.operatorModeStateService.showCreateListingModal({
      codeRef: { module: `${testRealmURL}pet`, name: 'Pet' },
      targetRealm: testRealmURL,
      openCardIds: [`${testRealmURL}Pet/mango`],
      declarationKind: 'card',
    });

    await waitFor('[data-test-create-listing-modal]');
    await waitFor(
      `[data-test-selected-example-remove="${testRealmURL}Pet/mango.json"]`,
    );

    await click(
      `[data-test-selected-example-remove="${testRealmURL}Pet/mango.json"]`,
    );

    assert
      .dom(`[data-test-selected-example="${testRealmURL}Pet/mango.json"]`)
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
      codeRef: { module: `${testRealmURL}pet`, name: 'PetName' },
      targetRealm: testRealmURL,
      declarationKind: 'field',
    });

    await waitFor('[data-test-create-listing-modal]');

    assert.dom('[data-test-create-listing-examples]').doesNotExist();
    assert.dom('[data-test-choose-examples-button]').doesNotExist();
  });
});
