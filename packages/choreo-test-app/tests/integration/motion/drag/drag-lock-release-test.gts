/**
 * The global drag lock must be released when a dragging element unmounts.
 *
 * `setDragLock` is a module-global `{x, y}`. `VisualElementDragControls.start`
 * bails at `if (!this.openDragLock) return` — before it sets `isDragging` and
 * before `onDragStart` — so a lock nobody released disables every drag on the
 * page for the life of the document. It disables them INVISIBLY: the pan
 * session still moves elements, so dragging looks like it works while every
 * drag callback quietly stops firing.
 *
 * Upstream keeps the session (and the lock) alive across an unmount, for
 * React 19's unmount/remount during reorder reconciliation. Glimmer moves
 * keyed nodes instead of rebuilding them, so this port cancels instead — see
 * VENDORED.md, "Deviations". This test is what stops that coming back on a
 * `motion-dom` bump.
 */
import { render } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import { module, test } from 'qunit';

import {
  $,
  setupFixtureViewport,
  trigger,
  wait,
} from '../../../helpers/layout-fixture';

const BOX = { width: '100px', height: '100px', background: 'red' };

class State {
  @tracked present = true;
}

/** past the drag threshold, in one gesture that is never released */
async function dragButDoNotDrop(sel: string) {
  const el = $(sel);
  const r = el.getBoundingClientRect();
  trigger(el, 'pointerdown');
  await wait(30);
  for (let i = 1; i <= 4; i++) {
    trigger(el, 'pointermove', r.width / 2 + i * 12, r.height / 2 + i * 8);
    await wait(16);
  }
}

module('Integration | drag | global lock release', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  test('an element unmounted mid-drag does not hold the lock', async function (assert) {
    const state = new State();
    const seen = { starts: 0 };
    const onStart = () => {
      seen.starts += 1;
    };

    await render(
      <template>
        <div style="padding:50px">
          {{#if state.present}}
            <div data-testid="first" {{motion drag=true style=BOX}}></div>
          {{/if}}
          <div
            data-testid="second"
            {{motion drag=true style=BOX onDragStart=onStart}}
          ></div>
        </div>
      </template>
    );

    // open a gesture on the first box and tear it out of the DOM mid-drag,
    // so no pointerup ever reaches its session
    await dragButDoNotDrop("[data-testid='first']");
    state.present = false;
    await wait(50);

    // the second box must still be able to start a drag
    await dragButDoNotDrop("[data-testid='second']");
    await wait(50);

    assert.strictEqual(
      seen.starts,
      1,
      'onDragStart fired — the lock the unmounted element held was released'
    );
  });
});
