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
