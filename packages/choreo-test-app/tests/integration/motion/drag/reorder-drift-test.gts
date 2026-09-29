import { render, settled } from '@ember/test-helpers';
import ReorderGroup from 'glimmer-motion/reorder/group';
import ReorderItem from 'glimmer-motion/reorder/item';
import { animationsSettled, setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';

/**
 * A y-axis reorder must not move anything sideways.
 *
 * Reported from the gallery: after a few reorders one row sits noticeably left
 * of the others — same width, just displaced, which is a translate nobody gave
 * back rather than a scale that failed to settle.
 */
const items = [
  { id: 'a', title: 'Atlas' },
  { id: 'b', title: 'Flux' },
  { id: 'c', title: 'Halo' },
  { id: 'd', title: 'Ore' },
];
const snap = { bounce: 0.1, type: 'spring', visualDuration: 0.2 } as const;
const whileDrag = { scale: 1.04 };

class State {
  items = items;
}

function rows() {
  return [...document.querySelectorAll<HTMLElement>('.row')];
}

const pointer = (
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  buttons = 1
) =>
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      buttons,
      cancelable: true,
      clientX: x,
      clientY: y,
      composed: true,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'mouse',
    })
  );

/** press a row and walk it down by `dy`, in steps, then let go */
async function haul(el: HTMLElement, dy: number) {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  pointer(el, 'pointerdown', x, y);
  await settled();
  for (let i = 1; i <= 8; i++) {
    pointer(el, 'pointermove', x, y + (dy * i) / 8);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  pointer(window, 'pointerup', x, y + dy, 0);
  await settled();
  await animationsSettled();
}

module('Integration | motion | reorder drift', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('hauling a row up and down repeatedly never moves it sideways', async function (assert) {
    const state = new State();
    const setItems = (next: typeof items) => {
      state.items = next;
    };
    await render(
      <template>
        <div class="list" style="width: 300px">
          <ReorderGroup
            @values={{state.items}}
            @onReorder={{setItems}}
            @axis="y"
            as |group|
          >
            {{#each state.items key="id" as |item|}}
              <ReorderItem
                class="row"
                style="height: 40px"
                @group={{group}}
                @value={{item}}
                @transition={{snap}}
                @whileDrag={{whileDrag}}
              >{{item.title}}</ReorderItem>
            {{/each}}
          </ReorderGroup>
        </div>
      </template>
    );
    await animationsSettled();

    const lefts = () =>
      rows().map((r) => Math.round(r.getBoundingClientRect().left));
    const before = lefts();
    assert.strictEqual(
      new Set(before).size,
      1,
      `every row starts on the same left edge: ${before.join(', ')}`
    );

    for (let pass = 0; pass < 4; pass++) {
      const first = rows()[0]!;
      await haul(first, 90);
      const now = lefts();
      assert.deepEqual(
        now,
        before,
        `pass ${pass + 1}: nothing drifted sideways (${now.join(', ')})`
      );
    }
  });
});
