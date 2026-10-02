/**
 * `c.Camera3D` — the shot, for a scene Choreo is not the one drawing.
 *
 * `c.Camera` moves the region's own frame, which is a 2D transform on
 * real DOM. A 3D scene has no such frame: its camera belongs to whatever
 * renders it. So this step carries only the POSE — yaw and pitch in
 * degrees, dolly as a multiple of the host's framing — and the region
 * hands it to `@onCamera3D`.
 *
 * What has to hold is the property that makes it worth being a step at
 * all rather than a callback: the pose is a pure function of the clock.
 * A seek must land the shot exactly where playing there would, forwards
 * and backwards, and a relative cue must resolve against the prefix
 * rather than against whatever happened to play.
 */
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import {
  type Camera3DState,
  Choreo,
  type ChoreoContext,
  motion,
} from 'glimmer-motion';
import { setupChoreo } from 'glimmer-motion/choreo/test-support';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

/**
 * A region does NOT collect its score on the first render — there is
 * nothing to animate away from yet — so every one of these tests renders,
 * then moves a sprite to force the second pass that compiles the run.
 */
let host: Shot | undefined;
let ctx: ChoreoContext | undefined;
let shots: Camera3DState[] = [];
const grab = (c: ChoreoContext) => {
  ctx = c;
  return '';
};
const seize = (h: Shot) => {
  host = h;
};

class Shot extends Component<{
  Args: { seize?: (self: Shot) => void };
  Blocks: { default: [number] };
}> {
  @tracked take = 0;
  constructor(owner: unknown, args: { seize?: (self: Shot) => void }) {
    super(owner as never, args as never);
    args.seize?.(this);
  }
  <template>{{yield this.take}}</template>
}

/** render, then force the pass that actually compiles the score */
const roll = async (): Promise<void> => {
  host!.take = 1;
  await settled();
  ctx!.run!.pause();
};
const watch = (state: Camera3DState) => {
  shots.push(state);
};

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

/** an aim off in the scene, for the @look tests */
const AIM = { x: 100, y: 50, z: -20 };
/** three waypoints; pitch appears at the second and must carry to the third */
const PATH = [{ yaw: 30 }, { pitch: 10, yaw: 60 }, { yaw: 90 }];

/**
 * A path with corners in it: the pan stops while the tilt runs, then the
 * tilt stops while the pan runs. A cardinal spline crosses every one of
 * these with continuous velocity and a STEP in curvature — which is the
 * tick `@settle` exists to take out.
 */
const CORNER = [
  { pitch: 0, yaw: 40 },
  { pitch: 30, yaw: 40 },
  { pitch: 30, yaw: 80 },
];

/** the same idea across a cut, which must survive any amount of smoothing */
const SPLICE = [{ yaw: 20 }, { cut: true, yaw: 200 }, { yaw: 220 }];

/**
 * The worst JERK in a series — its largest third difference.
 *
 * Acceleration is the wrong measure here: a settle is not supposed to
 * flatten the move, and one that halved the acceleration would have
 * taken the shot away with the tick. What a spline's waypoint puts in
 * the picture is a STEP in acceleration, which is an impulse of jerk,
 * and that is exactly what an average over the waypoint removes.
 */
const jerk = (series: number[]): number => {
  let worst = 0;
  for (let i = 0; i < series.length - 3; i += 1) {
    const d =
      -series[i]! + 3 * series[i + 1]! - 3 * series[i + 2]! + series[i + 3]!;
    worst = Math.max(worst, Math.abs(d));
  }
  return worst;
};

/** the pose the host last received */
const latest = (): Camera3DState =>
  shots[shots.length - 1] ?? { dolly: 1, pitch: 0, x: 0, y: 0, yaw: 0 };

/** stand the run at `t` and report what the host was handed */
const at = async (t: number): Promise<Camera3DState> => {
  ctx!.run!.time = t;
  await frames(2);
  return latest();
};

module('Integration | choreo | c.Camera3D', function (hooks) {
  setupRenderingTest(hooks);
  setupChoreo(hooks);
  hooks.beforeEach(() => {
    shots = [];
    ctx = undefined;
    host = undefined;
  });

  test('a seek lands the shot where playing there would', async function (assert) {
    await render(
      <template>
        <Shot @seize={{seize}} as |take|>
          <Choreo @onCamera3D={{watch}} as |c|>
            {{grab c}}
            <div
              data-box
              style="width:{{take}}0px;height:20px"
              {{motion id="box"}}
            ></div>
            <c.Sequence>
              <c.Camera3D @yaw={{40}} @duration={{1}} @ease="linear" />
              <c.Camera3D
                @yaw={{-20}}
                @pitch={{10}}
                @duration={{1}}
                @ease="linear"
              />
            </c.Sequence>
          </Choreo>
        </Shot>
      </template>
    );
    await roll();
    assert.ok(ctx?.run, 'the score compiled a run');

    // halfway through the first cue: half of 0 -> 40
    const half = await at(0.5);
    assert.ok(
      Math.abs(half.yaw - 20) < 0.6,
      `half of the first cue is half the yaw: ${half.yaw.toFixed(2)}`
    );

    // the boundary: the first cue has landed, the second has not begun
    const mid = await at(1);
    assert.ok(
      Math.abs(mid.yaw - 40) < 0.01,
      `the first cue lands exactly on its target: ${mid.yaw.toFixed(3)}`
    );

    // halfway through the second: 40 -> -20 and 0 -> 10
    const later = await at(1.5);
    assert.ok(
      Math.abs(later.yaw - 10) < 0.9,
      `the second cue lerps from where the first left it: ${later.yaw.toFixed(2)}`
    );
    assert.ok(
      Math.abs(later.pitch - 5) < 0.6,
      `pitch travels alongside it: ${later.pitch.toFixed(2)}`
    );

    // BACKWARDS. A cue rewound past its own start puts the shot back where
    // it began, so the prefix replays into the same shot it did the first
    // time rather than continuing from wherever the clock had reached.
    const back = await at(0.5);
    assert.ok(
      Math.abs(back.yaw - 20) < 0.6,
      `seeking back reconstructs, it does not unwind: ${back.yaw.toFixed(2)}`
    );
    const start = await at(0);
    assert.ok(
      Math.abs(start.yaw) < 0.6 && Math.abs(start.pitch) < 0.6,
      `and the beginning is the beginning: yaw ${start.yaw.toFixed(2)}, ` +
        `pitch ${start.pitch.toFixed(2)}`
    );
  });

  test('@by is relative: it resolves against the pose in force', async function (assert) {
    await render(
      <template>
        <Shot @seize={{seize}} as |take|>
          <Choreo @onCamera3D={{watch}} as |c|>
            {{grab c}}
            <div
              data-box
              style="width:{{take}}0px;height:20px"
              {{motion id="box"}}
            ></div>
            <c.Sequence>
              <c.Camera3D
                @yaw={{30}}
                @dolly={{1}}
                @duration={{1}}
                @ease="linear"
              />
              {{! a drift, not a destination: +15 on whatever came before,
                and a dolly that MULTIPLIES the distance in force }}
              <c.Camera3D
                @by={{true}}
                @yaw={{15}}
                @dolly={{0.5}}
                @duration={{1}}
                @ease="linear"
              />
            </c.Sequence>
          </Choreo>
        </Shot>
      </template>
    );
    await roll();

    const end = await at(2);
    assert.ok(
      Math.abs(end.yaw - 45) < 0.01,
      `relative yaw adds to the pose in force: ${end.yaw.toFixed(3)}`
    );
    assert.ok(
      Math.abs(end.dolly - 0.5) < 0.01,
      `relative dolly multiplies it: ${end.dolly.toFixed(3)}`
    );

    // and it is still reconstructable: a direct seek into the middle of a
    // RELATIVE cue has to fold the prefix to know what it is relative to
    const mid = await at(1.5);
    assert.ok(
      Math.abs(mid.yaw - 37.5) < 0.9,
      `a direct seek into a relative cue folds the prefix first: ` +
        `${mid.yaw.toFixed(2)}`
    );
  });

  test('@look tweens the orbit centre with the pose, and it carries', async function (assert) {
    await render(
      <template>
        <Shot @seize={{seize}} as |take|>
          <Choreo @onCamera3D={{watch}} as |c|>
            {{grab c}}
            <div
              data-box
              style="width:{{take}}0px;height:20px"
              {{motion id="box"}}
            ></div>
            <c.Sequence>
              <c.Camera3D
                @yaw={{20}}
                @look={{AIM}}
                @duration={{1}}
                @ease="linear"
              />
              {{! no @look here: the aim in force carries, like every
                  other unnamed pose component }}
              <c.Camera3D @yaw={{-20}} @duration={{1}} @ease="linear" />
            </c.Sequence>
          </Choreo>
        </Shot>
      </template>
    );
    await roll();

    // halfway in: the aim lerps from the origin alongside the yaw
    const half = await at(0.5);
    assert.ok(
      Math.abs((half.look?.x ?? 0) - 50) < 1.5 &&
        Math.abs((half.look?.z ?? 0) - -10) < 0.8,
      `the centre travels on the same clock: ` +
        `${half.look?.x.toFixed(1)}, ${half.look?.z.toFixed(1)}`
    );

    // through the second cue, which never mentions look: it holds
    const later = await at(1.5);
    assert.ok(
      Math.abs((later.look?.x ?? 0) - 100) < 0.01,
      `an unnamed aim carries in force: ${later.look?.x.toFixed(2)}`
    );

    // and a seek back reconstructs it like any pose component
    const back = await at(0.5);
    assert.ok(
      Math.abs((back.look?.x ?? 0) - 50) < 1.5,
      `a seek reconstructs the aim: ${back.look?.x.toFixed(1)}`
    );
  });

  test('@through runs one clock through every waypoint', async function (assert) {
    await render(
      <template>
        <Shot @seize={{seize}} as |take|>
          <Choreo @onCamera3D={{watch}} as |c|>
            {{grab c}}
            <div
              data-box
              style="width:{{take}}0px;height:20px"
              {{motion id="box"}}
            ></div>
            <c.Sequence>
              <c.Camera3D @through={{PATH}} @duration={{3}} @ease="linear" />
            </c.Sequence>
          </Choreo>
        </Shot>
      </template>
    );
    await roll();

    // mid-first-segment: en route, between the pose in force and waypoint 1
    const early = await at(0.5);
    assert.ok(
      early.yaw > 4 && early.yaw < 26,
      `the spline is moving inside a segment: ${early.yaw.toFixed(2)}`
    );

    // uniform segments: waypoint 2 is CROSSED exactly at 2/3 of the clock
    const cross = await at(2);
    assert.ok(
      Math.abs(cross.yaw - 60) < 0.9,
      `a waypoint is crossed, on time: ${cross.yaw.toFixed(2)}`
    );
    assert.ok(
      Math.abs(cross.pitch - 10) < 0.9,
      `with its own pitch: ${cross.pitch.toFixed(2)}`
    );

    // and the last waypoint is a LANDING, exact
    const end = await at(3);
    assert.ok(
      Math.abs(end.yaw - 90) < 0.01,
      `the path lands exactly on its last waypoint: ${end.yaw.toFixed(3)}`
    );
    assert.ok(
      Math.abs(end.pitch - 10) < 0.01,
      `omissions carry forward to the end: ${end.pitch.toFixed(3)}`
    );

    // pure function of the clock: seeking back into the path agrees
    const again = await at(2);
    assert.ok(
      Math.abs(again.yaw - 60) < 0.9,
      `a seek into the path reconstructs it: ${again.yaw.toFixed(2)}`
    );
  });

  test('@settle smooths the path without moving where it ends', async function (assert) {
    /** walk one 4s path and report the tilt at even steps */
    const walk = async (): Promise<number[]> => {
      await roll();
      const out: number[] = [];
      for (let i = 0; i < 31; i += 1) {
        out.push((await at(0.3 + i * 0.11)).pitch);
      }
      return out;
    };

    await render(
      <template>
        <Shot @seize={{seize}} as |take|>
          <Choreo @onCamera3D={{watch}} as |c|>
            {{grab c}}
            <div
              data-box
              style="width:{{take}}0px;height:20px"
              {{motion id="box"}}
            ></div>
            <c.Sequence>
              <c.Camera3D @through={{CORNER}} @duration={{4}} @ease="linear" />
            </c.Sequence>
          </Choreo>
        </Shot>
      </template>
    );
    const plain = await walk();
    const landed = await at(4);
    assert.ok(
      Math.abs(landed.pitch - 30) < 0.01,
      `the plain path lands on its last waypoint: ${landed.pitch.toFixed(3)}`
    );

    shots = [];
    ctx = undefined;
    host = undefined;
    await render(
      <template>
        <Shot @seize={{seize}} as |take|>
          <Choreo @onCamera3D={{watch}} as |c|>
            {{grab c}}
            <div
              data-box
              style="width:{{take}}0px;height:20px"
              {{motion id="box"}}
            ></div>
            <c.Sequence>
              <c.Camera3D
                @through={{CORNER}}
                @settle={{0.7}}
                @duration={{4}}
                @ease="linear"
              />
            </c.Sequence>
          </Choreo>
        </Shot>
      </template>
    );
    const settled = await walk();

    const before = jerk(plain);
    const after = jerk(settled);
    assert.ok(
      after < before * 0.55,
      `the corner is softer: jerk ${before.toFixed(3)} -> ${after.toFixed(3)}`
    );

    /* and it is still the same shot: the tilt goes the same way, to the
       same place, in about the same time */
    assert.ok(
      settled[0]! < 4 && settled[settled.length - 1]! > 26,
      `it still makes the move: ${settled[0]!.toFixed(2)} -> ${settled[
        settled.length - 1
      ]!.toFixed(2)}`
    );

    /* the window tapers to nothing at the end, so the landing is exact
       rather than an average of the last waypoint and its approach */
    const end = await at(4);
    assert.ok(
      Math.abs(end.pitch - 30) < 0.01,
      `a settled path still lands exactly: ${end.pitch.toFixed(3)}`
    );
    assert.ok(
      Math.abs(end.yaw - 80) < 0.01,
      `on every axis: ${end.yaw.toFixed(3)}`
    );

    /* still a pure function of the clock */
    const mid = await at(2);
    const again = await at(2);
    assert.ok(
      Math.abs(mid.pitch - again.pitch) < 1e-6,
      'a seek into a settled path reconstructs it exactly'
    );
  });

  test('@settle never smooths across a cut', async function (assert) {
    await render(
      <template>
        <Shot @seize={{seize}} as |take|>
          <Choreo @onCamera3D={{watch}} as |c|>
            {{grab c}}
            <div
              data-box
              style="width:{{take}}0px;height:20px"
              {{motion id="box"}}
            ></div>
            <c.Sequence>
              <c.Camera3D
                @through={{SPLICE}}
                @settle={{1.5}}
                @duration={{3}}
                @ease="linear"
              />
            </c.Sequence>
          </Choreo>
        </Shot>
      </template>
    );
    await roll();

    /* the seam is at 2/3 of the clock; a smoothing window wide enough to
       swallow it must not, or the cut becomes a very fast pan */
    const before = await at(1.98);
    const after = await at(2.02);
    assert.ok(
      after.yaw - before.yaw > 150,
      `the cut is still a cut: ${before.yaw.toFixed(1)} -> ${after.yaw.toFixed(
        1
      )}`
    );
    assert.ok(
      before.yaw < 40,
      `the outgoing shot is not dragged forward: ${before.yaw.toFixed(1)}`
    );
    assert.ok(
      after.yaw > 190 && after.yaw < 210,
      `and the incoming one opens on its own waypoint: ${after.yaw.toFixed(1)}`
    );
  });

  test('the shot is only reported when it moves', async function (assert) {
    await render(
      <template>
        <Shot @seize={{seize}} as |take|>
          <Choreo @onCamera3D={{watch}} as |c|>
            {{grab c}}
            <div
              data-box
              style="width:{{take}}0px;height:20px"
              {{motion id="box"}}
            ></div>
            <c.Sequence>
              <c.Camera3D @yaw={{20}} @duration={{0.3}} @ease="linear" />
            </c.Sequence>
          </Choreo>
        </Shot>
      </template>
    );
    host!.take = 1;
    await settled();
    await animationsSettled();
    assert.ok(shots.length > 0, 'the host heard the shot move');
    assert.ok(
      Math.abs(latest().yaw - 20) < 0.01,
      `and it ended on the target: ${latest().yaw.toFixed(3)}`
    );
  });
});
