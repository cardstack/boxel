/**
 * Port of framer-motion/cypress/integration/drag.ts (motion@bbabb00) with its fixtures
 * (drag, drag-ref-constraints, drag-ref-constraints-resize, drag-snap-to-cursor, drag-constraints-return).
 * cy.trigger(pointer…, x, y) → trigger(): coordinates relative to the element's current box, as in Cypress.
 * The two upstream commented-out "Direction locks to x" cases stay out.
 */
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { schedule } from '@ember/runloop';
import { registerDestructor } from '@ember/destroyable';
import { motionValue } from 'motion-dom';
import motion from 'glimmer-motion/motion';
import LayoutGroup from 'glimmer-motion/layout-group';
import { createDragControls } from 'glimmer-motion/gestures/DragControls';
import { setupFixtureViewport, should, wait, trigger, $ } from '../../../helpers/layout-fixture';

type Axis = true | 'x' | 'y';

/* ---------- drag.tsx ---------- */
interface DragArgs { axis?: 'x' | 'y'; lock?: boolean; percentage?: boolean; top?: number; left?: number; right?: number; bottom?: number; showChild?: boolean; return?: string; x?: number; y?: number; layout?: boolean }
class Drag extends Component<{ Args: DragArgs }> {
  get drag(): Axis { return this.args.axis ?? true; }
  get constraints() { const { top, left, right, bottom } = this.args; return { top, left, right, bottom }; }
  get snapToOrigin(): boolean | 'x' | 'y' { const r = this.args.return; return r === 'x' || r === 'y' ? r : Boolean(r); }
  get initial() {
    const v = (n?: number) => (!n ? 0 : this.args.percentage ? `${n}%` : n);
    return { width: 50, height: 50, background: 'red', x: v(this.args.x), y: v(this.args.y) };
  }
  constructor(owner: unknown, args: DragArgs) {
    super(owner as never, args);
    // We do this to test when scroll position isn't 0/0
    schedule('afterRender', () => window.scrollTo(0, 100));
  }
  <template>
    <div style="height:2000px;padding-top:100px">
      <div id="box" data-testid="draggable" {{motion drag=this.drag dragElastic=0 dragMomentum=false dragConstraints=this.constraints dragSnapToOrigin=this.snapToOrigin dragDirectionLock=(if @lock true false) layout=(if @layout true undefined) initial=this.initial}}>
        {{#if @showChild}}<div data-testid="draggable-child" style="width:50px;height:50px;background:blue"></div>{{/if}}
      </div>
    </div>
  </template>
}

/* ---------- drag-ref-constraints.tsx ---------- */
class SiblingLayoutAnimation extends Component {
  @tracked state = false;
  timer = 0;
  constructor(owner: unknown, args: object) {
    super(owner as never, args);
    const flip = () => { this.state = !this.state; this.timer = window.setTimeout(flip, 200); };
    this.timer = window.setTimeout(flip, 200);
    registerDestructor(this, () => clearTimeout(this.timer));
  }
  get style() { return { width: 200, height: 200, borderRadius: 20, background: 'blue', position: 'relative', left: this.state ? '100px' : '0' }; }
  <template><div {{motion layout=true style=this.style}}></div></template>
}
class RefConstraints extends Component<{ Args: { layout?: boolean } }> {
  @tracked dragging = false;
  @tracked container: Element | null = null;
  x = motionValue('100%');
  constructor(owner: unknown, args: object) {
    super(owner as never, args);
    schedule('afterRender', () => window.scrollTo(0, 100));
  }
  get style() { return { width: 50, height: 50, background: this.dragging ? 'yellow' : 'red', x: this.x }; }
  setContainer = (el: Element) => { this.container = el; };
  onDragStart = () => { this.dragging = true; };
  onDragEnd = () => { this.dragging = false; };
  <template>
    <div style="height:2000px;padding-top:100px">
      <div data-testid="constraint" style="width:200px;height:200px;background:blue" {{motion}} {{captureEl this.setContainer}}>
        <div id="box" data-testid="draggable" {{motion drag=true dragElastic=0 dragMomentum=false style=this.style dragConstraints=this.container layout=(if @layout true undefined) onDragStart=this.onDragStart onDragEnd=this.onDragEnd}}></div>
      </div>
    </div>
    <SiblingLayoutAnimation />
  </template>
}

/* ---------- drag-ref-constraints-resize.tsx ---------- */
class RefConstraintsResize extends Component {
  @tracked container: Element | null = null;
  setContainer = (el: Element) => { this.container = el; };
  <template>
    <div id="constraints" style="width:50%;height:300px;background:blue;border-radius:20px;display:flex;justify-content:center;align-items:center;margin:0 auto" {{captureEl this.setContainer}}>
      <div id="box" {{motion drag=true dragConstraints=this.container style=RESIZE_BOX}}></div>
    </div>
  </template>
}
const RESIZE_BOX = { width: 200, height: 200, background: 'red', borderRadius: 20 };

/* ---------- drag-snap-to-cursor.tsx ---------- */
class SnapToCursor extends Component {
  dragControls = createDragControls();
  startDrag = (e: PointerEvent) => this.dragControls.start(e, { snapToCursor: true });
  <template>
    <div style="position:absolute;top:0;bottom:0;left:0;right:0;background:black;padding-top:1000px;height:100vh;display:flex">
      <div id="scroll-trigger" style="width:200px;height:200px;background:rgba(255,255,255,0.5);border-radius:20px;margin:20px" {{on "pointerdown" this.startDrag}}></div>
      {{! 50vw upstream: the fixture viewport is 1000px wide, the window is not }}
      <div id="scrollable" style="width:500px;height:300px;background:white;border-radius:20px" {{motion drag=true dragControls=this.dragControls}}></div>
    </div>
  </template>
}

/* ---------- drag-constraints-return.tsx ---------- */
class ConstraintsReturn extends Component<{ Args: { layout?: boolean } }> {
  @tracked container: Element | null = null;
  setContainer = (el: Element) => { this.container = el; };
  <template>
    <div id="constraints" style="width:300px;height:300px;background:rgba(0,0,255,0.2)" {{motion}} {{captureEl this.setContainer}}>
      <div id="box" data-testid="draggable" style="width:100px;height:100px;background:red" {{motion drag=true dragConstraints=this.container dragElastic=1 dragMomentum=false layout=(if @layout true undefined)}}></div>
    </div>
  </template>
}

import { modifier } from 'ember-modifier';
const captureEl = modifier((el: Element, [set]: [(el: Element) => void]) => { set(el); });

const box = () => $("[data-testid='draggable']");
const rect = (sel = "[data-testid='draggable']") => $(sel).getBoundingClientRect();

/** the usual Cypress drag script: down at (x0,y0), nudge past the threshold, move, release */
async function dragBy(sel: string, from: [number, number], nudge: [number, number], to: [number, number], opts: { waitAfterDown?: number; waitAfterNudge?: number; waitAfterMove?: number } = {}) {
  trigger(sel, 'pointerdown', ...from); if (opts.waitAfterDown) await wait(opts.waitAfterDown);
  trigger(sel, 'pointermove', ...nudge); await wait(opts.waitAfterNudge ?? 50);
  trigger(sel, 'pointermove', ...to); await wait(opts.waitAfterMove ?? 50);
  trigger(sel, 'pointerup');
}

for (const layout of [false, true]) {
  module(`Integration | motion | cypress | ${layout ? 'Drag & Layout' : 'Drag'}`, function (hooks) {
    setupRenderingTest(hooks);
    setupFixtureViewport(hooks, { scroll: true });
    const D = "[data-testid='draggable']";

    test('Drags the element by the defined distance', async function (assert) {
      await render(<template><LayoutGroup><Drag @layout={{layout}} /></LayoutGroup></template>);
      await wait(200);
      await dragBy(D, [5, 5], [10, 10], [200, 300]);
      await should(assert, (a) => { const r = rect(); a.strictEqual(r.left, 200); a.strictEqual(r.top, 300); });
    });

    if (!layout) {
      test('Drags the element by the defined distance (child)', async function (assert) {
        await render(<template><LayoutGroup><Drag @showChild={{true}} /></LayoutGroup></template>);
        await wait(200);
        const C = "[data-testid='draggable-child']";
        await dragBy(C, [5, 5], [10, 10], [200, 300]);
        await should(assert, (a) => { const r = rect(C); a.strictEqual(r.left, 200); a.strictEqual(r.top, 300); });
      });
    }

    test('Drags the element by the defined distance with different initial offset', async function (assert) {
      await render(<template><LayoutGroup><Drag @x={{100}} @y={{100}} @layout={{layout}} /></LayoutGroup></template>);
      await wait(200);
      await dragBy(D, [5, 5], [10, 10], [200, 300]);
      // upstream asserts top: 300 and notes "This should actually be 400, but for some reason the test scroll
      // scrolls an additional 100px when dragging starts" — a Cypress artefact; the browser gives the 400
      await should(assert, (a) => { const r = rect(); a.strictEqual(r.left, 300); a.strictEqual(r.top, 400); });
    });

    if (!layout) {
      test('Drags the element by the defined distance with percentage initial offset', async function (assert) {
        await render(<template><LayoutGroup><Drag @x={{200}} @y={{200}} @percentage={{true}} /></LayoutGroup></template>);
        await wait(200);
        await dragBy(D, [5, 5], [10, 10], [200, 300]);
        // same Cypress scroll artefact as above: 400 is the browser's answer
        await should(assert, (a) => { const r = rect(); a.strictEqual(r.left, 300); a.strictEqual(r.top, 400); });
      });
    }

    test('Locks drag to x', async function (assert) {
      await render(<template><LayoutGroup><Drag @axis="x" @layout={{layout}} /></LayoutGroup></template>);
      await wait(200);
      await dragBy(D, [5, 5], [10, 10], [200, 300], { waitAfterDown: layout ? 0 : 50 });
      await should(assert, (a) => { const r = rect(); a.strictEqual(r.left, 200); a.strictEqual(r.top, 0); });
    });

    test('Locks drag to y', async function (assert) {
      await render(<template><LayoutGroup><Drag @axis="y" @layout={{layout}} /></LayoutGroup></template>);
      await wait(200);
      await dragBy(D, [5, 5], [10, 10], [200, 300]);
      await should(assert, (a) => { const r = rect(); a.strictEqual(r.left, 0); a.strictEqual(r.top, 300); });
    });

    test('Direction locks to y', async function (assert) {
      await render(<template><LayoutGroup><Drag @lock={{true}} @layout={{layout}} /></LayoutGroup></template>);
      await wait(layout ? 300 : 400);
      trigger(D, 'pointerdown', 5, 5); if (!layout) await wait(50);
      trigger(D, 'pointermove', 10, 10); await wait(100);
      trigger(D, 'pointermove', 10, 200); await wait(100);
      trigger(D, 'pointermove', 200, 10); await wait(100);
      trigger(D, 'pointerup');
      await should(assert, (a) => { const r = rect(); a.strictEqual(r.left, 0); a.strictEqual(r.top, 200); });
    });

    test('Constraints as object: bottom right', async function (assert) {
      await render(<template><LayoutGroup><Drag @right={{100}} @bottom={{100}} @layout={{layout}} /></LayoutGroup></template>);
      await wait(layout ? 200 : 300);
      await dragBy(D, [5, 5], [10, 10], [200, 200]);
      await should(assert, (a) => { const r = rect(); a.strictEqual(r.left, 100); a.strictEqual(r.top, 100); });
    });

    test('Constraints as object: top left', async function (assert) {
      await render(<template><LayoutGroup><Drag @left={{-10}} @top={{-10}} @layout={{layout}} /></LayoutGroup></template>);
      await wait(layout ? 200 : 300);
      await dragBy(D, [40, 40], [30, 30], [10, 10]);
      await should(assert, (a) => { const r = rect(); a.strictEqual(r.left, -10); a.strictEqual(r.top, -10); });
    });

    if (!layout) {
      test('Element returns to center with dragSnapToOrigin', async function (assert) {
        await render(<template><LayoutGroup><Drag @return="true" @left={{-10}} @top={{-10}} /></LayoutGroup></template>);
        await wait(300);
        trigger(D, 'pointerdown', 40, 40); trigger(D, 'pointermove', 30, 30); await wait(50);
        trigger(D, 'pointermove', 10, 10); await wait(50);
        await should(assert, (a) => { const r = rect(); a.strictEqual(r.left, -10); a.strictEqual(r.top, -10); });
        trigger(D, 'pointerup'); await wait(100);
        await should(assert, (a) => { const r = rect(); a.strictEqual(r.left, 0); a.strictEqual(r.top, 0); });
      });

      test("Element returns to center on x axis only with dragSnapToOrigin='x'", async function (assert) {
        await render(<template><LayoutGroup><Drag @return="x" @left={{-10}} @top={{-10}} /></LayoutGroup></template>);
        await wait(300);
        await dragBy(D, [40, 40], [30, 30], [10, 10]); await wait(300);
        await should(assert, (a) => { const r = rect(); a.strictEqual(r.left, 0); a.strictEqual(r.top, -10); });
      });

      test("Element returns to center on y axis only with dragSnapToOrigin='y'", async function (assert) {
        await render(<template><LayoutGroup><Drag @return="y" @left={{-10}} @top={{-10}} /></LayoutGroup></template>);
        await wait(300);
        await dragBy(D, [40, 40], [30, 30], [10, 10]); await wait(300);
        await should(assert, (a) => { const r = rect(); a.strictEqual(r.left, -10); a.strictEqual(r.top, 0); });
      });
    }

    test("doesn't reset drag constraints (ref-based), while dragging, on unrelated parent component updates", async function (assert) {
      await render(<template><LayoutGroup><RefConstraints @layout={{layout}} /></LayoutGroup></template>);
      await wait(200);
      await dragBy(D, [10, 10], [15, 15], [300, 300], { waitAfterNudge: layout ? 50 : 200, waitAfterMove: layout ? 50 : 200 });
      await should(assert, (a) => { const r = rect(); a.strictEqual(r.left, 150); a.strictEqual(r.top, 150); });
    });

    if (!layout) {
      test('rescales draggable element in relation to resized constraints', async function (assert) {
        await render(<template><LayoutGroup><RefConstraintsResize /></LayoutGroup></template>);
        await wait(200);
        await should(assert, (a) => { const r = rect('#constraints'); a.strictEqual(r.left, 250); a.strictEqual(r.top, 0); a.strictEqual(r.right, 750); a.strictEqual(r.bottom, 300); });
        await should(assert, (a) => { const r = rect('#box'); a.strictEqual(r.left, 400); a.strictEqual(r.top, 50); a.strictEqual(r.right, 600); a.strictEqual(r.bottom, 250); });
        trigger('#box', 'pointerdown', 5, 5); trigger('#box', 'pointermove', 10, 10); await wait(50);
        trigger('#box', 'pointermove', 200, 200); await wait(100);
        trigger('#box', 'pointerup'); await wait(50);
        trigger('#box', 'pointermove', 500, 500); await wait(200);
        await should(assert, (a) => { const r = rect('#box'); a.strictEqual(r.left, 550); a.strictEqual(r.top, 100); a.strictEqual(r.right, 750); a.strictEqual(r.bottom, 300); });
        // cy.viewport(800, 660): the fixture viewport narrows and the window resize event fires
        const container = document.getElementById('ember-testing-container')!;
        container.style.setProperty('width', '800px', 'important'); window.dispatchEvent(new Event('resize')); await wait(50);
        await should(assert, (a) => { const r = rect('#constraints'); a.strictEqual(r.left, 200); a.strictEqual(r.right, 600); });
        await should(assert, (a) => { const r = rect('#box'); a.strictEqual(r.left, 400); a.strictEqual(r.right, 600); });
        container.style.setProperty('width', '1000px', 'important'); window.dispatchEvent(new Event('resize')); await wait(50);
        await should(assert, (a) => { const r = rect('#constraints'); a.strictEqual(r.left, 250); a.strictEqual(r.top, 0); a.strictEqual(r.right, 750); a.strictEqual(r.bottom, 300); });
        await should(assert, (a) => { const r = rect('#box'); a.strictEqual(r.left, 550); a.strictEqual(r.right, 750); });
      });

      test('Snaps to cursor', async function (assert) {
        await render(<template><LayoutGroup><SnapToCursor /></LayoutGroup></template>);
        await wait(200);
        window.scrollTo(0, 800);
        await should(assert, (a) => { const r = rect('#scrollable'); a.strictEqual(r.top, 200); a.strictEqual(r.right, 740); a.strictEqual(r.bottom, 500); a.strictEqual(r.left, 240); });
        // cy.trigger scrolls its subject into view first (scrollBehavior 'top'); here that scrolls to the page end
        $('#scroll-trigger').scrollIntoView(); trigger('#scroll-trigger', 'pointerdown', 5, 5); await wait(50);
        await should(assert, (a) => { const r = rect('#scrollable'); a.strictEqual(r.top, -125); a.strictEqual(r.right, 275); a.strictEqual(r.bottom, 175); a.strictEqual(r.left, -225); });
        trigger('#scroll-trigger', 'pointerup');
      });
    }
  });
}

module('Integration | motion | cypress | Drag Constraints Return', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  const D = "[data-testid='draggable']";
  const within = (a: Parameters<Parameters<typeof should>[1]>[0]) => { const r = rect(); a.true(r.right <= 302, `right ${r.right}`); a.true(r.bottom <= 302, `bottom ${r.bottom}`); a.true(r.left >= -2, `left ${r.left}`); a.true(r.top >= -2, `top ${r.top}`); };

  test('Returns to constraints when released outside bounds', async function (assert) {
    await render(<template><LayoutGroup><ConstraintsReturn /></LayoutGroup></template>);
    await wait(300);
    await dragBy(D, [50, 50], [60, 60], [400, 400]); await wait(2000);
    await should(assert, within);
  });

  test('Returns to constraints when released outside and clicked during animation', async function (assert) {
    await render(<template><LayoutGroup><ConstraintsReturn /></LayoutGroup></template>);
    await wait(300);
    await dragBy(D, [50, 50], [60, 60], [400, 400]);
    await wait(50); trigger(D, 'pointerdown', 50, 50); await wait(50); trigger(D, 'pointerup'); await wait(2000);
    await should(assert, within);
  });

  test('Does not jump when dragged again during animation', async function (assert) {
    await render(<template><LayoutGroup><ConstraintsReturn /></LayoutGroup></template>);
    await wait(300);
    await dragBy(D, [50, 50], [60, 60], [400, 400]); await wait(50);
    await should(assert, (a) => { const r = rect(); a.true(r.right > 302); a.true(r.bottom > 302); });
    trigger(D, 'pointerdown', 50, 50); trigger(D, 'pointermove', 60, 60); await wait(50);
    trigger(D, 'pointermove', 250, 250); await wait(50);
    const before = rect();
    trigger(D, 'pointerup'); await wait(16);
    await should(assert, (a) => { const r = rect(); a.true(Math.abs(r.right - before.right) < 30, `right moved ${r.right - before.right}`); a.true(Math.abs(r.bottom - before.bottom) < 30, `bottom moved ${r.bottom - before.bottom}`); });
  });
});

void box; void settled;
