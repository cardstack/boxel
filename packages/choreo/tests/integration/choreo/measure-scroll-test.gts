/**
 * A region's measurement does not move the scroller it sits in.
 *
 * To measure, a region puts everything its run is moving back to rest. A box
 * flying up from below the end carries a translate that adds to the
 * scroller's scroll height, so at rest that height is shorter, and a reader
 * at the end would be clamped to it. The barrier holds the scroll height
 * while the regions measure, so the reader stays where they were, the
 * region measures the page at the reader's scroll, and a scroll owner never
 * sees a scroll it did not write. With no scrolling element above the
 * region, the document is the scroller it holds.
 *
 * Holding a scroller must not move what the regions measure, so a scroller
 * whose layout would move its content around the strut, or whose own size
 * would change with it, is not held.
 */
import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import type { TOC } from '@ember/component/template-only';
import { render, rerender, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

class State {
  @tracked above: number;
  // a participant that arrives without taking any room in the flow
  @tracked extra = false;
  constructor(above: number) {
    this.above = above;
  }
  get aboveStyle() {
    return `height:${this.above}px`;
  }
}

type Signature = { Args: { state: State } };

// the region's content: a block above the box, the box, and the late arrival
const Content = <template>
  <Choreo class='stage' style='position:relative' as |c|>
    <div style={{@state.aboveStyle}}></div>
    <div
      data-test-box
      style='height:40px;background:#0af'
      {{motion id='box'}}
    ></div>
    {{#if @state.extra}}
      <div
        style='position:absolute;top:0;left:0;width:1px;height:1px'
        {{motion id='extra'}}
      ></div>
    {{/if}}
    <c.Move @of={{c.all}} @duration={{2}} @ease='linear' />
  </Choreo>
</template> satisfies TOC<Signature>;

// a scroller in normal flow, with a fixed height
const InBlock = <template>
  <div
    data-test-scroller
    style='height:120px;overflow-y:auto;overflow-anchor:none'
  >
    <Content @state={{@state}} />
  </div>
</template> satisfies TOC<Signature>;

// no scrolling element: the document scrolls
const InDocument = <template>
  <Content @state={{@state}} />
</template> satisfies TOC<Signature>;

// a scroller that grows in a column, sharing it with a sibling that shrinks:
// its own height follows its content
const InGrowingFlexItem = <template>
  <div style='display:flex;flex-direction:column;height:200px'>
    <div style='flex:0 1 auto;min-height:0;overflow:hidden'>
      <div style='height:100px'></div>
    </div>
    <div
      data-test-scroller
      style='flex:1 1 auto;min-height:0;overflow-y:auto;overflow-anchor:none'
    >
      <Content @state={{@state}} />
    </div>
  </div>
</template> satisfies TOC<Signature>;

// a scroller that is a flex row spreading its children apart: a last child
// would move the ones before it
const AsSpreadFlexRow = <template>
  <div
    data-test-scroller
    style='display:flex;justify-content:space-between;align-items:flex-start;width:400px;height:120px;overflow-y:auto;overflow-anchor:none'
  >
    <div style='flex:none;width:100px;height:10px'></div>
    <div style='flex:none;width:100px'>
      <Content @state={{@state}} />
    </div>
  </div>
</template> satisfies TOC<Signature>;

class Crossing {
  @tracked page: 'long' | 'short' = 'long';
  // where the crossing places the window
  scroll: () => number = () => 1400;
}

const isLong = (c: Crossing) => c.page === 'long';

// a @route region in the page's flow: a long page that crosses to a short
// one, placing the window past the short page's end
const Pages = <template>
  <Choreo
    @route={{true}}
    @scroll={{@crossing.scroll}}
    style='position:relative'
    as |c|
  >
    {{#if (isLong @crossing)}}
      <div style='height:2500px'></div>
      <div
        data-test-card
        style='width:100px;height:100px;background:#0af'
        {{motion id='card' role='stage'}}
      ></div>
      <div style='height:1400px'></div>
    {{else}}
      <div style='height:1000px'></div>
      <div
        data-test-card
        style='width:100px;height:100px;background:#0af'
        {{motion id='card' role='stage'}}
      ></div>
      <div style='height:400px'></div>
    {{/if}}
    <c.Crossing @duration={{2}} @ease='linear' @leave={{0.1}} @arrive={{0.1}} />
  </Choreo>
</template> satisfies TOC<{ Args: { crossing: Crossing } }>;

function addStyle(css: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

function scroller(): HTMLElement {
  return document.querySelector('[data-test-scroller]') as HTMLElement;
}
function box(): DOMRect {
  return (
    document.querySelector('[data-test-box]') as HTMLElement
  ).getBoundingClientRect();
}
const frame = () =>
  new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

// The box moves up by 100px: it starts translated to where it was, so the
// scroll height runs 100px past the resting layout's end. With the reader at
// the end, a pass during the flight (the region measures at rest and runs
// again) must leave the scroll where it was, and no scroll event may see it
// clamped.
async function assertFlightKeepsTheEnd(
  assert: Assert,
  state: State,
  el: HTMLElement,
  onScroller: EventTarget,
) {
  let resting = el.scrollHeight;
  state.above -= 100;
  await frame();
  await frame();
  assert.true(
    el.scrollHeight > resting - 100 + 50,
    `the flight adds to the scroll height (${el.scrollHeight})`,
  );
  // the reader is at the end
  el.scrollTop = el.scrollHeight - el.clientHeight;
  let before = el.scrollTop;
  let lowest = before;
  let onScroll = () => {
    lowest = Math.min(lowest, el.scrollTop);
  };
  onScroller.addEventListener('scroll', onScroll);
  try {
    state.extra = true;
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
    onScroller.removeEventListener('scroll', onScroll);
  }
  await settled();
}

// The box stands still, the reader has scrolled, and a pass runs: the box is
// measured where it is, so no run moves it.
async function assertStillBoxStaysPut(assert: Assert, state: State) {
  let el = scroller();
  el.scrollTop = el.scrollHeight - el.clientHeight;
  assert.true(el.scrollTop > 0, `the reader has scrolled (${el.scrollTop})`);
  await frame();
  let before = box();
  state.extra = true;
  await rerender();
  await frame();
  let after = box();
  assert.true(
    Math.abs(after.top - before.top) < 1 &&
      Math.abs(after.left - before.left) < 1,
    `the box is where it stood (${before.left},${before.top} -> ${after.left},${after.top})`,
  );
  await settled();
}

module('Integration | choreo | measure keeps the scroll', function (hooks) {
  setupRenderingTest(hooks);
  setupChoreo(hooks);

  module('in a scrolling element', function (hooks) {
    setupFixtureViewport(hooks);

    test('a pass measured while a box flies up from below the end leaves a reader at the end', async function (assert) {
      const state = new State(300);
      await render(<template><InBlock @state={{state}} /></template>);
      let el = scroller();
      await assertFlightKeepsTheEnd(assert, state, el, el);
    });

    test('a scroller whose own height follows its content is not held', async function (assert) {
      const state = new State(300);
      await render(<template><InGrowingFlexItem @state={{state}} /></template>);
      await assertStillBoxStaysPut(assert, state);
    });

    test('a flex scroller that would move its children around a strut is not held', async function (assert) {
      const state = new State(300);
      await render(<template><AsSpreadFlexRow @state={{state}} /></template>);
      await assertStillBoxStaysPut(assert, state);
    });
  });

  module('in the document', function (hooks) {
    setupFixtureViewport(hooks, { scroll: true });

    test('a pass measured while a box flies up from below the end leaves a reader at the end of the page', async function (assert) {
      const state = new State(1200);
      await render(<template><InDocument @state={{state}} /></template>);
      let el = document.scrollingElement as HTMLElement;
      await assertFlightKeepsTheEnd(assert, state, el, window);
    });

    test('a <body> whose overflow goes to the viewport is not taken for the scroller', async function (assert) {
      // overflow-x: hidden computes <body>'s overflow-y to auto, but with
      // <html> visible, both go to the viewport, and the document scrolls
      const style = addStyle('body { overflow-x: hidden; }');
      try {
        const state = new State(1200);
        await render(<template><InDocument @state={{state}} /></template>);
        let el = document.scrollingElement as HTMLElement;
        await assertFlightKeepsTheEnd(assert, state, el, window);
      } finally {
        style.remove();
      }
    });
  });

  module('a region that places the window', function (hooks) {
    setupFixtureViewport(hooks, { scroll: true });
    let style: HTMLStyleElement | undefined;
    hooks.beforeEach(function () {
      // the region in the page's flow, so the page is as long as its scene
      style = addStyle(
        '#ember-testing-container, #ember-testing { position: static !important; height: auto !important; }',
      );
    });
    hooks.afterEach(function () {
      style?.remove();
    });

    test('a crossing whose @scroll lands past the end of the arriving page starts its flight where the card stood', async function (assert) {
      const crossing = new Crossing();
      await render(<template><Pages @crossing={{crossing}} /></template>);
      window.scrollTo(0, 2200);
      assert.strictEqual(window.scrollY, 2200, 'the reader is down the page');
      await frame();
      const card = () =>
        (
          document.querySelector('[data-test-card]') as HTMLElement
        ).getBoundingClientRect();
      const before = card();
      crossing.page = 'short';
      await rerender();
      await frame();
      const start = card();
      assert.true(
        window.scrollY < 1400,
        `the window is clamped to the short page (${window.scrollY})`,
      );
      assert.true(
        Math.abs(start.top - before.top) < 10,
        `the flight starts where the card stood (${before.top} -> ${start.top})`,
      );
      await settled();
    });

    test('a crossing whose @scroll reads the page reads it without the strut', async function (assert) {
      const crossing = new Crossing();
      // 200px above the end of the arriving page
      crossing.scroll = () =>
        document.scrollingElement!.scrollHeight - window.innerHeight - 200;
      await render(<template><Pages @crossing={{crossing}} /></template>);
      window.scrollTo(0, 2200);
      assert.strictEqual(window.scrollY, 2200, 'the reader is down the page');
      await frame();
      crossing.page = 'short';
      await rerender();
      await settled();
      const end = document.scrollingElement!.scrollHeight - window.innerHeight;
      assert.true(
        Math.abs(window.scrollY - (end - 200)) < 2,
        `the window is 200px above the end (${window.scrollY}, end ${end})`,
      );
    });
  });
});
