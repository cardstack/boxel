/**
 * c.Camera and c.Tether (docs/choreo-constructs.md §6.1, §6.3, §6.4).
 */
import { find, render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { Choreo, type ChoreoContext, motion, type Rect } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame } from '../../helpers/motion';

const wire = (a: Rect, b: Rect) =>
  `M ${a.x + a.width} ${a.y + a.height / 2} L ${b.x} ${b.y + b.height / 2}`;

let ctx: ChoreoContext;
const grab = (c: ChoreoContext) => {
  ctx = c;
  return '';
};

module('Integration | choreo | camera and tether', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  test('a camera step drives the frame; steady sprites hold, damped; c.camera lands at boundaries', async function (assert) {
    class App extends Component {
      @tracked step = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo class="stage" style="position:relative;width:300px;height:200px" as |c|>
          {{grab c}}
          <div
            id="focus"
            data-s={{this.step}}
            style="width:40px;height:40px;background:#0af"
            {{motion id="focus" role="focus"}}
          ></div>
          <c.Camera @zoom={{2}} @steady={{c.role "focus"}} @duration={{0.1}} />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    assert.strictEqual(ctx.camera.zoom, 1, 'the frame starts at rest');
    app!.step = 1;
    await animationsSettled();
    const frame = find('[data-choreo]') as HTMLElement;
    assert.true(
      frame.style.transform.includes('scale(2)'),
      `the frame zoomed (${frame.style.transform})`,
    );
    assert.strictEqual(ctx.camera.zoom, 2, 'c.camera landed at the boundary');
    const steady = find('#focus') as HTMLElement;
    // damped: pow(2, .7)/2 ≈ 0.812 — with the host, not 1:1
    const m = /scale\(([\d.]+)\)/.exec(steady.style.transform);
    assert.ok(m, 'the steady sprite counter-scales');
    const counter = parseFloat(m![1]!);
    assert.true(
      counter > 0.7 && counter < 0.95,
      `damped, not full counter (${counter})`,
    );
  });

  test('@fit dives on a sprite and centres it, from rest geometry even mid-zoom', async function (assert) {
    class App extends Component {
      @tracked aim: string | null = null;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo class="stage" style="position:relative;width:300px;height:200px" as |c|>
          {{grab c}}
          {{! the aim is otherwise only read at pass time — a render has to
              consume it, or changing it schedules no pass at all }}
          <div
            id="fit-a"
            data-aim={{this.aim}}
            style="position:absolute;top:20px;left:20px;width:40px;height:20px;background:#0af"
            {{motion id="fit-a" role="tile"}}
          ></div>
          <div
            id="fit-b"
            style="position:absolute;top:160px;left:240px;width:40px;height:20px;background:#fa0"
            {{motion id="fit-b" role="tile"}}
          ></div>
          <c.Camera
            @fit={{if this.aim (c.id this.aim) null}}
            @margin={{0.5}}
            @duration={{0.1}}
          />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    const centre = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    };
    await render(<template><App /></template>);
    await animationsSettled();
    // the glass's own centre, at rest — where every dive must land its tile
    const home = centre(find('[data-choreo]')!);
    const bRest = centre(find('#fit-b')!);

    app!.aim = 'fit-a';
    await animationsSettled();
    // margin 0.5 of a 300×200 frame around a 40×20 tile: width fits first
    assert.true(
      Math.abs(ctx.camera.zoom - 3.75) < 0.01,
      `the computed zoom fills half the constraining axis (${ctx.camera.zoom})`,
    );
    const a = centre(find('#fit-a')!);
    assert.true(
      Math.abs(a.x - home.x) < 1 && Math.abs(a.y - home.y) < 1,
      `the corner tile lands centred (${a.x},${a.y} vs ${home.x},${home.y})`,
    );

    // straight to the OPPOSITE corner: this pass measures through the 3.75×
    // frame, and dividing back by the measure zoom must land just as true
    app!.aim = 'fit-b';
    await animationsSettled();
    const b = centre(find('#fit-b')!);
    assert.true(
      Math.abs(b.x - home.x) < 1 && Math.abs(b.y - home.y) < 1,
      `a dive measured mid-zoom still centres (${b.x},${b.y} vs ${home.x},${home.y})`,
    );

    // fit nothing: back to the resting identity, no trace on the frame —
    // and BACKING STRAIGHT OUT of the dived tile: the return cue has no
    // origin, so it holds the aim in force instead of recentring, and the
    // tile's painted centre stays on the home → rest line the whole way
    app!.aim = null;
    await settled();
    await new Promise((r) => setTimeout(r, 40));
    const mid = centre(find('#fit-b')!);
    const cross =
      (bRest.x - home.x) * (mid.y - home.y) -
      (bRest.y - home.y) * (mid.x - home.x);
    const drift = cross / Math.hypot(bRest.x - home.x, bRest.y - home.y);
    assert.true(
      Math.abs(drift) < 2,
      `the un-zoom backs straight out of its tile (drift ${drift.toFixed(1)}px)`,
    );
    await animationsSettled();
    assert.strictEqual(ctx.camera.zoom, 1, 'null fit returns the frame to rest');
    assert.strictEqual(
      (find('[data-choreo]') as HTMLElement).style.transform,
      '',
      'at identity the frame carries no transform',
    );
  });

  test('a tether follows its sprites through the flight, and leaves with the run', async function (assert) {
    class App extends Component {
      @tracked wide = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo class="stage" style="position:relative;width:300px;height:200px" as |c|>
          <div
            id="a"
            style="position:absolute;top:20px;left:{{if this.wide '10px' '40px'}};width:40px;height:20px"
            {{motion id="a" role="node"}}
          ></div>
          <div
            id="b"
            style="position:absolute;top:120px;left:{{if this.wide '240px' '120px'}};width:40px;height:20px"
            {{motion id="b" role="node"}}
          ></div>
          <c.Parallel>
            <c.Move @of={{c.moved "node"}} @duration={{0.12}} @ease="easeInOut" />
            <c.Tether @from={{c.id "a"}} @to={{c.id "b"}} @path={{wire}} />
          </c.Parallel>
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    app!.wide = true;
    await settled();
    await nextFrame();
    await nextFrame();
    const path = find('[data-choreo-tether]') as SVGPathElement;
    assert.ok(path, 'the wire exists for the window');
    const mid = path.getAttribute('d')!;
    const endX = parseFloat(mid.split('L ')[1]!);
    const aBox = (find('#a') as HTMLElement).getBoundingClientRect();
    const bBox = (find('#b') as HTMLElement).getBoundingClientRect();
    const layer = (
      find('[data-choreo-tethers]') as unknown as SVGSVGElement
    ).getBoundingClientRect();
    assert.true(
      Math.abs(endX - (bBox.left - layer.left)) < 2,
      `the wire endpoint sits inside the moving box (${endX} vs ${bBox.left - layer.left})`,
    );
    assert.true(aBox.left >= 0, 'sanity');
    await animationsSettled();
    assert.notOk(
      find('[data-choreo-tether]'),
      'the wire leaves when its window ends',
    );
  });
});
