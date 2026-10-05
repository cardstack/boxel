/**
 * The camera presets (docs/choreo-composition.md, Phase C5): frame, aim,
 * pan, slowZoom — direction vocabulary that expands into the SAME
 * seekable camera step, never a new runtime primitive. Frame must be the
 * fit camera to the pixel; Aim recentres with the zoom held; Pan and
 * SlowZoom are RELATIVE — resolved against the pose in force when the
 * cue starts — and relative cues must obey the same random-access law as
 * everything else: a direct seek folds them from the score prefix.
 */
import { Choreo, type ChoreoContext } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { find, render } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

const zoomOf = (transform: string): number => {
  const m = /scale\(([\d.]+)\)/.exec(transform);
  return m ? parseFloat(m[1]!) : 1;
};

const translateOf = (transform: string): { x: number; y: number } => {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(transform);
  return m ? { x: parseFloat(m[1]!), y: parseFloat(m[2]!) } : { x: 0, y: 0 };
};

module('Integration | choreo | camera presets', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  test('Frame is the fit camera, to the pixel', async function (assert) {
    const grabs: ChoreoContext[] = [];
    const collect = (c: ChoreoContext) => {
      grabs.push(c);
      return '';
    };
    class Pair extends Component<{
      Args: { seize?: (self: Pair) => void };
    }> {
      @tracked take = 0;
      constructor(owner: unknown, args: { seize?: (self: Pair) => void }) {
        super(owner as never, args as never);
        args.seize?.(this);
      }
      <template>
        {{#each (twice) as |slot|}}
          <Choreo
            class="stage"
            data-slot={{slot}}
            style="position:relative;width:300px;height:200px"
            as |c|
          >
            {{collect c}}
            <div
              data-take={{this.take}}
              style="position:absolute;top:20px;left:20px;width:40px;height:20px;background:#0af"
              {{motion id="tile" role="tile"}}
            ></div>
            <c.Sequence>
              {{#if (isFramed slot)}}
                <c.Frame
                  @of={{c.id "tile"}}
                  @padding={{0.5}}
                  @duration={{0.1}}
                />
              {{else}}
                <c.Camera
                  @fit={{c.id "tile"}}
                  @margin={{0.5}}
                  @duration={{0.1}}
                />
              {{/if}}
            </c.Sequence>
          </Choreo>
        {{/each}}
      </template>
    }
    const twice = () => ['framed', 'fitted'];
    const isFramed = (slot: string) => slot === 'framed';
    let app: Pair | undefined;
    const seize = (self: Pair) => (app = self);
    await render(<template><Pair @seize={{seize}} /></template>);
    await animationsSettled();
    app!.take = 1;
    await frames(2);
    for (const g of grabs) {
      g.run!.pause();
      g.run!.time = g.run!.duration;
    }
    await frames(2);
    const stages = document.querySelectorAll<HTMLElement>('[data-choreo]');
    assert.notStrictEqual(
      stages[0]!.style.transform,
      '',
      `the Frame landed a pose (${stages[0]!.style.transform})`
    );
    assert.strictEqual(
      stages[0]!.style.transform,
      stages[1]!.style.transform,
      'Frame and the fit camera paint the identical transform'
    );
  });

  test('Aim recentres without touching the zoom; Pan and SlowZoom are relative and seekable', async function (assert) {
    let ctx: ChoreoContext | undefined;
    const grab = (c: ChoreoContext) => {
      ctx = c;
      return '';
    };
    class App extends Component<{
      Args: { seize?: (self: App) => void };
    }> {
      @tracked take = 0;
      constructor(owner: unknown, args: { seize?: (self: App) => void }) {
        super(owner as never, args as never);
        args.seize?.(this);
      }
      <template>
        <Choreo
          class="stage"
          style="position:relative;width:300px;height:200px"
          as |c|
        >
          {{grab c}}
          <div
            data-take={{this.take}}
            style="position:absolute;top:20px;left:20px;width:40px;height:20px;background:#0af"
            {{motion id="tile-a" role="tile"}}
          ></div>
          <div
            style="position:absolute;top:150px;left:230px;width:40px;height:20px;background:#fa0"
            {{motion id="tile-b" role="tile"}}
          ></div>
          <c.Sequence>
            <c.Frame @of={{c.id "tile-a"}} @padding={{0.5}} @duration={{0.1}} />
            <c.Wait @duration={{0.1}} />
            <c.Aim @of={{c.id "tile-b"}} @duration={{0.1}} />
            <c.Wait @duration={{0.1}} />
            <c.SlowZoom @by={{1.5}} @duration={{0.1}} />
            <c.Wait @duration={{0.1}} />
            <c.Pan @x={{40}} @y={{-20}} @duration={{0.1}} />
            <c.Wait @duration={{0.1}} />
          </c.Sequence>
        </Choreo>
      </template>
    }
    let app: App | undefined;
    const seize = (self: App) => (app = self);
    await render(<template><App @seize={{seize}} /></template>);
    await animationsSettled();
    app!.take = 1;
    await frames(2);
    const run = ctx!.run!;
    run.pause();
    const frame = find('[data-choreo]') as HTMLElement;

    // the Frame's landed pose is the baseline everything relative folds on
    run.time = 0.15;
    await frames(2);
    const framed = frame.style.transform;
    const framedZoom = zoomOf(framed);

    // Aim: a new centre, the same magnification
    run.time = 0.35;
    await frames(2);
    const aimed = frame.style.transform;
    assert.notStrictEqual(aimed, framed, 'Aim moved the picture');
    assert.strictEqual(
      zoomOf(aimed),
      framedZoom,
      `Aim held the zoom exactly (${String(framedZoom)})`
    );

    // SlowZoom: multiplies the zoom in force
    run.time = 0.55;
    await frames(2);
    const pushed = frame.style.transform;
    assert.true(
      Math.abs(zoomOf(pushed) - framedZoom * 1.5) < 1e-3,
      `SlowZoom lands at 1.5× the pose in force (${pushed})`
    );

    // Pan: shifts the applied picture by exactly the offset
    run.time = 0.75;
    await frames(2);
    const panned = frame.style.transform;
    const before = translateOf(pushed);
    const after = translateOf(panned);
    assert.true(
      Math.abs(after.x - before.x - 40) < 1e-2 &&
        Math.abs(after.y - before.y + 20) < 1e-2,
      `Pan moved the picture by (40, -20) (${panned})`
    );
    assert.strictEqual(
      zoomOf(panned),
      zoomOf(pushed),
      'Pan left the zoom alone'
    );

    // the random-access law extends to relative cues: a direct jump to the
    // end from a fresh position folds SlowZoom and Pan from the prefix
    run.time = 0;
    await frames(2);
    run.time = 0.75;
    await frames(2);
    assert.strictEqual(
      frame.style.transform,
      panned,
      'a jump from zero folds the relative cues to the identical pose'
    );
  });
});
