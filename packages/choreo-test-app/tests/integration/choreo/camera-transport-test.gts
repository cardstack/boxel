/**
 * The camera under an external transport (docs/external-clock-camera-seek-handoff.md).
 *
 * `run.time = t` must produce the same camera still as playing forward
 * from zero to `t`. The failure this guards against: a camera cue whose
 * window the seek jumps clean over never starts, so it never folds its
 * final pose into the run's camera — the clock reads `t` while the
 * picture shows an earlier shot. Every case here drives the real public
 * transport (`run.pause(); run.time = seconds`) and asserts the frame's
 * computed inline transform, exactly as a frame-by-frame recorder would
 * capture it.
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

let ctx: ChoreoContext;
const grab = (c: ChoreoContext) => {
  ctx = c;
  return '';
};

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

const zoomOf = (transform: string): number => {
  const m = /scale\(([\d.]+)\)/.exec(transform);
  return m ? parseFloat(m[1]!) : 1;
};

/**
 * Camera A (zoom 2) over 0–0.1s, a 0.1s wait, Camera B (zoom 3) over
 * 0.2–0.3s, a closing 0.1s wait. Total 0.4s. The same score every test
 * seeks; only the seek order differs.
 */
class TwoShots extends Component<{
  Args: { seize?: (self: TwoShots) => void };
}> {
  @tracked take = 0;
  constructor(owner: unknown, args: { seize?: (self: TwoShots) => void }) {
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
        id="subject"
        data-take={{this.take}}
        style="position:absolute;top:20px;left:20px;width:40px;height:20px;background:#0af"
        {{motion id="subject" role="subject"}}
      ></div>
      <c.Sequence>
        <c.Camera @zoom={{2}} @duration={{0.1}} />
        <c.Wait @duration={{0.1}} />
        <c.Camera @zoom={{3}} @duration={{0.1}} />
        <c.Wait @duration={{0.1}} />
      </c.Sequence>
    </Choreo>
  </template>
}

/** Render the score, bump it into compiling, and hand back a paused run. */
async function mount() {
  let app: TwoShots | undefined;
  const seize = (self: TwoShots) => (app = self);
  await render(<template><TwoShots @seize={{seize}} /></template>);
  await animationsSettled();
  // the first render plays nothing; the bump compiles the score
  app!.take = 1;
  await frames(2);
  const run = ctx.run!;
  run.pause();
  const frame = find('[data-choreo]') as HTMLElement;
  return { frame, run };
}

module('Integration | choreo | camera transport', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  test('a direct seek into a wait holds the completed camera pose', async function (assert) {
    const { frame, run } = await mount();
    run.time = 0.15;
    await frames(2);
    assert.strictEqual(
      zoomOf(frame.style.transform),
      2,
      `the first shot's landing stands inside the wait — ${frame.style.transform}`
    );
  });

  test('a direct seek into a later camera starts from the prior pose', async function (assert) {
    const { frame, run } = await mount();
    // 0.22s is early in Camera B: eased progress ≈ 0.08, so a correct
    // from-pose of zoom 2 reads ≈ 2.08 while a from-pose of rest (the
    // bug) reads ≈ 1.16 — the bound separates them decisively
    run.time = 0.22;
    await frames(2);
    const zoom = zoomOf(frame.style.transform);
    assert.true(
      zoom > 1.9 && zoom < 3,
      `Camera B interpolates from Camera A's landing, not from rest (zoom ${zoom})`
    );
  });

  test('a direct seek past the last camera holds its landing', async function (assert) {
    const { frame, run } = await mount();
    // the reel's observed failure: 0.35s is inside the closing wait,
    // clean over Camera B's whole window — B must still have folded
    run.time = 0.35;
    await frames(2);
    assert.strictEqual(
      zoomOf(frame.style.transform),
      3,
      `the last shot's landing stands after its window — ${frame.style.transform}`
    );
  });

  test('backward seeks reconstruct the pose from the score prefix', async function (assert) {
    const { frame, run } = await mount();
    run.time = 0.35;
    await frames(2);
    assert.strictEqual(zoomOf(frame.style.transform), 3, 'parked at the end');

    // back into the middle of Camera A: only A's own progress applies
    run.time = 0.05;
    await frames(2);
    const mid = zoomOf(frame.style.transform);
    assert.true(
      mid > 1.2 && mid < 1.8,
      `mid-A after a jump back is A's own interpolation (zoom ${mid})`
    );

    // all the way home: the identity frame, no trace of either shot
    run.time = 0;
    await frames(2);
    const rest = frame.style.transform;
    assert.true(
      rest === '' || rest === 'none' || zoomOf(rest) === 1,
      `zero is the rest frame — "${rest}"`
    );
  });

  test('repeated and out-of-order seeks are idempotent', async function (assert) {
    const { frame, run } = await mount();
    run.time = 0.35;
    await frames(2);
    const first = frame.style.transform;
    run.time = 0.05;
    await frames(2);
    run.time = 0.25;
    await frames(2);
    run.time = 0.35;
    await frames(2);
    assert.strictEqual(
      frame.style.transform,
      first,
      'the same time yields the same transform regardless of the path taken'
    );
  });

  test('a later camera inherits the aim of the shot before it', async function (assert) {
    // two identical stages: one plays to the end on its own clock, the
    // other is seeked straight there — the two frames must agree to the
    // pixel, aim inheritance included (Camera B names no origin of its
    // own, so it must hold A's fit point)
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
              <c.Camera @fit={{c.id "tile"}} @duration={{0.1}} />
              <c.Wait @duration={{0.05}} />
              <c.Camera @zoom={{3}} @duration={{0.1}} />
            </c.Sequence>
          </Choreo>
        {{/each}}
      </template>
    }
    const twice = () => ['played', 'seeked'];
    let app: Pair | undefined;
    const seize = (self: Pair) => (app = self);
    await render(<template><Pair @seize={{seize}} /></template>);
    await animationsSettled();
    // {{collect}} runs once per stage on first render; the contexts are
    // stable, and after the bump each holds its stage's compiled run
    app!.take = 1;
    await frames(2);
    const [played, seeked] = grabs;
    assert.strictEqual(grabs.length, 2, 'both stages compiled a run');

    // the second stage is seeked straight to the end before playing a frame
    seeked!.run!.pause();
    seeked!.run!.time = seeked!.run!.duration;

    // the first plays its whole score on its own clock — awaited via its
    // own finished promise, because animationsSettled() would wait forever
    // on the deliberately paused sibling
    await played!.run!.finished;
    await frames(2);

    const stages = document.querySelectorAll<HTMLElement>('[data-choreo]');
    assert.strictEqual(
      stages[1]!.style.transform,
      stages[0]!.style.transform,
      'the direct seek and the played run land on the identical frame'
    );
  });

  test('a seek across an unopened gate parks at the gate, camera included', async function (assert) {
    class Gated extends Component<{
      Args: { seize?: (self: Gated) => void };
    }> {
      @tracked take = 0;
      constructor(owner: unknown, args: { seize?: (self: Gated) => void }) {
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
            {{motion id="held" role="held"}}
          ></div>
          <c.Sequence>
            <c.Camera @zoom={{2}} @duration={{0.1}} />
            <c.Gate />
            <c.Camera @zoom={{3}} @duration={{0.1}} />
          </c.Sequence>
        </Choreo>
      </template>
    }
    let app: Gated | undefined;
    const seize = (self: Gated) => (app = self);
    await render(<template><Gated @seize={{seize}} /></template>);
    await animationsSettled();
    app!.take = 1;
    await frames(2);
    const run = ctx.run!;
    run.pause();
    const frame = find('[data-choreo]') as HTMLElement;

    run.time = 0.3;
    await frames(2);
    assert.true(
      Math.abs(run.time - 0.1) < 0.001,
      `the clock clamps at the unopened gate (${run.time})`
    );
    assert.strictEqual(
      zoomOf(frame.style.transform),
      2,
      `the camera clamps with it — the gated shot never leaks (${frame.style.transform})`
    );
  });
});
