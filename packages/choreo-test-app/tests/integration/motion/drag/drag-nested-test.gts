/**
 * Ports of Motion's packages/framer-motion/cypress/integration/drag-nested.ts (fixture drag-layout-nested) and
 * layout-relative-drag.ts (fixture layout-relative-drag), motion@bbabb00. URL params → component args.
 */
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import motion from 'glimmer-motion/motion';
import LayoutGroup from 'glimmer-motion/layout-group';
import { setupFixtureViewport, should, expectBbox, wait, trigger, $ } from '../../../helpers/layout-fixture';

/* ---------- drag-layout-nested.tsx ---------- */
const B = { position: 'absolute', top: 100, left: 100, width: 300, height: 300, borderRadius: 10, background: '#ff0055' };
const A = { position: 'relative', top: 50, left: 50, width: 600, height: 200, background: '#ffcc00', borderRadius: 10 };
const C = { position: 'relative', top: 50, left: 50, width: 100, height: 100, background: '#ffaa00', borderRadius: 10 };
interface NestedArgs { parentLayout?: boolean; childLayout?: boolean; constraints?: boolean; animation?: boolean; bothAxes?: boolean }
class Nested extends Component<{ Args: NestedArgs }> {
  get parentDrag(): true | 'y' { return this.args.bothAxes ? 'y' : true; }
  get childDrag(): true | 'x' { return this.args.bothAxes ? 'x' : true; }
  get momentum() { return Boolean(this.args.animation); }
  get elastic(): number | false { return this.args.constraints && this.args.animation ? 0.5 : false; }
  get parentConstraints() { return this.args.constraints ? { top: -10, right: 100 } : false; }
  get childConstraints() { return this.args.constraints ? { top: 0, left: -100, right: 100 } : false; }
  <template>
    <div>
      <div id="parent" {{motion drag=this.parentDrag dragMomentum=this.momentum dragElastic=this.elastic dragConstraints=this.parentConstraints layout=(if @parentLayout true undefined) style=B}}>
        <div id="child" {{motion drag=this.childDrag dragMomentum=this.momentum dragElastic=this.elastic dragConstraints=this.childConstraints layout=(if @childLayout true undefined) style=A}}>
          <div id="control" {{motion layoutId="test" style=C}}></div>
        </div>
      </div>
    </div>
  </template>
}

/* ---------- layout-relative-drag.tsx ---------- */
const RP = { width: 200, height: 200, background: 'red' };
const RC = { width: 100, height: 100, background: 'blue' };
const RelativeDrag = <template>
  <div id="parent" {{motion drag=true dragElastic=0 dragMomentum=false layout=true style=RP}}>
    <div id="child" {{motion layout=true style=RC}}></div>
  </div>
</template>;

const bbox = (assert: Assert, sel: string, box: { top: number; left: number; width?: number; height?: number }) =>
  should(assert, (a) => expectBbox(a, $(sel), box));

const variants: [string, boolean, boolean][] = [['Parent: layout, Child: layout', true, true], ['Parent: layout', true, false], ['Child: layout', false, true], ['Neither', false, false]];

module('Integration | motion | cypress | Nested drag', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  for (const [name, parentLayout, childLayout] of variants) {
    test(name, async function (assert) {
      await render(<template><LayoutGroup><Nested @parentLayout={{parentLayout}} @childLayout={{childLayout}} /></LayoutGroup></template>);
      await wait(200);
      await bbox(assert, '#parent', { top: 100, left: 100, width: 300, height: 300 });
      await bbox(assert, '#child', { top: 150, left: 150, width: 600, height: 200 });
      await bbox(assert, '#control', { top: 200, left: 200 });
      trigger('#parent', 'pointerdown', 5, 5); await wait(50);
      trigger('#parent', 'pointermove', 10, 10); await wait(50);
      trigger('#parent', 'pointermove', 50, 50); await wait(50);
      trigger('#parent', 'pointerup');
      await bbox(assert, '#parent', { top: 150, left: 150, width: 300, height: 300 });
      await bbox(assert, '#control', { top: 250, left: 250 });
      await bbox(assert, '#child', { top: 200, left: 200, width: 600, height: 200 });
      trigger('#child', 'pointerdown', 5, 5); await wait(50);
      trigger('#child', 'pointermove', 10, 10); await wait(50);
      trigger('#child', 'pointermove', 50, 50); await wait(50);
      await bbox(assert, '#parent', { top: 150, left: 150, width: 300, height: 300 });
      await bbox(assert, '#child', { top: 250, left: 250, width: 600, height: 200 });
      await bbox(assert, '#control', { top: 300, left: 300 });
      trigger('#child', 'pointerup'); await wait(50);
      await bbox(assert, '#parent', { top: 150, left: 150, width: 300, height: 300 });
      await bbox(assert, '#child', { top: 250, left: 250, width: 600, height: 200 });
      await bbox(assert, '#control', { top: 300, left: 300 });
      trigger('#parent', 'pointerdown', 5, 5); await wait(50);
      trigger('#parent', 'pointermove', 10, 10); await wait(50);
      trigger('#parent', 'pointermove', 50, 50); await wait(50);
      trigger('#parent', 'pointerup');
      await bbox(assert, '#parent', { top: 200, left: 200, width: 300, height: 300 });
      await bbox(assert, '#child', { top: 300, left: 300, width: 600, height: 200 });
      await bbox(assert, '#control', { top: 350, left: 350 });
    });
  }
});

module('Integration | motion | cypress | Nested drag with constraints', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  for (const [name, parentLayout, childLayout] of variants) {
    test(name, async function (assert) {
      await render(<template><LayoutGroup><Nested @constraints={{true}} @parentLayout={{parentLayout}} @childLayout={{childLayout}} /></LayoutGroup></template>);
      await wait(200);
      trigger('#parent', 'pointerdown', 40, 40); await wait(50);
      trigger('#parent', 'pointermove', 35, 35); await wait(50);
      trigger('#parent', 'pointermove', 20, 20); await wait(50);
      trigger('#parent', 'pointerup');
      // Should have only moved 10 px to the top
      await bbox(assert, '#parent', { top: 90, left: 75, width: 300, height: 300 });
      await bbox(assert, '#child', { top: 140, left: 125, width: 600, height: 200 });
      await bbox(assert, '#control', { top: 190, left: 175 });
      trigger('#parent', 'pointerdown', 5, 5); await wait(50);
      trigger('#parent', 'pointermove', 10, 10); await wait(50);
      trigger('#parent', 'pointermove', 200, 100); await wait(50);
      trigger('#parent', 'pointerup');
      await bbox(assert, '#parent', { top: 190, left: 200, width: 300, height: 300 });
      await bbox(assert, '#control', { top: 290, left: 300 });
      await bbox(assert, '#child', { top: 240, left: 250, width: 600, height: 200 });
      trigger('#child', 'pointerdown', 5, 5); await wait(50);
      trigger('#child', 'pointermove', 10, 10); await wait(50);
      trigger('#child', 'pointermove', 300, 100); await wait(50);
      trigger('#child', 'pointerup');
      await bbox(assert, '#parent', { top: 190, left: 200, width: 300, height: 300 });
      await bbox(assert, '#child', { top: 340, left: 350, width: 600, height: 200 });
      await bbox(assert, '#control', { top: 390, left: 400 });
    });
  }
});

module('Integration | motion | cypress | Nested drag with alternate draggable axes', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  for (const [name, parentLayout, childLayout] of variants) {
    test(name, async function (assert) {
      await render(<template><LayoutGroup><Nested @bothAxes={{true}} @parentLayout={{parentLayout}} @childLayout={{childLayout}} /></LayoutGroup></template>);
      await wait(200);
      trigger('#child', 'pointerdown', 5, 5); await wait(80);
      trigger('#child', 'pointermove', 10, 10); await wait(80);
      trigger('#child', 'pointermove', 100, 100); await wait(80);
      await bbox(assert, '#child', { top: 250, left: 250, width: 600, height: 200 });
      await bbox(assert, '#control', { top: 300, left: 300 });
      await bbox(assert, '#parent', { top: 200, left: 100, width: 300, height: 300 });
      await wait(30);
      trigger('#child', 'pointerup'); await wait(80);
      await bbox(assert, '#child', { top: 250, left: 250, width: 600, height: 200 });
      await bbox(assert, '#control', { top: 300, left: 300 });
      await bbox(assert, '#parent', { top: 200, left: 100, width: 300, height: 300 });
    });
  }
});

module('Integration | motion | cypress | Nested drag with constraints and animation', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  for (const [name, parentLayout, childLayout] of variants) {
    test(name, async function (assert) {
      await render(<template><LayoutGroup><Nested @constraints={{true}} @animation={{true}} @parentLayout={{parentLayout}} @childLayout={{childLayout}} /></LayoutGroup></template>);
      await wait(200);
      trigger('#parent', 'pointerdown', 5, 10); await wait(50);
      trigger('#parent', 'pointermove', 10, 10); await wait(50);
      trigger('#parent', 'pointermove', 200, 10); await wait(50);
      await bbox(assert, '#parent', { top: 100, left: 250, width: 300, height: 300 });
      await bbox(assert, '#child', { top: 150, left: 300, width: 600, height: 200 });
      await bbox(assert, '#control', { top: 200, left: 350 });
      trigger('#parent', 'pointerup'); await wait(2000);
      await bbox(assert, '#parent', { top: 100, left: 200, width: 300, height: 300 });
      await bbox(assert, '#child', { top: 150, left: 250, width: 600, height: 200 });
      await bbox(assert, '#control', { top: 200, left: 300 });
      trigger('#child', 'pointerdown', 5, 10); await wait(50);
      trigger('#child', 'pointermove', 10, 10); await wait(50);
      trigger('#child', 'pointermove', 200, 10); await wait(70);
      await bbox(assert, '#child', { top: 150, left: 400, width: 600, height: 200 });
      trigger('#child', 'pointerup'); await wait(2000);
      await bbox(assert, '#child', { top: 150, left: 350, width: 600, height: 200 });
    });
  }
});

module('Integration | motion | cypress | Relative projection targets: Drag', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  test('Child correctly follows parent', async function (assert) {
    await render(<template><LayoutGroup><RelativeDrag /></LayoutGroup></template>);
    await wait(50);
    await bbox(assert, '#parent', { top: 0, left: 0, width: 200, height: 200 });
    await bbox(assert, '#child', { top: 0, left: 0, width: 100, height: 100 });
    trigger('#parent', 'pointerdown', 5, 5); trigger('#parent', 'pointermove', 10, 10); await wait(50);
    trigger('#parent', 'pointermove', 110, 110);
    await bbox(assert, '#parent', { top: 110, left: 110, width: 200, height: 200 });
    await bbox(assert, '#child', { top: 110, left: 110, width: 100, height: 100 });
    trigger('#parent', 'pointerup');
  });
});
