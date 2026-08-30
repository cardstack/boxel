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

/** the pose the host last received */
const latest = (): Camera3DState =>
  shots[shots.length - 1] ?? { dolly: 1, pitch: 0, yaw: 0 };

/** stand the run at `t` and report what the host was handed */
const at = async (t: number): Promise<Camera3DState> => {
  ctx!.run!.time = t;
  await frames(2);
  return latest();
};

module('Integration | choreo | c.Camera3D', function (hooks) {
  setupRenderingTest(hooks);
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
