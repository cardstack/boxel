import {
  waitFor,
  waitUntil,
  click,
  fillIn,
  triggerEvent,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import { testRealmURL } from '../../helpers';
import { renderComponent } from '../../helpers/render-component';

import { setupOperatorModeTests } from './operator-mode/setup';

import type { TestContextWithSave } from '../../helpers';

module('Integration | operator-mode | links', function (hooks) {
  let ctx = setupOperatorModeTests(hooks);

  let noop = () => {};

  test('can choose a card for a linksTo field that has an existing value', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="authorBio"]').containsText('Alien Bob');
    assert.dom('[data-test-add-new="authorBio"]').doesNotExist();

    await click('[data-test-remove-card]');
    assert.dom('[data-test-add-new="authorBio"]').exists();
    await click('[data-test-add-new="authorBio"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Author/2"]`);
    await click(`[data-test-select="${testRealmURL}Author/2"]`);
    assert
      .dom(
        `[data-test-card-catalog-item="${testRealmURL}Author/2"][data-test-card-catalog-item-selected]`,
      )
      .exists();

    await waitUntil(
      () =>
        (
          document.querySelector(`[data-test-card-catalog-go-button]`) as
            | HTMLButtonElement
            | undefined
        )?.disabled === false,
    );
    await click('[data-test-card-catalog-go-button]');

    await waitFor(`.operator-mode [data-test-author="R2-D2"]`);
    assert.dom('[data-test-field="authorBio"]').containsText('R2-D2');
  });

  test('can choose a card for a linksTo field that has no existing value', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-add-new="authorBio"]').exists();

    await click('[data-test-add-new="authorBio"]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Author/2"]`);
    await click(`[data-test-select="${testRealmURL}Author/2"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="authorBio"]').containsText('R2-D2');

    await click('[data-test-edit-button]');
    await waitFor('.operator-mode [data-test-blog-post-isolated]');

    assert
      .dom('.operator-mode [data-test-blog-post-isolated]')
      .hasText('Beginnings by R2-D2');
  });

  test<TestContextWithSave>('can create a new card to populate a linksTo field', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-add-new="authorBio"]').exists();

    await click('[data-test-add-new="authorBio"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-go-button]`);
    await waitFor('[data-test-stack-card-index="1"]');

    assert
      .dom('[data-test-stack-card-index="1"] [data-test-field="firstName"]')
      .exists();
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="firstName"] [data-test-boxel-input]',
      'Alice',
    );

    let authorId = [...savedCards].find((k) => k.includes('Author'))!;
    await waitFor(
      `[data-test-stack-card-index="1"] [data-test-card="${authorId}"]`,
    );

    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitFor('[data-test-stack-card-index="1"]', { count: 0 });
    assert.dom('[data-test-add-new="authorBio"]').doesNotExist();
    assert.dom('[data-test-field="authorBio"]').containsText('Alice');

    await click('[data-test-stack-card-index="0"] [data-test-edit-button]');
    assert.dom('[data-test-blog-post-isolated]').hasText('Beginnings by Alice');
  });

  test('can choose a card from a publicly readable realm to link to a card in the current realm', async function (assert) {
    ctx.setCardInOperatorModeState(
      `${testRealmURL}SpecCardLinker/spec-card-linker`,
    );
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(
      `[data-test-stack-card="${testRealmURL}SpecCardLinker/spec-card-linker"]`,
    );
    await click('[data-test-edit-button]');
    assert.dom('[data-test-add-new="spec"]').exists();

    await click('[data-test-add-new="spec"]');
    await waitFor(
      `[data-test-card-catalog-item="https://cardstack.com/base/fields/biginteger-field"]`,
    );
    await click(
      `[data-test-select="https://cardstack.com/base/fields/biginteger-field"]`,
    );
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));

    await click('[data-test-edit-button]');
    await waitFor('.operator-mode [data-test-spec-card-linker-isolated]');

    assert
      .dom('.operator-mode [data-test-spec-card-linker-isolated]')
      .hasText('The card is: Spec Card Linker Linked to: Bigint Field');
  });

  test('can remove the link for a linksTo field', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BlogPost/1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="authorBio"]').containsText('Alien Bob');
    await click('[data-test-field="authorBio"] [data-test-remove-card]');
    await click('[data-test-edit-button]');

    await waitFor('.operator-mode [data-test-blog-post-isolated]');
    assert
      .dom('.operator-mode [data-test-blog-post-isolated]')
      .hasText('Outer Space Journey by');
  });

  test('can add a card to a linksToMany field with existing values', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');
    assert.dom('[data-test-field="friends"] [data-test-add-new]').exists();

    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/mango"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert
      .dom('[data-test-field="friends"]')
      .containsText('Jackie Woody Buzz Mango');
    assert
      .dom(
        '[data-test-links-to-many="friends"] [data-test-card-format="fitted"]',
      )
      .exists({ count: 4 });
  });

  test('can add a card to a linksTo field creating a loop', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Friend/friend-b`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Friend/friend-b"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-field="friend"] [data-test-add-new]').exists();

    await click('[data-test-field="friend"] [data-test-add-new]');

    await waitFor(
      `[data-test-card-catalog-item="${testRealmURL}Friend/friend-a"]`,
    );
    await click(`[data-test-select="${testRealmURL}Friend/friend-a"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));

    assert
      .dom('[data-test-stack-card] [data-test-field="friend"]')
      .containsText('Friend A');

    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').exists();
    assert.dom('[data-test-submode-switcher]').hasText('Interact');

    await click(
      '[data-test-submode-switcher] .submode-switcher-dropdown-trigger',
    );
    await click('[data-test-boxel-menu-item-text="Code"]');
    await waitFor('[data-test-submode-switcher]');
    assert.dom('[data-test-submode-switcher]').hasText('Code');
  });

  test('can add a card to linksToMany field that has no existing values', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"] [data-test-pet]').doesNotExist();
    assert.dom('[data-test-add-new="friends"]').hasText('Add Pets');
    await click('[data-test-add-new="friends"]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/jackie"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="friends"]').containsText('Jackie');
  });

  test('can add a card to linksToMany field that has a null value for relationship', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/hassan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/hassan"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"] [data-test-pet]').doesNotExist();
    assert
      .dom('[data-test-field="friends"] [data-test-add-new]')
      .hasText('Add Pets');
    await click('[data-test-field="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/jackie"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="friends"]').containsText('Jackie');
  });

  test('can change the item selection in a linksToMany field', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');
    await click(
      '[data-test-links-to-many="friends"] [data-test-item="1"] [data-test-remove-card]',
    );
    assert.dom('[data-test-field="friends"]').containsText('Jackie');

    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-item="${testRealmURL}Pet/mango"]`);
    await click(`[data-test-select="${testRealmURL}Pet/mango"]`);
    await click('[data-test-card-catalog-go-button]');

    await waitUntil(() => !document.querySelector('[card-catalog-modal]'));
    assert.dom('[data-test-field="friends"]').containsText('Mango');
  });

  test<TestContextWithSave>('can create a new card to add to a linksToMany field from card chooser', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"] [data-test-pet]').doesNotExist();
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');

    await waitFor(`[data-test-card-catalog-modal]`);
    assert
      .dom('[data-test-card-catalog-create-new-button]')
      .hasText('Create New Pet');
    await click('[data-test-card-catalog-create-new-button]');
    await click(`[data-test-card-catalog-go-button]`);

    await waitFor(`[data-test-stack-card-index="1"]`);
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="name"] [data-test-boxel-input]',
      'Woodster',
    );
    let petId = [...savedCards].find((k) => k.includes('Pet'))!;
    await waitFor(
      `[data-test-stack-card-index="1"] [data-test-card="${petId}"]`,
    );
    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="1"]'),
    );
    assert.dom('[data-test-field="friends"]').containsText('Woodster');
  });

  test<TestContextWithSave>('does not create a new card to add to a linksToMany field from card chooser, if user cancel the edit view', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => savedCards.add(url.href));

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    await click('[data-test-edit-button]');

    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');
    await click('[data-test-links-to-many="friends"] [data-test-add-new]');

    await waitFor(`[data-test-card-catalog-modal]`);
    assert
      .dom('[data-test-card-catalog-create-new-button]')
      .hasText('Create New Pet');
    await click('[data-test-card-catalog-create-new-button]');
    await click(`[data-test-card-catalog-go-button]`);

    await waitFor(`[data-test-stack-card-index="1"]`);
    await fillIn(
      '[data-test-stack-card-index="1"] [data-test-field="name"] [data-test-boxel-input]',
      'Woodster',
    );
    let petId = [...savedCards].find((k) => k.includes('Pet'))!;
    await waitFor(
      `[data-test-stack-card-index="1"] [data-test-card="${petId}"]`,
    );
    await click('[data-test-stack-card-index="1"] [data-test-close-button]');
    await waitUntil(
      () => !document.querySelector('[data-test-stack-card-index="1"]'),
    );
    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');

    await click('[data-test-links-to-many="friends"] [data-test-add-new]');
    await waitFor(`[data-test-card-catalog-modal]`);
    assert
      .dom('[data-test-card-catalog-create-new-button]')
      .hasText('Create New Pet');
  });

  test('can remove all items of a linksToMany field', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/burcu`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item]`,
      )
      .exists({ count: 3 });
    await click('[data-test-edit-button]');
    assert.dom('[data-test-field="friends"]').containsText('Jackie Woody');

    await click(
      '[data-test-links-to-many="friends"] [data-test-item="1"] [data-test-remove-card]',
    );
    await click(
      '[data-test-links-to-many="friends"] [data-test-item="0"] [data-test-remove-card]',
    );
    await click(
      '[data-test-links-to-many="friends"] [data-test-item="0"] [data-test-remove-card]',
    );

    await click('[data-test-edit-button]');
    await waitFor(`[data-test-person="Burcu"]`);
    assert
      .dom(`[data-test-stack-card="${testRealmURL}Person/burcu"]`)
      .doesNotContainText('Jackie');
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item]`,
      )
      .doesNotExist();
  });

  test<TestContextWithSave>('New cards are optimistically created for a linksTo field', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}Person/1`, 'edit');
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    let savedCards = new Set<string>();
    this.onSave((url) => {
      savedCards.add(url.href);
    });
    await waitFor(`[data-test-stack-card="${testRealmURL}Person/1"]`);
    await waitFor('[data-test-links-to-editor="pet"] [data-test-remove-card]');
    await click('[data-test-links-to-editor="pet"] [data-test-remove-card]');
    await waitFor('[data-test-add-new="pet"]');
    assert.dom('[data-test-add-new="pet"]').exists();
    assert
      .dom('[data-test-links-to-editor="pet"] [data-test-boxel-card-container]')
      .doesNotExist();
    await click('[data-test-add-new="pet"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await waitFor(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    click(`[data-test-card-catalog-go-button]`);
    await waitFor('[data-test-stack-card-index="1"]');
    assert.deepEqual(
      [...savedCards],
      [`${testRealmURL}Person/1`],
      'linked card has not been saved yet',
    );
    await fillIn(
      `[data-test-stack-card-index="1"] [data-test-field="name"] input`,
      'Mango',
    );
    await click(`[data-test-stack-card-index="1"] [data-test-close-button]`);
    assert
      .dom(
        `[data-test-stack-card="${testRealmURL}Person/1"] [data-test-links-to-editor="pet"]`,
      )
      .containsText(
        'Mango',
        'the embedded link of new card is rendered correctly',
      );
    let ids = Array.from(savedCards);
    let paths = ids.map((url) => url.substring(testRealmURL.length) + '.json');
    let path = paths.find((p) => p.includes('Pet/'));
    let fileRef = await ctx.testRealmAdapter.openFile(path!);
    assert.deepEqual(
      JSON.parse(fileRef!.content as string),
      {
        data: {
          attributes: {
            name: 'Mango',
            cardInfo: {
              name: null,
              summary: null,
              cardThumbnailURL: null,
              notes: null,
            },
          },
          relationships: {
            'cardInfo.theme': {
              links: {
                self: null,
              },
            },
          },
          meta: {
            adoptsFrom: {
              module: '../pet',
              name: 'Pet',
            },
          },
          type: 'card',
        },
      },
      'file contents were saved correctly',
    );
  });

  test<TestContextWithSave>('Clicking on "Finish Editing" after creating a card from linksTo field will switch the card into isolated mode', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}BlogPost/2`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/2"]`);
    await click('[data-test-edit-button]');
    assert.dom('[data-test-add-new="authorBio"]').exists();
    await click('[data-test-add-new="authorBio"]');
    await waitFor(`[data-test-card-catalog-modal]`);
    await click(`[data-test-card-catalog-create-new-button]`);
    await click(`[data-test-card-catalog-go-button]`);
    await waitFor('[data-test-stack-card-index="1"]');

    await click('[data-test-stack-card-index="1"] [data-test-edit-button]');

    await waitFor('[data-test-isolated-author]');
    assert.dom('[data-test-isolated-author]').exists();
  });

  test('can reorder linksToMany cards in edit view without affecting other linksToMany cards', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/burcu"] .field-component-card`,
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item]`,
      )
      .exists({ count: 3 });
    assert
      .dom(`[data-test-plural-view-field="cars"] [data-test-plural-view-item]`)
      .exists({ count: 2 });

    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item="0"]`,
      )
      .hasText('Jackie');
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item="1"]`,
      )
      .hasText('Woody');
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item="2"]`,
      )
      .hasText('Buzz');

    await click(
      `[data-test-stack-card="${testRealmURL}Person/burcu"] [data-test-edit-button]`,
    );
    assert
      .dom('[data-test-list="friends"] [data-test-item]')
      .exists({ count: 3 });

    assert
      .dom(
        `[data-test-list="friends"] [data-test-item="0"] [data-test-card="${testRealmURL}Pet/jackie"]`,
      )
      .exists();
    assert
      .dom(`[data-test-list="friends"] [data-test-item="0"]`)
      .hasText('Jackie');
    assert
      .dom(
        `[data-test-list="friends"] [data-test-item="1"] [data-test-card="${testRealmURL}Pet/woody"]`,
      )
      .exists();
    assert
      .dom(`[data-test-list="friends"] [data-test-item="1"]`)
      .hasText('Woody');
    assert
      .dom(
        `[data-test-list="friends"] [data-test-item="2"] [data-test-card="${testRealmURL}Pet/buzz"]`,
      )
      .exists();
    assert
      .dom(`[data-test-list="friends"] [data-test-item="2"]`)
      .hasText('Buzz');

    assert.dom('[data-test-list="cars"] [data-test-item]').exists({ count: 2 });
    assert.dom(`[data-test-list="cars"] [data-test-item="0"]`).hasText('Myvi');
    assert
      .dom(`[data-test-list="cars"] [data-test-item="1"]`)
      .hasText('Proton');

    let dragAndDrop = async (itemSelector: string, targetSelector: string) => {
      let itemElement = document.querySelector(itemSelector);
      let targetElement = document.querySelector(targetSelector);

      if (!itemElement || !targetElement) {
        throw new Error('Item or target element not found');
      }

      let itemRect = itemElement.getBoundingClientRect();
      let targetRect = targetElement.getBoundingClientRect();

      await triggerEvent(itemElement, 'mousedown', {
        clientX: itemRect.left + itemRect.width / 2,
        clientY: itemRect.top + itemRect.height / 2,
      });

      await triggerEvent(document, 'mousemove', {
        clientX: itemRect.left + 1,
        clientY: itemRect.top + 1,
      });

      let firstStackItemHeaderRect = document
        .querySelector('[data-test-operator-mode-stack="0"] header')!
        .getBoundingClientRect();
      let firstStackItemPaddingTop = getComputedStyle(
        document.querySelector('[data-test-operator-mode-stack="0"]')!,
      )
        .getPropertyValue('padding-top')
        .replace('px', '');
      let marginTop =
        firstStackItemHeaderRect.height + Number(firstStackItemPaddingTop);
      await triggerEvent(document, 'mousemove', {
        clientX: targetRect.left + targetRect.width / 2,
        clientY: targetRect.top - marginTop,
      });

      await triggerEvent(itemElement, 'mouseup', {
        clientX: targetRect.left + targetRect.width / 2,
        clientY: targetRect.top - marginTop,
      });
    };
    await dragAndDrop('[data-test-sort="1"]', '[data-test-sort="0"]');
    await dragAndDrop('[data-test-sort="2"]', '[data-test-sort="1"]');
    assert
      .dom('[data-test-list="friends"] [data-test-item]')
      .exists({ count: 3 });
    assert
      .dom(
        `[data-test-list="friends"] [data-test-item="0"] [data-test-card="${testRealmURL}Pet/woody"]`,
      )
      .exists();
    assert
      .dom(`[data-test-list="friends"] [data-test-item="0"]`)
      .hasText('Woody');
    assert
      .dom(
        `[data-test-list="friends"] [data-test-item="1"] [data-test-card="${testRealmURL}Pet/buzz"]`,
      )
      .exists();
    assert
      .dom(`[data-test-list="friends"] [data-test-item="1"]`)
      .hasText('Buzz');
    assert
      .dom(
        `[data-test-list="friends"] [data-test-item="2"] [data-test-card="${testRealmURL}Pet/jackie"]`,
      )
      .exists();
    assert
      .dom(`[data-test-list="friends"] [data-test-item="2"]`)
      .hasText('Jackie');

    await triggerEvent(`[data-test-item="0"]`, 'mouseenter');
    let itemElement = document.querySelector(
      `[data-test-list="friends"] [data-test-item="0"]`,
    );
    let overlayButtonElements = document.querySelectorAll(
      `[data-test-card="${testRealmURL}Pet/woody"]`,
    );
    if (
      !itemElement ||
      !overlayButtonElements ||
      overlayButtonElements.length === 0
    ) {
      throw new Error('Item or overlay button element not found');
    }

    let itemRect = itemElement.getBoundingClientRect();
    let overlayButtonRect =
      overlayButtonElements[
        overlayButtonElements.length - 1
      ].getBoundingClientRect();

    let verticalDiff = Math.abs(
      Math.round(itemRect.top) - Math.round(overlayButtonRect.top),
    );
    assert.ok(
      verticalDiff <= 1,
      `overlay button aligns vertically within 1px (diff=${verticalDiff}px)`,
    );

    let iconWidth = 30;
    let gap = 9;
    let expectedLeft = Math.floor(itemRect.left + (iconWidth + gap) / 2);
    let horizontalDiff = Math.abs(
      expectedLeft - Math.floor(overlayButtonRect.left),
    );
    assert.ok(
      horizontalDiff <= 1,
      `overlay button aligns horizontally within 1px (diff=${horizontalDiff}px)`,
    );

    await click(
      `[data-test-stack-card="${testRealmURL}Person/burcu"] [data-test-edit-button]`,
    );
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item="0"]`,
      )
      .hasText('Woody');
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item="1"]`,
      )
      .hasText('Buzz');
    assert
      .dom(
        `[data-test-plural-view-field="friends"] [data-test-plural-view-item="2"]`,
      )
      .hasText('Jackie');

    assert
      .dom(
        `[data-test-plural-view-field="cars"] [data-test-plural-view-item="0"]`,
      )
      .hasText('Myvi');
    assert
      .dom(
        `[data-test-plural-view-field="cars"] [data-test-plural-view-item="1"]`,
      )
      .hasText('Proton');
  });

  test('can reorder containsMany cards in edit view without affecting other containsMany cards', async function (assert) {
    ctx.setCardInOperatorModeState(`${testRealmURL}grid`);

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await click(`[data-test-boxel-filter-list-button="All Cards"]`);
    await waitFor(`[data-test-cards-grid-item]`);
    await click(
      `[data-test-cards-grid-item="${testRealmURL}Person/burcu"] .field-component-card`,
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
    assert
      .dom(
        `[data-test-plural-view-field="nicknames"] [data-test-plural-view-item]`,
      )
      .exists({ count: 3 });
    assert
      .dom(
        `[data-test-plural-view-field="favoriteGames"] [data-test-plural-view-item]`,
      )
      .exists({ count: 2 });
    assert.dom(`[data-test-plural-view-field="nicknames"]`).containsText('Ace');
    assert
      .dom(`[data-test-plural-view-field="nicknames"]`)
      .containsText('Bolt');
    assert
      .dom(`[data-test-plural-view-field="nicknames"]`)
      .containsText('Comet');
    assert
      .dom(`[data-test-plural-view-field="favoriteGames"]`)
      .containsText('Chess');
    assert
      .dom(`[data-test-plural-view-field="favoriteGames"]`)
      .containsText('Go');

    await click(
      `[data-test-stack-card="${testRealmURL}Person/burcu"] [data-test-edit-button]`,
    );
    document
      .querySelector('[data-test-list="nicknames"]')
      ?.scrollIntoView({ block: 'center' });

    assert
      .dom('[data-test-list="nicknames"] [data-test-item]')
      .exists({ count: 3 });
    assert
      .dom('[data-test-list="favoriteGames"] [data-test-item]')
      .exists({ count: 2 });

    assert
      .dom(`[data-test-list="nicknames"] [data-test-item="0"] input`)
      .hasValue('Ace');
    assert
      .dom(`[data-test-list="nicknames"] [data-test-item="1"] input`)
      .hasValue('Bolt');
    assert
      .dom(`[data-test-list="nicknames"] [data-test-item="2"] input`)
      .hasValue('Comet');

    assert
      .dom(`[data-test-list="favoriteGames"] [data-test-item="0"] input`)
      .hasValue('Chess');
    assert
      .dom(`[data-test-list="favoriteGames"] [data-test-item="1"] input`)
      .hasValue('Go');

    let dragAndDrop = async (itemSelector: string, targetSelector: string) => {
      let itemElement = document.querySelector(itemSelector);
      let targetElement = document.querySelector(targetSelector);

      if (!itemElement || !targetElement) {
        throw new Error('Item or target element not found');
      }

      let itemRect = itemElement.getBoundingClientRect();
      let targetRect = targetElement.getBoundingClientRect();

      await triggerEvent(itemElement, 'mousedown', {
        clientX: itemRect.left + itemRect.width / 2,
        clientY: itemRect.top + itemRect.height / 2,
      });

      await triggerEvent(document, 'mousemove', {
        clientX: itemRect.left + 1,
        clientY: itemRect.top + 1,
      });

      let firstStackItemHeaderRect = document
        .querySelector('[data-test-operator-mode-stack="0"] header')!
        .getBoundingClientRect();
      let firstStackItemPaddingTop = getComputedStyle(
        document.querySelector('[data-test-operator-mode-stack="0"]')!,
      )
        .getPropertyValue('padding-top')
        .replace('px', '');
      let marginTop =
        firstStackItemHeaderRect.height + Number(firstStackItemPaddingTop);
      await triggerEvent(document, 'mousemove', {
        clientX: targetRect.left + targetRect.width / 2,
        clientY: targetRect.top - marginTop,
      });

      await triggerEvent(itemElement, 'mouseup', {
        clientX: targetRect.left + targetRect.width / 2,
        clientY: targetRect.top - marginTop,
      });
    };
    await dragAndDrop(
      '[data-test-list="nicknames"] [data-test-sort="1"]',
      '[data-test-list="nicknames"] [data-test-sort="0"]',
    );

    assert
      .dom('[data-test-list="nicknames"] [data-test-item]')
      .exists({ count: 3 });
    assert
      .dom(`[data-test-list="nicknames"] [data-test-item="0"] input`)
      .hasValue('Bolt');
    assert
      .dom(`[data-test-list="nicknames"] [data-test-item="1"] input`)
      .hasValue('Ace');
    assert
      .dom(`[data-test-list="nicknames"] [data-test-item="2"] input`)
      .hasValue('Comet');

    assert
      .dom(`[data-test-list="favoriteGames"] [data-test-item="0"] input`)
      .hasValue('Chess');
    assert
      .dom(`[data-test-list="favoriteGames"] [data-test-item="1"] input`)
      .hasValue('Go');

    await click(
      `[data-test-stack-card="${testRealmURL}Person/burcu"] [data-test-edit-button]`,
    );
    assert
      .dom(
        `[data-test-plural-view-field="nicknames"] [data-test-plural-view-item]`,
      )
      .exists({ count: 3 });
    assert
      .dom(`[data-test-plural-view-field="nicknames"]`)
      .containsText('Bolt');
    assert.dom(`[data-test-plural-view-field="nicknames"]`).containsText('Ace');
    assert
      .dom(`[data-test-plural-view-field="nicknames"]`)
      .containsText('Comet');

    assert
      .dom(
        `[data-test-plural-view-field="favoriteGames"] [data-test-plural-view-item]`,
      )
      .exists({ count: 2 });
    assert
      .dom(`[data-test-plural-view-field="favoriteGames"]`)
      .containsText('Chess');
    assert
      .dom(`[data-test-plural-view-field="favoriteGames"]`)
      .containsText('Go');
  });
});
