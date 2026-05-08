import { render, triggerEvent } from '@ember/test-helpers';

import window from 'ember-window-mock';
import { module, test } from 'qunit';

import type { Format } from '@cardstack/runtime-common';

import FormatChooser from '@cardstack/host/components/operator-mode/code-submode/format-chooser';
import { FormatChooserOrder } from '@cardstack/host/utils/local-storage-keys';

import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | Component | FormatChooser', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    window.localStorage.removeItem(FormatChooserOrder);
  });

  function buttonOrder(): Format[] {
    return Array.from(
      document.querySelectorAll('[data-test-format-chooser]'),
    ).map((el) => el.getAttribute('data-test-format-chooser') as Format);
  }

  // ── localStorage ──────────────────────────────────────────────────────────

  module('localStorage', function () {
    test('renders in default order when localStorage is empty', async function (assert) {
      const formats: Format[] = ['isolated', 'embedded', 'atom'];
      const setFormat = () => {};
      await render(
        <template>
          <FormatChooser
            @format='isolated'
            @setFormat={{setFormat}}
            @formats={{formats}}
          />
        </template>,
      );
      assert.deepEqual(buttonOrder(), ['isolated', 'embedded', 'atom']);
    });

    test('restores persisted order on mount', async function (assert) {
      const formats: Format[] = ['isolated', 'embedded', 'atom'];
      window.localStorage.setItem(
        FormatChooserOrder,
        JSON.stringify({
          'isolated|embedded|atom': ['atom', 'isolated', 'embedded'],
        }),
      );
      const setFormat = () => {};
      await render(
        <template>
          <FormatChooser
            @format='isolated'
            @setFormat={{setFormat}}
            @formats={{formats}}
          />
        </template>,
      );
      assert.deepEqual(buttonOrder(), ['atom', 'isolated', 'embedded']);
    });

    test('filters out stale formats from stored order', async function (assert) {
      const formats: Format[] = ['isolated', 'embedded', 'atom'];
      // 'markdown' is not in the current @formats and must be dropped
      window.localStorage.setItem(
        FormatChooserOrder,
        JSON.stringify({
          'isolated|embedded|atom': [
            'atom',
            'markdown',
            'isolated',
            'embedded',
          ],
        }),
      );
      const setFormat = () => {};
      await render(
        <template>
          <FormatChooser
            @format='isolated'
            @setFormat={{setFormat}}
            @formats={{formats}}
          />
        </template>,
      );
      assert.deepEqual(buttonOrder(), ['atom', 'isolated', 'embedded']);
    });

    test('ignores stored order whose scope key does not match @formats', async function (assert) {
      const formats: Format[] = ['isolated', 'embedded', 'atom'];
      window.localStorage.setItem(
        FormatChooserOrder,
        JSON.stringify({
          'isolated|embedded|fitted': ['fitted', 'isolated', 'embedded'],
        }),
      );
      const setFormat = () => {};
      await render(
        <template>
          <FormatChooser
            @format='isolated'
            @setFormat={{setFormat}}
            @formats={{formats}}
          />
        </template>,
      );
      assert.deepEqual(
        buttonOrder(),
        ['isolated', 'embedded', 'atom'],
        'default order used when scope key has no match',
      );
    });

    test('falls back to default order when localStorage contains malformed JSON', async function (assert) {
      const formats: Format[] = ['isolated', 'embedded', 'atom'];
      window.localStorage.setItem(FormatChooserOrder, '{ not valid json }');
      const setFormat = () => {};
      await render(
        <template>
          <FormatChooser
            @format='isolated'
            @setFormat={{setFormat}}
            @formats={{formats}}
          />
        </template>,
      );
      assert.deepEqual(
        buttonOrder(),
        ['isolated', 'embedded', 'atom'],
        'component does not throw and renders default order',
      );
    });
  });

  // ── drag and drop ─────────────────────────────────────────────────────────

  module('drag and drop', function () {
    function targetClientX(
      btnSelector: string,
      position: 'beginning' | 'end',
    ): number {
      let draggedButton = document.querySelector(btnSelector);

      if (!draggedButton) {
        throw new Error(`Button not found for selector: ${btnSelector}`);
      }

      let otherButtons = Array.from(
        document.querySelectorAll('[data-test-format-chooser]'),
      ).filter((button) => button !== draggedButton);

      if (otherButtons.length === 0) {
        return 0;
      }

      let centers = otherButtons.map((button) => {
        let rect = button.getBoundingClientRect();
        return rect.left + rect.width / 2;
      });

      return position === 'beginning'
        ? Math.min(...centers) - 1
        : Math.max(...centers) + 1;
    }

    async function drag(btnSelector: string, position: 'beginning' | 'end') {
      let button = document.querySelector(btnSelector);

      if (!button) {
        throw new Error(`Button not found for selector: ${btnSelector}`);
      }

      let rect = button.getBoundingClientRect();
      let startX = rect.left + rect.width / 2;
      let startY = rect.top + rect.height / 2;
      let endX = targetClientX(btnSelector, position);

      await triggerEvent(button, 'mousedown', {
        button: 0,
        clientX: startX,
        clientY: startY,
      });
      await triggerEvent(document, 'mousemove', {
        clientX: startX + 1,
        clientY: startY,
      });
      await triggerEvent(document, 'mousemove', {
        clientX: endX,
        clientY: startY,
      });
      await triggerEvent(button, 'mouseup', {
        clientX: endX,
        clientY: startY,
      });
    }

    test('moves first button to end and persists new order to localStorage', async function (assert) {
      const formats: Format[] = ['isolated', 'embedded', 'atom'];
      const setFormat = () => {};
      await render(
        <template>
          <FormatChooser
            @format='isolated'
            @setFormat={{setFormat}}
            @formats={{formats}}
          />
        </template>,
      );
      await drag('[data-test-format-chooser="isolated"]', 'end');
      assert.deepEqual(
        buttonOrder(),
        ['embedded', 'atom', 'isolated'],
        'DOM order reflects the drag result',
      );
      const stored = JSON.parse(
        window.localStorage.getItem(FormatChooserOrder) ?? '{}',
      );
      assert.deepEqual(
        stored['isolated|embedded|atom'],
        ['embedded', 'atom', 'isolated'],
        'new order is written to localStorage',
      );
    });

    test('moves last button to beginning', async function (assert) {
      const formats: Format[] = ['isolated', 'embedded', 'atom'];
      const setFormat = () => {};
      await render(
        <template>
          <FormatChooser
            @format='isolated'
            @setFormat={{setFormat}}
            @formats={{formats}}
          />
        </template>,
      );

      await drag('[data-test-format-chooser="atom"]', 'beginning');

      assert.deepEqual(
        buttonOrder(),
        ['atom', 'isolated', 'embedded'],
        'DOM order reflects the drag result',
      );
    });

    test('preserves unrelated scope keys in localStorage when reordering', async function (assert) {
      const formats: Format[] = ['isolated', 'embedded', 'atom'];
      window.localStorage.setItem(
        FormatChooserOrder,
        JSON.stringify({
          'isolated|embedded|fitted': ['fitted', 'isolated', 'embedded'],
        }),
      );
      const setFormat = () => {};
      await render(
        <template>
          <FormatChooser
            @format='isolated'
            @setFormat={{setFormat}}
            @formats={{formats}}
          />
        </template>,
      );

      await drag('[data-test-format-chooser="isolated"]', 'end');

      const stored = JSON.parse(
        window.localStorage.getItem(FormatChooserOrder) ?? '{}',
      );
      assert.deepEqual(
        stored['isolated|embedded|atom'],
        ['embedded', 'atom', 'isolated'],
        'new scope key is written',
      );
      assert.deepEqual(
        stored['isolated|embedded|fitted'],
        ['fitted', 'isolated', 'embedded'],
        'unrelated scope key is preserved',
      );
    });

    test('does not write to localStorage for a press-and-release without movement', async function (assert) {
      const formats: Format[] = ['isolated', 'embedded', 'atom'];
      const setFormat = () => {};
      await render(
        <template>
          <FormatChooser
            @format='isolated'
            @setFormat={{setFormat}}
            @formats={{formats}}
          />
        </template>,
      );

      // mousedown + mouseup with no intervening mousemove
      await triggerEvent('[data-test-format-chooser="embedded"]', 'mousedown', {
        button: 0,
        clientX: 0,
      });
      await triggerEvent(document.body, 'mouseup', { clientX: 0 });

      assert.strictEqual(
        window.localStorage.getItem(FormatChooserOrder),
        null,
        'localStorage is not written for a click without movement',
      );
    });
  });
});
