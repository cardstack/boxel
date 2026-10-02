/**
 * Slow motion — a global divisor on every transition this binding hands the
 * engine. Not a Motion feature; see packages/glimmer-motion/src/speed.ts for
 * why setting `speed` on a running animation is not the same thing.
 *
 * The interesting case is a LAYOUT animation. Its transition is resolved
 * inside the projection tree, in this order:
 *
 *     projection.options.transition          — the engine wipes this each pass
 *  || visualElement.getDefaultTransition()   — the element's own `transition`
 *  || defaultLayoutTransition                — a constant the engine keeps
 *
 * Only the middle one is ours, so an element that never declared a transition
 * would ignore the divisor entirely. These pin both halves.
 */
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { setMotionSpeed } from 'glimmer-motion';
import LayoutGroup from 'glimmer-motion/layout-group';
import motion from 'glimmer-motion/motion';
import { setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame, sleep } from '../../helpers/motion';

/** how long the element keeps moving after a layout change */
async function timeLayoutAnimation(el: () => HTMLElement, kick: () => void) {
  const start = performance.now();
  let previous = el().getBoundingClientRect().left;
  let moved = false;
  kick();
  await settled();
  for (;;) {
    await nextFrame();
    const now = el().getBoundingClientRect().left;
    const still = Math.abs(now - previous) < 0.05;
    previous = now;
    if (!still) {
      moved = true;
    } else if (moved) {
      return performance.now() - start;
    }
    if (performance.now() - start > 12000) {
      return -1;
    }
  }
}

module('Integration | motion | slow motion', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);
  setupFixtureViewport(hooks);

  test('a layout animation with no transition of its own still honours the divisor', async function (assert) {
    class App extends Component {
      @tracked wide = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      get pad() {
        return `padding-left:${this.wide ? 200 : 0}px`;
      }
      <template>
        <LayoutGroup>
          <div style="width:400px">
            <div style={{this.pad}}>
              {{! deliberately no transition: the engine's own default is what
                  has to be scaled }}
              <div
                id="box"
                style="width:40px;height:40px;background:#0af"
                {{motion layout=true}}
              ></div>
            </div>
          </div>
        </LayoutGroup>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    const box = () => document.querySelector('#box') as HTMLElement;

    setMotionSpeed(1);
    const full = await timeLayoutAnimation(box, () => (app!.wide = true));
    await sleep(200);
    app!.wide = false;
    await settled();
    await sleep(800);

    setMotionSpeed(5);
    const slow = await timeLayoutAnimation(box, () => (app!.wide = true));

    assert.ok(full > 0 && slow > 0, `both animations ran (${full}, ${slow})`);
    const ratio = slow / full;
    assert.ok(
      ratio > 3.2,
      `five times slower moves the needle (${Math.round(full)}ms -> ${Math.round(slow)}ms, ${ratio.toFixed(1)}x)`
    );
  });

  test('the divisor does not touch anything at normal speed', async function (assert) {
    setMotionSpeed(1);
    class App extends Component {
      @tracked wide = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      get pad() {
        return `padding-left:${this.wide ? 120 : 0}px`;
      }
      <template>
        <LayoutGroup>
          <div style="width:400px">
            <div style={{this.pad}}>
              <div
                id="b2"
                style="width:30px;height:30px"
                {{motion layout=true}}
              >
              </div>
            </div>
          </div>
        </LayoutGroup>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await nextFrame();
    // with no divisor the element's own props stay untouched, so the engine
    // reaches its default by its own path exactly as before
    app!.wide = true;
    await settled();
    await sleep(900);
    await nextFrame();
    const left = (
      document.querySelector('#b2') as HTMLElement
    ).getBoundingClientRect().left;
    assert.ok(left > 100, `landed at the new layout (${Math.round(left)})`);
  });
});
