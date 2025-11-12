import { click, fillIn, triggerEvent, waitFor } from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import { testRealmURL } from '../../helpers';
import setupOperatorModeTest from '../../helpers/operator-mode-test-setup';
import { renderComponent } from '../../helpers/render-component';

module(
  'Integration | operator-mode | reordering and visual polish',
  function (hooks) {
    let { noop, setCardInOperatorModeState } = setupOperatorModeTest(hooks);

    test('can reorder linksToMany cards in edit view without affecting other linksToMany cards', async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}grid`);

      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
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
        .dom(
          `[data-test-plural-view-field="cars"] [data-test-plural-view-item]`,
        )
        .exists({ count: 2 });

      await click(
        `[data-test-stack-card="${testRealmURL}Person/burcu"] [data-test-edit-button]`,
      );
      assert
        .dom('[data-test-list="friends"] [data-test-item]')
        .exists({ count: 3 });

      let dragAndDrop = async (
        itemSelector: string,
        targetSelector: string,
      ) => {
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
    });

    test('can reorder containsMany cards in edit view without affecting other containsMany cards', async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
        },
      );
      await click(`[data-test-boxel-filter-list-button="All Cards"]`);
      await waitFor(`[data-test-cards-grid-item]`);
      await click(
        `[data-test-cards-grid-item="${testRealmURL}Person/burcu"] .field-component-card`,
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}Person/burcu"]`);
      await click('[data-test-edit-button]');
      assert.dom('[data-test-list="nicknames"] [data-test-item]').exists();

      await triggerEvent('[data-test-sort="0"]', 'mouseenter');
      await triggerEvent('[data-test-sort="0"]', 'mousedown');
      await triggerEvent(document, 'mousemove', { clientX: 0, clientY: -100 });
      await triggerEvent(document, 'mouseup', { clientX: 0, clientY: -100 });
      assert.dom('[data-test-list="nicknames"] [data-test-item]').exists();
    });

    test('CardDef filter is not displayed in filter list', async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      assert
        .dom(`[data-test-boxel-filter-list-button="CardDef"]`)
        .doesNotExist();
    });

    test('updates filter list when there is indexing event', async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
      await click(`[data-test-boxel-filter-list-button="All Cards"]`);
      await waitFor(`[data-test-cards-grid-item]`);

      await click('[data-test-create-new-card-button]');
      await waitFor(`[data-test-card-catalog-item]`);
      await fillIn('[data-test-search-field]', 'Skill');
      await click(
        '[data-test-card-catalog-item="https://cardstack.com/base/cards/skill"]',
      );
      await click('[data-test-card-catalog-go-button]');

      await fillIn('[data-test-field="title"] input', 'New Skill');
      await click('[data-test-close-button]');

      assert.dom(`[data-test-boxel-filter-list-button]`).exists({ count: 14 });
      assert.dom(`[data-test-boxel-filter-list-button="Skill"]`).exists();
    });

    test('edit card and finish editing should not animate', async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}Person/fadhlan`);

      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
        },
      );

      await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
      await click(
        `[data-test-stack-card="${testRealmURL}Person/fadhlan"] [data-test-edit-button]`,
      );
      assert
        .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
        .doesNotHaveClass('opening-animation');

      await click('[data-test-edit-button]');
      await waitFor(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`);
      assert
        .dom(`[data-test-stack-card="${testRealmURL}Person/fadhlan"]`)
        .doesNotHaveClass('opening-animation');
    });

    test('close card should not trigger opening animation again', async function (assert) {
      setCardInOperatorModeState(`${testRealmURL}grid`);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
        },
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);

      await click(`[data-test-boxel-filter-list-button="All Cards"]`);
      await waitFor(`[data-test-cards-grid-item]`);
      await click(
        `[data-test-cards-grid-item="${testRealmURL}Person/fadhlan"] .field-component-card`,
      );
      await click(`[data-test-stack-card-index="1"] [data-test-close-button]`);

      await waitFor(`[data-test-stack-card-index="0"]`);
      assert
        .dom(`[data-test-stack-card-index="0"]`)
        .doesNotHaveClass('opening-animation');
    });

    test('stack item with custom header color does not lose the color when opening other cards in the stack', async function (assert) {
      const cardId = `${testRealmURL}PublishingPacket/story`;
      const customStyle = {
        backgroundColor: 'rgb(102, 56, 255)',
        color: 'rgb(255, 255, 255)',
      };
      setCardInOperatorModeState(cardId);
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <OperatorMode @onClose={{noop}} />
          </template>
        },
      );
      assert.dom(`[data-test-stack-card="${cardId}"]`).exists();
      assert
        .dom(`[data-stack-card="${cardId}"] [data-test-card-header]`)
        .hasStyle(customStyle);

      await click(`[data-test-card="${testRealmURL}BlogPost/1"]`);
      assert.dom(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`).exists();
      assert
        .dom(
          `[data-stack-card="${testRealmURL}BlogPost/1"] [data-test-card-header]`,
        )
        .hasStyle({
          backgroundColor: 'rgb(255, 255, 255)',
          color: 'rgb(0, 0, 0)',
        });
      assert
        .dom(`[data-stack-card="${cardId}"] [data-test-card-header]`)
        .hasStyle(customStyle);

      await click(
        `[data-stack-card="${testRealmURL}BlogPost/1"] [data-test-close-button]`,
      );
      await waitFor(`[data-test-stack-card="${testRealmURL}BlogPost/1"]`, {
        count: 0,
      });
      assert
        .dom(`[data-stack-card="${cardId}"] [data-test-card-header]`)
        .hasStyle(customStyle);
    });
  },
);
