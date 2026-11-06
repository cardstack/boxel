/**
 * A region's measurement does not move the scroller it sits in.
 *
 * To measure, a region puts everything its run is moving back to rest. A box
 * flying up from below the end carries a translate that adds to the
 * scroller's scroll height, so at rest that height is shorter, and a reader
 * at the end would be clamped to it. The barrier holds the scroll height
 * while the regions measure, so the reader stays where they were, the
 * region measures the page at the reader's scroll, and a scroll owner never
 * sees a scroll it did not write.
 */
import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { render, rerender, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

let stage: Stage | undefined;
const seize = (s: Stage) => {
  stage = s;
};

class Stage extends Component<{ Args: { seize: (self: Stage) => void } }> {
  @tracked above = 300;
  // a participant that arrives without taking any room in the flow
  @tracked extra = false;
  constructor(owner: unknown, args: { seize: (self: Stage) => void }) {
    super(owner as never, args as never);
    args.seize(this);
  }
  get aboveStyle() {
    return `height:${this.above}px`;
  }
  <template>
    <div
      data-scroller
      style='height:120px;overflow-y:auto;overflow-anchor:none'
    >
      <Choreo class='stage' style='position:relative' as |c|>
        <div style={{this.aboveStyle}}></div>
        <div
          data-box
          style='height:40px;background:#0af'
          {{motion id='box'}}
        ></div>
        {{#if this.extra}}
          <div
            style='position:absolute;top:0;left:0;width:1px;height:1px'
            {{motion id='extra'}}
          ></div>
        {{/if}}
        <c.Move @of={{c.all}} @duration={{2}} @ease='linear' />
      </Choreo>
    </div>
  </template>
}

function scroller(): HTMLElement {
  return document.querySelector('[data-scroller]') as HTMLElement;
}
const frame = () =>
  new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

module('Integration | choreo | measure keeps the scroll', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  hooks.afterEach(() => {
    stage = undefined;
  });

  test('a pass measured while a box flies up from below the end leaves a reader at the end', async function (assert) {
    await render(<template><Stage @seize={{seize}} /></template>);
    // the box moves up by 100px: it starts translated to where it was, so
    // the scroll height runs 100px past the resting layout's end
    stage!.above = 200;
    await frame();
    await frame();
    let el = scroller();
    assert.true(
      el.scrollHeight > 240 + 50,
      `the flight adds to the scroll height (${el.scrollHeight})`,
    );
    // the reader is at the end
    el.scrollTop = el.scrollHeight - el.clientHeight;
    let before = el.scrollTop;
    let lowest = before;
    let onScroll = () => {
      lowest = Math.min(lowest, el.scrollTop);
    };
    el.addEventListener('scroll', onScroll);
    try {
      // a pass during the flight: the region measures at rest and runs again
      stage!.extra = true;
      await rerender();
      assert.true(
        before - el.scrollTop < 20,
        `the scroll is where the pass left it (${before} -> ${el.scrollTop})`,
      );
      await frame();
      assert.true(
        before - lowest < 20,
        `no scroll event saw it clamped (${before} -> lowest ${lowest})`,
      );
    } finally {
      el.removeEventListener('scroll', onScroll);
    }
    await settled();
  });
});
