/**
 * Ports of the Cypress specs about projection inside a tree (motion@bbabb00):
 * layout-relative-delay, layout-anchor, layout-resize, layout-read-transform,
 * layout-shared-percent-xy-parent, layout-percent-x-flex, layout-parent-xy-offset.
 * layout-relative-drag is not ported: the drag gesture feature is not in the binding yet.
 */
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render, click, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import motion from 'glimmer-motion/motion';
import LayoutGroup from 'glimmer-motion/layout-group';
import { setupFixtureViewport, should, expectBbox, wait, $ } from '../../../helpers/layout-fixture';

/* ---------- layout-relative-delay.tsx ---------- */
class RelativeDelay extends Component {
  @tracked state = true;
  frameCount = 0;
  // This is a bit funny but boxes are resolved relatively after the first frame
  transition = { ease: (t: number) => { this.frameCount++; return this.frameCount > 1 ? 0.5 : t; } };
  childTransition = { delay: 100 };
  get style() { return { position: 'absolute', top: this.state ? 0 : 200, left: this.state ? 0 : 200, width: this.state ? 200 : 400, height: 200, background: 'red' }; }
  get childStyle() { return { width: this.state ? 100 : 200, height: 100, background: 'blue' }; }
  toggle = () => { this.state = !this.state; };
  <template>
    <div id="parent" {{motion layout=true style=this.style transition=this.transition}} {{on "click" this.toggle}}>
      <div id="child" {{motion layout=true style=this.childStyle transition=this.childTransition}}></div>
    </div>
  </template>
}

/* ---------- layout-anchor.tsx (the three boxes; the slider panel only sets anchor values) ---------- */
const LINEAR = { type: 'tween', ease: 'linear', duration: 1 } as const;
const LINEAR_DELAYED = { type: 'tween', ease: 'linear', duration: 1, delay: 0.5 } as const;
const CENTER = { x: 0.5, y: 0.5 };
class Anchor extends Component {
  @tracked expanded = false;
  get parentStyle() { const s = this.expanded ? 400 : 200; return { display: 'flex', alignItems: 'center', justifyContent: 'center', width: s, height: s, background: 'rgba(0,0,0,0.1)', cursor: 'pointer' }; }
  toggle = () => { this.expanded = !this.expanded; };
  <template>
    <div style="display:flex;gap:40px;padding:20px">
      <div>
        <div style="font:13px system-ui;margin-bottom:8px;color:#aaa">With layoutAnchor (green)</div>
        <div id="parent" {{motion layout=true style=this.parentStyle transition=LINEAR}} {{on "click" this.toggle}}>
          <div id="child-anchored" style="width:50px;height:50px;background:green" {{motion layout=true layoutAnchor=CENTER transition=LINEAR_DELAYED}}></div>
        </div>
      </div>
      <div>
        <div style="font:13px system-ui;margin-bottom:8px;color:#aaa">Without layoutAnchor (red)</div>
        <div id="parent-no-anchor" {{motion layout=true style=this.parentStyle transition=LINEAR}} {{on "click" this.toggle}}>
          <div id="child-no-anchor" style="width:50px;height:50px;background:red" {{motion layout=true transition=LINEAR_DELAYED}}></div>
        </div>
      </div>
      <div>
        <div style="font:13px system-ui;margin-bottom:8px;color:#aaa">layoutAnchor=false (blue)</div>
        <div id="parent-false-anchor" {{motion layout=true style=this.parentStyle transition=LINEAR}} {{on "click" this.toggle}}>
          <div id="child-false-anchor" style="width:50px;height:50px;background:dodgerblue" {{motion layout=true layoutAnchor=false transition=LINEAR_DELAYED}}></div>
        </div>
      </div>
    </div>
  </template>
}

/* ---------- layout-resize.tsx ---------- */
const RS_BOX = { position: 'absolute', top: 0, left: 0, background: 'red' };
const RS_A = { ...RS_BOX, width: 100, height: 100 };
const RS_B = { ...RS_BOX, width: 400, height: 200, top: 100, left: 100 };
class Resize extends Component<{ Args: { type?: string } }> {
  @tracked state = true;
  transition = { duration: 3 };
  get layout() { return (this.args.type ?? true) as true | 'position' | 'size'; }
  get style() { return this.state ? RS_A : RS_B; }
  toggle = () => { this.state = !this.state; };
  <template>
    <div id="box" {{motion layout=this.layout style=this.style transition=this.transition}} {{on "click" this.toggle}}>
      <div id="child" style="width:100px;height:100px;background:blue" {{motion layout=true transition=this.transition}}></div>
    </div>
  </template>
}

/* ---------- layout-read-transform.tsx ---------- */
class ReadTransform extends Component {
  @tracked step = 0;
  transition = { duration: 0.05 };
  scale2 = { scale: 2 };
  none = {};
  constructor(owner: unknown, args: object) {
    super(owner as never, args);
    const tick = () => { if (this.step < 2) { this.step++; setTimeout(tick, 100); } };
    setTimeout(tick, 100);
  }
  get animate() { return this.step === 1 ? this.scale2 : this.none; }
  get style() { const s = this.step === 0 ? 100 : 200; return { background: 'red', width: s, height: s }; }
  // key={step === 0 ? "0" : "1"}: a remount between step 0 and 1
  <template>
    {{#if (eq this.step 0)}}
      <div id="box" {{motion layoutId="box" animate=this.animate transition=this.transition style=this.style}}></div>
    {{else}}
      <div id="box" {{motion layoutId="box" animate=this.animate transition=this.transition style=this.style}}></div>
    {{/if}}
  </template>
}

/* ---------- layout-shared-percent-xy-parent.tsx ---------- */
const PXY_T = { duration: 10, ease: () => 0.5 };
const PXY_STYLE = { x: '25%', y: '25%', width: 300 };
class PercentXYParent extends Component {
  @tracked selected = 0;
  tabs = [0, 1, 2];
  pick = (i: number) => { this.selected = i; };
  <template>
    <div {{motion style=PXY_STYLE}}>
      <div style="display:flex;height:32px">
        {{#each this.tabs as |index|}}
          <div id="tab-{{index}}" style="flex:1;position:relative;cursor:pointer" {{on "click" (fn this.pick index)}}>
            {{#if (eq this.selected index)}}<div id="indicator" style="position:absolute;left:0;right:0;bottom:0;height:4px;background:red" {{motion layoutId="indicator" transition=PXY_T}}></div>{{/if}}
          </div>
        {{/each}}
      </div>
    </div>
  </template>
}

/* ---------- layout-percent-x-flex.tsx ---------- */
const PXF_STYLE = { width: 100, height: 100, background: 'red', flexShrink: 0 };
const PXF_T = { duration: 10 };
const X100 = { x: '100%' }, X0 = { x: 0 };
class PercentXFlex extends Component {
  @tracked items = [{ id: 0, isAdded: false }, { id: 1, isAdded: false }];
  get rows() { return this.items.map((item, i) => ({ key: String(item.id), id: item.id, shouldAnimate: i === this.items.length - 1 && item.isAdded })); }
  add = () => { this.items = [...this.items, { id: this.items.length, isAdded: true }]; };
  <template>
    <div style="display:flex;flex-direction:column;align-items:center;padding:20px">
      <button type="button" id="add" {{on "click" this.add}}>Add</button>
      <div style="display:flex;gap:10px;margin-top:20px">
        {{#each this.rows key="key" as |it|}}
          <div id="item-{{it.id}}" {{motion layout=true initial=(if it.shouldAnimate X100 undefined) animate=(if it.shouldAnimate X0 undefined) transition=PXF_T style=PXF_STYLE}}></div>
        {{/each}}
      </div>
    </div>
  </template>
}

/* ---------- layout-parent-xy-offset.tsx ---------- */
class Tabs extends Component {
  items = ['a', 'b', 'c', 'd', 'e'];
  @tracked selectedIndex = 0;
  uuid = guidFor(this);
  get layoutId() { return 'selected-' + this.uuid; }
  pick = (i: number) => { this.selectedIndex = i; };
  <template>
    <div style="display:flex;gap:10px;height:64px;width:500px;margin-bottom:12px">
      {{#each this.items as |item index|}}
        <div style="flex:1;border-radius:8px;position:relative;display:flex;align-items:center;justify-content:center;background:#eee" {{on "click" (fn this.pick index)}}>
          <div style="position:relative;z-index:1;color:white">{{item}}</div>
          {{#if (eq this.selectedIndex index)}}<div class="indicator" style="position:absolute;top:4px;left:4px;right:4px;bottom:4px;background:#444ccc;border-radius:8px" {{motion layoutId=this.layoutId}}></div>{{/if}}
        </div>
      {{/each}}
    </div>
  </template>
}
const XY50 = { x: 50, y: 50 };
const ParentXYOffset = <template>
  <div style="padding:12px">
    <div id="motion-parent" {{motion style=XY50}}>
      <div style="margin-bottom:12px">Motion (x: 50, y: 50)</div>
      <Tabs />
    </div>
    <div style="transform:translate3d(50px, 50px, 0)">
      <div style="margin-bottom:12px">Transform</div>
      <Tabs />
    </div>
    <div id="result"></div>
  </div>
</template>;

function eq(a: unknown, b: unknown) { return a === b; }
function fn<A extends unknown[]>(f: (...a: A) => void, ...bound: A) { return () => f(...bound); }

module('Integration | motion | cypress | Relative projection targets: Delay', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  test('Child correctly follows parent', async function (assert) {
    await render(<template><LayoutGroup><RelativeDelay /></LayoutGroup></template>);
    await wait(50);
    await should(assert, (a) => expectBbox(a, $('#parent'), { top: 0, left: 0, width: 200, height: 200 }, 'round'));
    await should(assert, (a) => expectBbox(a, $('#child'), { top: 0, left: 0, width: 100, height: 100 }, 'round'));
    await click('#parent'); await wait(50);
    await should(assert, (a) => expectBbox(a, $('#parent'), { top: 100, left: 100, width: 300, height: 200 }, 'round'));
    await should(assert, (a) => expectBbox(a, $('#child'), { top: 100, left: 100, width: 100, height: 100 }, 'round'));
  });
});

module('Integration | motion | cypress | layoutAnchor: centered child stays centered during parent resize', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  test('Child with layoutAnchor={x:0.5,y:0.5} stays centered mid-animation', async function (assert) {
    await render(<template><LayoutGroup><Anchor /></LayoutGroup></template>);
    await wait(50);
    await click('#parent');
    // Wait 250ms (25% through 1s linear parent animation, child hasn't started yet)
    await wait(250);
    const p = $('#parent').getBoundingClientRect(); const c = $('#child-anchored').getBoundingClientRect();
    assert.true(Math.abs(c.left + c.width / 2 - (p.left + p.width / 2)) <= 15, 'x centered');
    assert.true(Math.abs(c.top + c.height / 2 - (p.top + p.height / 2)) <= 15, 'y centered');
  });
  test('Child without layoutAnchor drifts from center mid-animation', async function (assert) {
    await render(<template><LayoutGroup><Anchor /></LayoutGroup></template>);
    await wait(50);
    await click('#parent'); await wait(250);
    const p = $('#parent-no-anchor').getBoundingClientRect(); const c = $('#child-no-anchor').getBoundingClientRect();
    const drift = Math.abs(c.left + c.width / 2 - (p.left + p.width / 2));
    assert.true(drift > 5, `drift ${drift}`);
  });
});

module('Integration | motion | cypress | Resize window', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  test('Finishes the animation and blocks animation on immediate layout animations until 250ms', async function (assert) {
    await render(<template><LayoutGroup><Resize /></LayoutGroup></template>);
    await wait(50);
    await should(assert, (a) => expectBbox(a, $('#box'), { top: 0, left: 0, width: 100, height: 100 }, 'round'));
    await should(assert, (a) => expectBbox(a, $('#child'), { top: 0, left: 0, width: 100, height: 100 }, 'round'));
    await click('#box'); await wait(50);
    // cy.viewport(200, 200): a test cannot resize the browser window; the projection root reacts to the
    // window resize event, which is what the viewport change delivers
    window.dispatchEvent(new Event('resize')); await wait(100);
    await should(assert, (a) => expectBbox(a, $('#box'), { top: 100, left: 100, width: 400, height: 200 }, 'round'));
    await should(assert, (a) => expectBbox(a, $('#child'), { top: 100, left: 100, width: 100, height: 100 }, 'round'));
    await click('#box'); await wait(50);
    await should(assert, (a) => expectBbox(a, $('#box'), { top: 0, left: 0, width: 100, height: 100 }, 'round'));
    await should(assert, (a) => expectBbox(a, $('#child'), { top: 0, left: 0, width: 100, height: 100 }, 'round'));
    await wait(200);
    await click('#box'); await wait(300);
    await should(assert, (a) => { const t = Math.round($('#box').getBoundingClientRect().top); a.notStrictEqual(t, 0); a.notStrictEqual(t, 100); });
  });
});

module('Integration | motion | cypress | Read initial transform during layout animation', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  test('Should not read a projection transform as the initial transform', async function (assert) {
    await render(<template><LayoutGroup><ReadTransform /></LayoutGroup></template>);
    await wait(400);
    await should(assert, (a) => expectBbox(a, $('#box'), { top: 0, left: 0, width: 200, height: 200 }, 'round'));
  });
});

module('Integration | motion | cypress | Layout animation with percentage x/y parent (#3254)', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  test('layoutId indicator animates to correct position within parent with percentage x/y', async function (assert) {
    await render(<template><LayoutGroup><PercentXYParent /></LayoutGroup></template>);
    await wait(200);
    assert.ok($('#indicator'));
    await click('#tab-2'); await wait(500);
    // Parent is 300px wide with x: "25%" = 75px. Tab 0 starts at 75, tab 2 at 275; ease () => 0.5 holds it at 175.
    await should(assert, (a) => { const left = $('#indicator').getBoundingClientRect().left; a.true(left > 100, `left ${left} > 100`); a.true(left < 250, `left ${left} < 250`); });
  });
});

module('Integration | motion | cypress | Layout animation: percentage x in flex container', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  test('Correctly layout-animates when sibling added before keyframes resolve', async function (assert) {
    await render(<template><LayoutGroup><PercentXFlex /></LayoutGroup></template>);
    await click('#add'); await click('#add'); await wait(300);
    await should(assert, (a) => { const t = $('#item-2').style.transform; a.notStrictEqual(t, 'none'); a.notStrictEqual(t, ''); });
  });
});

module('Integration | motion | cypress | Layout: nested in motion.div with x/y (#3244)', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  test('layoutId element inside motion.div with x/y should not get a projection transform on mount', async function (assert) {
    // the MutationObserver is set up before render so any transient projection transform is caught
    const transforms: string[] = [];
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName !== 'style') continue;
        const el = m.target as HTMLElement;
        if (!el.classList?.contains('indicator')) continue;
        if (!document.getElementById('motion-parent')?.contains(el)) continue;
        const t = el.style.transform;
        if (t && t !== 'none') transforms.push(t);
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true });
    await render(<template><LayoutGroup><ParentXYOffset /></LayoutGroup></template>);
    await wait(500); await settled();
    observer.disconnect();
    assert.strictEqual(transforms.length, 0, `expected no projection transforms but got: ${transforms.join(', ')}`);
  });
});
