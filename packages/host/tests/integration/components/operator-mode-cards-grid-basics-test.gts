import { click, fillIn, waitFor, waitUntil } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import { Deferred } from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import {
  testRealmURL,
  type TestContextWithSave,
  withSlowSave,
} from '../../helpers';
import setupOperatorModeTest from '../../helpers/operator-mode-test-setup';
import { renderComponent } from '../../helpers/render-component';

module('Integration | operator-mode | cards grid basics', function (hooks) {
  let { noop, realmName, setCardInOperatorModeState } =
    setupOperatorModeTest(hooks);

  test('displays cards on cards-grid and includes `spec` instances', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor(`[data-test-cards-grid-item]`);

    assert.dom(`[data-test-stack-card-index="0"]`).exists();
    assert.dom(`[data-test-cards-grid-item]`).exists();

    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}BlogPost/1"] `)
      .includesText('Outer Space Journey');

    assert
      .dom(
        `[data-test-cards-grid-item="${testRealmURL}Spec/publishing-packet"]`,
      )
      .exists('publishing-packet spec is displayed on cards-grid');
    assert
      .dom(`[data-test-cards-grid-item="${testRealmURL}Spec/pet-room"]`)
      .exists('pet-room spec instance is displayed on cards-grid');
  });

  test<TestContextWithSave>('can optimistically create a card using the cards-grid', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let saved = new Deferred<void>();
    let savedCards = new Set<string>();
    this.onSave((url) => {
      savedCards.add(url.href);
      saved.fulfill();
    });

    // slow down the save so we can see the optimistic save at work
    await withSlowSave(1000, async () => {
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      assert.dom(`[data-test-stack-card-index="0"]`).exists();

      await click(`[data-test-boxel-filter-list-button="All Cards"]`);
      await click('[data-test-create-new-card-button]');
      assert
        .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
        .containsText('Choose a Spec card');
      await waitFor(
        `[data-test-card-catalog-item="${testRealmURL}Spec/publishing-packet"]`,
      );
      assert
        .dom(`[data-test-realm="${realmName}"] [data-test-card-catalog-item]`)
        .exists({ count: 3 });

      await click(`[data-test-select="${testRealmURL}Spec/publishing-packet"]`);
      // intentionally not awaiting the click so we can ignore the test waiters
      click('[data-test-card-catalog-go-button]');
      await waitFor('[data-test-stack-card-index="1"]');
      assert
        .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
        .exists();
      assert.strictEqual(
        savedCards.size,
        0,
        'the new card has not been saved yet',
      );
      await click(
        '[data-test-stack-card-index="1"] [data-test-more-options-button]',
      );
      await fillIn(`[data-test-field="cardInfo-name"] input`, 'New Post');
      await saved.promise;
      let packetId = [...savedCards].find((k) =>
        k.includes('PublishingPacket'),
      )!;
      setCardInOperatorModeState(packetId);

      await waitFor(`[data-test-stack-card="${packetId}"]`);
      assert.dom(`[data-test-stack-card="${packetId}"]`).exists();
    });
  });

  test('can open a card from the cards-grid and close it', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await waitFor(`[data-test-stack-card-index]`);
    assert.dom(`[data-test-stack-card-index="0"]`).exists();
    await click('[data-test-boxel-filter-list-button="All Cards"]');
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/burcu"] .field-component-card`,
    );

    await waitFor(`[data-test-stack-card-index="1"]`);
    assert.dom(`[data-test-stack-card-index="1"]`).exists();
    assert
      .dom(
        `[data-test-stack-card-index="1"] [data-test-boxel-card-header-title]`,
      )
      .includesText('Person');

    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="1"]', { count: 0 });
    assert.dom(`[data-test-stack-card-index="1"]`).doesNotExist();
  });

  test<TestContextWithSave>('create new card editor opens in the stack at each nesting level', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    assert.dom(`[data-test-stack-card-index="0"]`).exists();
    await click(`[data-test-boxel-filter-list-button="All Cards"]`);

    await click('[data-test-create-new-card-button]');
    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}Spec/publishing-packet"]`,
    );
    assert
      .dom('[data-test-card-catalog-modal] [data-test-boxel-header-title]')
      .containsText('Choose a Spec card');
    assert
      .dom(`[data-test-realm="${realmName}"] [data-test-card-catalog-item]`)
      .exists({ count: 3 });

    await click(`[data-test-select="${testRealmURL}Spec/publishing-packet"]`);
    await click('[data-test-card-catalog-go-button]');
    await waitFor('[data-test-stack-card-index="1"]');
    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
      .exists();

    await click('[data-test-add-new="blogPost"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-go-button]`);

    await waitFor(`[data-test-stack-card-index="2"]`);
    assert.dom('[data-test-stack-card-index]').exists({ count: 3 });
    assert
      .dom('[data-test-stack-card-index="2"] [data-test-field="authorBio"]')
      .exists();

    await fillIn(
      '[data-test-stack-card-index="2"] [data-test-field="title"] [data-test-boxel-input]',
      'Mad As a Hatter',
    );

    await click(
      '[data-test-stack-card-index="2"] [data-test-field="authorBio"] [data-test-add-new]',
    );
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-go-button]`);

    await waitFor(`[data-test-stack-card-index="3"]`);

    assert
      .dom('[data-test-field="firstName"] [data-test-boxel-input]')
      .exists();
    await fillIn(
      '[data-test-field="firstName"] [data-test-boxel-input]',
      'Alice',
    );
    let authorId = [...savedCards].find((k) => k.includes('Author'))!;
    await waitFor(
      `[data-test-stack-card-index="3"] [data-test-card="${authorId}"]`,
    );
    await fillIn(
      '[data-test-field="lastName"] [data-test-boxel-input]',
      'Enwunder',
    );

    await click('[data-test-stack-card-index="3"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="3"]', { count: 0 });

    await waitUntil(() =>
      /Alice\s*Enwunder/.test(
        document.querySelector(
          '[data-test-stack-card-index="2"] [data-test-field="authorBio"]',
        )!.textContent!,
      ),
    );

    await click('[data-test-stack-card-index="2"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="2"]', { count: 0 });
    let packetId = [...savedCards].find((k) => k.includes('PublishingPacket'))!;
    await waitFor(
      `[data-test-stack-card-index="1"] [data-test-card="${packetId}"]`,
    );
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="socialBlurb"] [data-test-boxel-input]',
      `Everyone knows that Alice ran the show in the Brady household. But when Alice’s past comes to light, things get rather topsy turvy…`,
    );
    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="blogPost"]')
      .containsText('Mad As a Hatter by Alice Enwunder');

    await click('[data-test-stack-card-index="1"] [data-test-edit-button]');

    await waitUntil(() => {
      return document
        .querySelector(
          `[data-test-stack-item-content] >[data-test-card="${packetId}"]`,
        )
        ?.textContent?.includes(
          'Everyone knows that Alice ran the show in the Brady household.',
        );
    });
  });
});
