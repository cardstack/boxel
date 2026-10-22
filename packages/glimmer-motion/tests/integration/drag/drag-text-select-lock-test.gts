/**
 * A drag locks text selection for the whole document while its pan session is
 * open, and releases it when the session ends — including a press that never
 * moves, where upstream ends the session without `onSessionEnd`.
 *
 * The lock is glimmer-motion's own (see VENDORED.md, "Deviations"), layered
 * over upstream's drag controls, so this test is what catches a framer-motion
 * bump that changes how those controls open or end a session.
 */
import { render } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import {
  $,
  setupFixtureViewport,
  trigger,
  wait,
} from '../../helpers/layout-fixture';

const BOX = { width: '100px', height: '100px', background: 'red' };

const isLocked = () => 'gmDragging' in document.documentElement.dataset;

module('Integration | drag | text-select lock', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);
  setupFixtureViewport(hooks);

  test('a drag holds the lock until pointerup', async function (assert) {
    await render(
      <template>
        <div style='padding:50px'>
          <div data-testid='box' {{motion drag=true style=BOX}}></div>
        </div>
      </template>,
    );
    const el = $("[data-testid='box']");
    const r = el.getBoundingClientRect();

    trigger(el, 'pointerdown');
    await wait(30);
    for (let i = 1; i <= 4; i++) {
      trigger(el, 'pointermove', r.width / 2 + i * 12, r.height / 2 + i * 8);
      await wait(16);
    }
    assert.true(isLocked(), 'text selection is locked mid-drag');

    trigger(el, 'pointerup', r.width / 2 + 48, r.height / 2 + 32);
    await wait(30);
    assert.false(isLocked(), 'the lock is released at pointerup');
  });

  test('a press that never moves releases the lock', async function (assert) {
    await render(
      <template>
        <div style='padding:50px'>
          <div data-testid='first' {{motion drag=true style=BOX}}></div>
          <div data-testid='second' {{motion drag=true style=BOX}}></div>
        </div>
      </template>,
    );

    trigger("[data-testid='first']", 'pointerdown');
    await wait(30);
    assert.true(
      isLocked(),
      'text selection is locked once the press opens a session',
    );

    trigger("[data-testid='first']", 'pointerup');
    await wait(30);
    assert.false(isLocked(), 'the lock is released at pointerup');

    trigger("[data-testid='second']", 'pointerdown');
    await wait(30);
    trigger("[data-testid='second']", 'pointerup');
    await wait(30);
    assert.false(
      isLocked(),
      'presses on other draggables do not accumulate the lock',
    );
  });
});
