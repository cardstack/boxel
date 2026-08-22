/**
 * Ports of the Cypress specs about layout + presence/lifecycle (motion@bbabb00):
 * layout-exit, layout-cancelled-finishes, layout-instant-undo, layout-shared-fragment,
 * layout-group, layout-viewport-jump, layout-appear-spring-bounce.
 */
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render, click, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { schedule } from '@ember/runloop';
import { guidFor } from '@ember/object/internals';
import { motionValue } from 'motion-dom';
import { animate } from 'motion';
import motion from 'glimmer-motion/motion';
import Presence from 'glimmer-motion/presence';
import LayoutGroup from 'glimmer-motion/layout-group';
import { instantLayoutTransition } from 'glimmer-motion/layout';
import { setupFixtureViewport, should, expectBbox, wait, $ } from '../../../helpers/layout-fixture';

const keyOf = (it: { key: string }) => it.key;

/* ---------- layout-exit.tsx ---------- */
const EXIT_ANIM = { x: 0, opacity: 0.5 };
const EXIT_T = { duration: 0.1 };
class LayoutExit extends Component {
  @tracked visible = true;
  get items() { return this.visible ? [{ key: 'box' }] : []; }
  constructor(owner: unknown, args: object) {
    super(owner as never, args);
    // useEffect(() => setVisible(!visible), []): flip right after mount
    schedule('afterRender', () => { this.visible = !this.visible; });
  }
  <template>
    <Presence @items={{this.items}} @key={{keyOf}} as |it h|>
      <div id="box" style="width:100px;height:100px;background:blue" {{motion presence=h layout=true transition=EXIT_T exit=EXIT_ANIM}}></div>
    </Presence>
  </template>
}

/* ---------- layout-cancelled-finishes.tsx ---------- */
class CancelledFinishes extends Component {
  @tracked isVisible = true;
  get items() { return this.isVisible ? [{ key: 'c' }] : []; }
  hide = () => instantLayoutTransition(() => { this.isVisible = false; });
  <template>
    <Presence @items={{this.items}} @key={{keyOf}} as |it h|>
      <div data-testid="cancellable" style="height:100px" {{motion presence=h}} {{on "click" this.hide}}></div>
    </Presence>
  </template>
}

/* ---------- layout-instant-undo.tsx ---------- */
const IU_A = { position: 'absolute', top: 0, left: 200, width: 100, height: 100, background: 'red' };
const IU_B = { ...IU_A, left: 500 };
const IU_T = { duration: 10 };
class InstantUndo extends Component {
  @tracked state = true;
  get style() { return this.state ? IU_A : IU_B; }
  // useLayoutEffect: a false state is undone before paint
  toggle = () => { this.state = !this.state; if (!this.state) schedule('afterRender', () => { this.state = true; }); };
  <template><div id="box" {{motion layout=true style=this.style transition=IU_T}} {{on "click" this.toggle}}></div></template>
}

/* ---------- layout-shared-fragment.tsx ---------- */
const SF_A = { position: 'absolute', left: 0, background: 'red', top: 100, width: 100, height: 100 };
const SF_B = { position: 'absolute', left: 0, background: 'red', top: 300, width: 100, height: 100 };
const SF_T = { duration: 1, ease: () => 0.5 };
class SharedFragment extends Component {
  @tracked state = true;
  toB = () => { this.state = false; };
  toA = () => { this.state = true; };
  <template>
    {{#if this.state}}
      <div id="box" {{motion layoutId="box" style=SF_A transition=SF_T}} {{on "click" this.toB}}></div>
    {{else}}
      <div id="box" {{motion layoutId="box" style=SF_B transition=SF_T}} {{on "click" this.toA}}></div>
    {{/if}}
  </template>
}

/* ---------- layout-group.tsx ---------- */
// MotionConfig transition={{ layout: { type: "tween", duration: 0.2 } }} resolves to this on every element
const LG_T = { layout: { type: 'tween', duration: 0.2 } } as const;
class Expander extends Component {
  @tracked expanded = false;
  id = guidFor(this);
  transition = { type: 'tween', layout: LG_T.layout } as const;
  get style() { return { height: this.expanded ? 100 : 25, backgroundColor: 'red', marginBottom: 4, cursor: 'pointer' }; }
  toggle = () => { this.expanded = !this.expanded; };
  // motion.create(Fragment): a variant-controlling node without layout of its own
  <template>
    <div style="display:contents" {{motion}}>
      <div id="expander" {{motion layoutId=this.id style=this.style transition=this.transition}} {{on "click" this.toggle}}>{{if this.expanded "collapse" "expand"}} me</div>
    </div>
  </template>
}
class GroupButton extends Component<{ Args: { onClick: () => void } }> {
  id = guidFor(this);
  <template><div id="button" style="background:blue;color:white;border-radius:8px;padding:10px;cursor:pointer" {{motion layoutId=this.id transition=LG_T}} {{on "click" @onClick}}>Add child</div></template>
}
class LayoutGroupFixture extends Component {
  @tracked visible = false;
  toggle = () => { this.visible = !this.visible; };
  <template>
    <div style="display:flex;justify-content:center;height:100vh">
      <div style="display:flex;flex-direction:column;gap:10px;align-items:center;height:100vh;width:500px">
        {{#if this.visible}}<div style="background-color:green;width:100px;height:100px"></div>{{/if}}
        <LayoutGroup>
          <div id="expander-wrapper" {{motion layout="position" transition=LG_T}}><Expander /></div>
          <div id="text-wrapper" style="display:flex;gap:4px;align-items:center" {{motion layout="position" transition=LG_T}}>
            some text
            <LayoutGroup @inherit="id"><GroupButton @onClick={{this.toggle}} /></LayoutGroup>
          </div>
        </LayoutGroup>
      </div>
    </div>
  </template>
}

/* ---------- layout-viewport-jump.tsx ---------- */
const VJ_BOX = { width: 100, height: 100, borderRadius: 10, backgroundColor: '#ffaa00' };
const VJ_T = { ease: () => 0.1 };
class ViewportJump extends Component<{ Args: { nested?: boolean } }> {
  @tracked state = true;
  get containerStyle() { return `margin-top:100px;display:flex;justify-content:center;align-items:flex-start;height:${this.state ? '1000px' : 'auto'}`; }
  toggle = () => { this.state = !this.state; };
  <template>
    {{#if @nested}}
      <div id="scrollable" style="position:fixed;top:0;left:0;right:0;height:500px;overflow:scroll" {{motion layoutScroll=true}}>
        <div style={{this.containerStyle}}><div id="box" {{motion layout=true style=VJ_BOX transition=VJ_T}} {{on "click" this.toggle}}></div></div>
      </div>
    {{else}}
      <div style={{this.containerStyle}}><div id="box" {{motion layout=true style=VJ_BOX transition=VJ_T}} {{on "click" this.toggle}}></div></div>
    {{/if}}
  </template>
}

/* ---------- layout-appear-spring-bounce.tsx ---------- */
const SPRING_T = { type: 'spring', duration: 0.4, bounce: 0.2 } as const;
class AppearSpringBounce extends Component {
  opacity = motionValue(0.5);
  scale = motionValue(1);
  get boxStyle() { return { width: 115, height: 106, backgroundColor: 'rgb(68, 204, 255)', position: 'absolute', top: '50%', left: '50%', x: '-50%', y: '-50%', opacity: this.opacity, scale: this.scale }; }
  constructor(owner: unknown, args: object) {
    super(owner as never, args);
    schedule('afterRender', () => {
      // Simulate WAAPI handoff: inject velocity as if the appear animation was stopped mid-flight
      this.opacity.setWithVelocity(0.45, 0.5, 10);
      animate(this.opacity, 0.49, SPRING_T);
      animate(this.scale, 1.1, SPRING_T);
      let minOpacity = 0.5, maxOpacity = 0.5;
      this.opacity.on('change', (v) => {
        if (v < minOpacity) minOpacity = v;
        if (v > maxOpacity) maxOpacity = v;
        const tracker = document.getElementById('tracker');
        if (tracker) { tracker.dataset['minOpacity'] = minOpacity.toFixed(4); tracker.dataset['maxOpacity'] = maxOpacity.toFixed(4); }
      });
    });
  }
  <template>
    <div id="tracker"></div>
    <div style="position:absolute;top:50px;left:50px;width:231px;height:231px;background-color:rgb(153, 238, 255)" {{motion}}>
      <div id="box" {{motion style=this.boxStyle}}></div>
    </div>
  </template>
}

module('Integration | motion | cypress | Layout exit animations', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  test('Allows the animation to be marked complete', async function (assert) {
    await render(<template><LayoutGroup><LayoutExit /></LayoutGroup></template>);
    await wait(500); await settled();
    await should(assert, (a) => a.strictEqual(document.querySelector('#box'), null));
  });
});

module('Integration | motion | cypress | Cancelled Animation', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  test('Allows the animation to be marked complete', async function (assert) {
    await render(<template><LayoutGroup><CancelledFinishes /></LayoutGroup></template>);
    await click("[data-testid='cancellable']"); await wait(200); await settled();
    await should(assert, (a) => a.strictEqual(document.querySelector("[data-testid='cancellable']"), null));
  });
});

module('Integration | motion | cypress | Layout animation: Instant layout undo', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  test('Correctly cancels animation', async function (assert) {
    await render(<template><LayoutGroup><InstantUndo /></LayoutGroup></template>);
    await wait(50);
    await should(assert, (a) => expectBbox(a, $('#box'), { left: 200 }, 'round'));
    await click('#box'); await wait(50);
    await should(assert, (a) => expectBbox(a, $('#box'), { left: 200 }, 'round'));
  });
});

module('Integration | motion | cypress | Shared layout: Fragment', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  test('Elements with layoutId inside a Fragment should animate from the correct starting position', async function (assert) {
    await render(<template><LayoutGroup><SharedFragment /></LayoutGroup></template>);
    await wait(50);
    await should(assert, (a) => expectBbox(a, $('#box'), { top: 100, left: 0, width: 100, height: 100 }));
    await click('#box'); await wait(200);
    // At ease: () => 0.5, the element should be halfway between top: 100 and top: 300, i.e. top: 200.
    await should(assert, (a) => a.strictEqual($('#box').getBoundingClientRect().top, 200));
  });
});

module('Integration | motion | cypress | LayoutGroup inherit="id"', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks, { width: 500, height: 500 });
  const top = () => Math.round($('#button').getBoundingClientRect().top);
  // The upstream spec hard-codes the resting tops as 104 / 204. Chrome lays this DOM out 10px lower per flex
  // gap (the column has gap: 10, so 114 / 224) — measured on the plain markup without any motion in play —
  // and the upstream literals equal the same layout without the gap. The port asserts the rest position
  // the way the spec means it: where the button lands once the expander has grown by 75px.
  const GROWTH = 75;

  test('relative children should not instantly jump to new layout', async function (assert) {
    await render(<template><LayoutGroupFixture /></template>);
    await wait(250);
    const initialTop = top();
    await click('#expander');
    await wait(100);
    const top100ms = top();
    assert.notStrictEqual(top100ms, initialTop + GROWTH);
    assert.notStrictEqual(top100ms, initialTop);
    await wait(200);
    const top200ms = top();
    assert.strictEqual(top200ms, initialTop + GROWTH);
    assert.notStrictEqual(top200ms, initialTop);
    assert.notStrictEqual(top200ms, top100ms);
  });

  test('relative children should not instantly jump to new layout, after performing their own layout animation', async function (assert) {
    await render(<template><LayoutGroupFixture /></template>);
    await wait(250);
    await click('#button'); await wait(50);
    const initialTop = top();
    await wait(300); await click('#expander');
    await wait(100);
    const top100ms = top();
    assert.notStrictEqual(top100ms, initialTop + GROWTH);
    assert.notStrictEqual(top100ms, initialTop);
    await wait(200);
    const top200ms = top();
    assert.strictEqual(top200ms, initialTop + GROWTH);
    assert.notStrictEqual(top200ms, initialTop);
    assert.notStrictEqual(top200ms, top100ms);
  });

  test('should return to original state when expander is clicked twice with delay', async function (assert) {
    await render(<template><LayoutGroupFixture /></template>);
    await wait(250);
    const initialTop = top();
    await click('#expander');
    await wait(100);
    const top100ms = top();
    assert.notStrictEqual(top100ms, initialTop + GROWTH);
    assert.notStrictEqual(top100ms, initialTop);
    await wait(50); await click('#expander');
    await wait(300);
    assert.strictEqual(top(), initialTop);
  });
});

module('Integration | motion | cypress | Viewport jump', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks, { width: 1000, height: 600, scroll: true });
  test("If viewport jumps, don't trigger layout animation", async function (assert) {
    await render(<template><LayoutGroup><ViewportJump /></LayoutGroup></template>);
    await wait(50);
    await should(assert, (a) => expectBbox(a, $('#box'), { height: 100, top: 100, width: 100 }, 'floor'));
    window.scrollTo(0, 100);
    await should(assert, (a) => expectBbox(a, $('#box'), { height: 100, top: 0, width: 100 }, 'floor'));
    await click('#box'); await wait(50);
    await should(assert, (a) => expectBbox(a, $('#box'), { height: 100, top: 100, width: 100 }, 'floor'));
  });
  test("If div scroll jumps, don't trigger layout animation if provided layoutScroll prop", async function (assert) {
    await render(<template><LayoutGroup><ViewportJump @nested={{true}} /></LayoutGroup></template>);
    await wait(50);
    await should(assert, (a) => expectBbox(a, $('#box'), { height: 100, top: 100, width: 100 }, 'floor'));
    $('#scrollable').scrollTo(0, 100);
    await should(assert, (a) => expectBbox(a, $('#box'), { height: 100, top: 0, width: 100 }, 'floor'));
    await click('#box'); await wait(50);
    await should(assert, (a) => expectBbox(a, $('#box'), { height: 100, top: 100, width: 100 }, 'floor'));
  });
});

module('Integration | motion | cypress | Time-defined spring with inherited velocity', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  test("Doesn't wildly oscillate when velocity is inherited from interrupted animation", async function (assert) {
    await render(<template><AppearSpringBounce /></template>);
    await wait(1500);
    await should(assert, (a) => {
      const maxOpacity = Number($('#tracker').dataset['maxOpacity']);
      a.true(maxOpacity < 0.55, `Opacity overshot to ${maxOpacity} (start: 0.5, target: 0.49). Time-defined spring should ignore inherited velocity.`);
    });
  });
});
