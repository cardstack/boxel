/**
 * Ports of framer-motion/cypress/integration/drag-svg.ts (fixture drag-svg) and drag-svg-viewbox.ts
 * (fixture drag-svg-viewbox), motion@bbabb00. The commented-out upstream direction-lock cases stay out.
 * MotionConfig transformPagePoint → the `transformPagePoint` arg on the draggable itself.
 */
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import motion from 'glimmer-motion/motion';
import LayoutGroup from 'glimmer-motion/layout-group';
import { transformViewBoxPoint } from 'glimmer-motion/gestures/transform-page-point';
import { setupFixtureViewport, should, wait, trigger, $ } from '../../../helpers/layout-fixture';
import { captureEl, createRef } from '../../../helpers/capture-el';

/* ---------- drag-svg.tsx ---------- */
interface SvgArgs { axis?: 'x' | 'y'; lock?: boolean; top?: number; left?: number; right?: number; bottom?: number; layout?: boolean }
class DragSvg extends Component<{ Args: SvgArgs }> {
  get drag(): true | 'x' | 'y' { return this.args.axis ?? true; }
  get constraints() { const { top, left, right, bottom } = this.args; return { top, left, right, bottom }; }
  <template>
    <svg style="width:500px;height:500px">
      <circle id="box" data-testid="draggable" fill="red" cx="50" cy="50" r="20"
        {{motion drag=this.drag dragElastic=0 dragMomentum=false dragConstraints=this.constraints dragDirectionLock=(if @lock true false) layout=(if @layout true undefined)}} />
    </svg>
  </template>
}

/* ---------- drag-svg-viewbox.tsx ---------- */
interface ViewBoxArgs { viewBoxX?: number; viewBoxY?: number; viewBoxWidth?: number; viewBoxHeight?: number; svgWidth?: number; svgHeight?: number }
class DragSvgViewBox extends Component<{ Args: ViewBoxArgs }> {
  svgRef = createRef<SVGSVGElement>();
  transformPagePoint = transformViewBoxPoint(this.svgRef);
  get viewBox() { const a = this.args; return `${a.viewBoxX ?? 0} ${a.viewBoxY ?? 0} ${a.viewBoxWidth ?? 100} ${a.viewBoxHeight ?? 100}`; }
  get width() { return this.args.svgWidth ?? 500; }
  get height() { return this.args.svgHeight ?? 500; }
  <template>
    <svg viewBox={{this.viewBox}} width={{this.width}} height={{this.height}} style="border:1px solid black" {{captureEl this.svgRef}}>
      <rect data-testid="draggable" x="10" y="10" width="20" height="20" fill="red"
        {{motion drag=true dragElastic=0 dragMomentum=false transformPagePoint=this.transformPagePoint}} />
    </svg>
  </template>
}

const D = "[data-testid='draggable']";
const pos = (assert: Assert, left: number, top: number) =>
  should(assert, (a) => { const r = $(D).getBoundingClientRect(); a.strictEqual(r.left, left, 'left'); a.strictEqual(r.top, top, 'top'); });

for (const layout of [false, true]) {
  module(`Integration | motion | cypress | ${layout ? 'Drag SVG & Layout' : 'Drag SVG'}`, function (hooks) {
    setupRenderingTest(hooks);
    setupFixtureViewport(hooks);

    test('Drags the element by the defined distance', async function (assert) {
      await render(<template><LayoutGroup><DragSvg @layout={{layout}} /></LayoutGroup></template>);
      await wait(50);
      if (layout) { await pos(assert, 30, 30); await wait(50); }
      trigger(D, 'pointerdown', 50, 50); if (!layout) await wait(50);
      trigger(D, 'pointermove', 60, 60); await wait(layout ? 50 : 100);
      trigger(D, 'pointermove', layout ? 200 : 210, layout ? 300 : 310); await wait(layout ? 50 : 100);
      trigger(D, 'pointerup');
      await pos(assert, layout ? 190 : 200, layout ? 290 : 300);
    });

    test('Locks drag to x', async function (assert) {
      await render(<template><LayoutGroup><DragSvg @axis="x" @layout={{layout}} /></LayoutGroup></template>);
      await wait(layout ? 400 : 200);
      trigger(D, 'pointerdown', 50, 50); if (layout) await wait(50);
      trigger(D, 'pointermove', 60, 60); await wait(50);
      trigger(D, 'pointermove', 200, 300); await wait(50);
      trigger(D, 'pointerup');
      await pos(assert, 190, 30);
    });

    test('Locks drag to y', async function (assert) {
      await render(<template><LayoutGroup><DragSvg @axis="y" @layout={{layout}} /></LayoutGroup></template>);
      await wait(layout ? 400 : 200);
      trigger(D, 'pointerdown', 50, 50); if (layout) await wait(50);
      trigger(D, 'pointermove', 60, 60); await wait(50);
      trigger(D, 'pointermove', 200, 300); await wait(50);
      trigger(D, 'pointerup');
      await pos(assert, 30, 290);
    });

    test('Constraints as object: bottom right', async function (assert) {
      await render(<template><LayoutGroup><DragSvg @right={{100}} @bottom={{100}} @layout={{layout}} /></LayoutGroup></template>);
      await wait(layout ? 400 : 300);
      trigger(D, 'pointerdown', 50, 50); trigger(D, 'pointermove', 60, 60); await wait(50);
      trigger(D, 'pointermove', 200, 200); await wait(50);
      trigger(D, 'pointerup');
      await pos(assert, 130, 130);
    });

    test('Constraints as object: top left', async function (assert) {
      await render(<template><LayoutGroup><DragSvg @left={{-10}} @top={{-10}} @layout={{layout}} /></LayoutGroup></template>);
      await wait(layout ? 400 : 300);
      trigger(D, 'pointerdown', 50, 50); trigger(D, 'pointermove', 60, 60); await wait(50);
      trigger(D, 'pointermove', 10, 10); await wait(50);
      trigger(D, 'pointerup');
      await pos(assert, 20, 20);
    });
  });
}

function parseTranslate(transform: string) {
  const x = transform.match(/translateX\(([-\d.]+)px\)/), y = transform.match(/translateY\(([-\d.]+)px\)/);
  return { x: x ? parseFloat(x[1]!) : 0, y: y ? parseFloat(y[1]!) : 0 };
}

module('Integration | motion | cypress | Drag SVG with viewBox', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  async function dragIt() {
    trigger(D, 'pointerdown', 10, 10); await wait(50);
    trigger(D, 'pointermove', 20, 20); await wait(50);
    trigger(D, 'pointermove', 110, 110); await wait(50);
    trigger(D, 'pointerup'); await wait(50);
  }
  const translated = (assert: Assert, x: number, dx: number, y: number, dy: number) =>
    should(assert, (a) => { const t = parseTranslate(($(D) as unknown as SVGElement).style.transform); a.closeTo(t.x, x, dx, 'x'); a.closeTo(t.y, y, dy, 'y'); });

  test('Correctly scales drag distance when viewBox differs from rendered size', async function (assert) {
    await render(<template><LayoutGroup><DragSvgViewBox /></LayoutGroup></template>);
    await wait(50);
    assert.strictEqual($(D).getAttribute('x'), '10'); assert.strictEqual($(D).getAttribute('y'), '10');
    await dragIt();
    // 100px in screen space → 20 SVG units (100 * 100/500)
    await translated(assert, 20, 3, 20, 3);
  });

  test('Works correctly when viewBox matches rendered size (no scaling)', async function (assert) {
    await render(<template><LayoutGroup><DragSvgViewBox @viewBoxWidth={{500}} @viewBoxHeight={{500}} @svgWidth={{500}} @svgHeight={{500}} /></LayoutGroup></template>);
    await wait(50);
    await dragIt();
    await translated(assert, 100, 15, 100, 15);
  });

  test('Handles non-uniform scaling (different x and y scale factors)', async function (assert) {
    await render(<template><LayoutGroup><DragSvgViewBox @viewBoxWidth={{100}} @viewBoxHeight={{200}} @svgWidth={{500}} @svgHeight={{400}} /></LayoutGroup></template>);
    await wait(50);
    await dragIt();
    await translated(assert, 20, 3, 50, 8);
  });

  test('Handles viewBox with non-zero origin', async function (assert) {
    await render(<template><LayoutGroup><DragSvgViewBox @viewBoxX={{50}} @viewBoxY={{50}} @viewBoxWidth={{100}} @viewBoxHeight={{100}} @svgWidth={{500}} @svgHeight={{500}} /></LayoutGroup></template>);
    await wait(50);
    await dragIt();
    await translated(assert, 20, 3, 20, 3);
  });
});
