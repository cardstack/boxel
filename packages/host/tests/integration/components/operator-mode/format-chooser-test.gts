import { render, triggerEvent } from '@ember/test-helpers';

import window from 'ember-window-mock';
import { module, test } from 'qunit';

import type { Format } from '@cardstack/runtime-common';

import FormatChooser from '@cardstack/host/components/operator-mode/code-submode/format-chooser';
import { FormatChooserOrder } from '@cardstack/host/utils/local-storage-keys';

import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | Component | FormatChooser', function (hooks) {
  setupRenderingTest(hooks);

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
    // In the test environment, getBoundingClientRect() returns zeros for all
    // buttons (no layout). targetIndexForClientX therefore treats every button
    // center as 0, so:
    //   clientX >= 0  →  clientX < 0 is never true  →  targetIndex = end
    //   clientX < 0   →  clientX < 0 is always true for the first button
    //                    →  targetIndex = 0 (beginning)
    async function drag(btnSelector: string, clientX: number) {
      await triggerEvent(btnSelector, 'mousedown', { button: 0, clientX: 0 });
      await triggerEvent(window, 'mousemove', { clientX });
      await triggerEvent(window, 'mouseup', { clientX });
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

      await drag('[data-test-format-chooser="isolated"]', 400);

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

      await drag('[data-test-format-chooser="atom"]', -1);

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

      await drag('[data-test-format-chooser="isolated"]', 400);

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
