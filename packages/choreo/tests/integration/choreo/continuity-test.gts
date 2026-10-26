/**
 * Continuity (§3.1): a replacement pass may not drop a flight.
 *
 * An unrelated render replays the pass, and on that pass a sprite the
 * prior run was driving mid-flight may no longer be named — the timeline
 * that launched it was conditional, or the new score names other things.
 * Unnamed, it was released to its rest in ONE FRAME: the intermittent
 * whole-bay snap every conditional timeline had to hand-patch with a
 * `c.moved` twin. The region completes the score instead: anything the
 * prior run was driving through space, unnamed by the new score, gets a
 * continuation move from its painted box to its rest.
 *
 * The boundary matters as much as the fix: an unnamed sprite that merely
 * REFLOWED was never being driven, and it must stay instant — apps rely
 * on "unnamed means no animation".
 */
import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { array } from '@ember/helper';
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion, setMotionSpeed } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame } from '../../helpers/motion';

const SLOW = { damping: 30, stiffness: 120 };

const el = (sel: string) => document.querySelector(sel) as HTMLElement;

/**
 * A row that arrives and fades in the way `@fade` says, then moves down when
 * `low` is set: the moving pass's score does not name the row's fade.
 */
let row: Row | undefined;
class Row extends Component<{ Args: { fade: string } }> {
  @tracked shown = false;
  @tracked low = false;
  constructor(owner: unknown, args: { fade: string }) {
    super(owner as never, args as never);
    row = this;
  }
  get is() {
    return (name: string) => this.args.fade === name;
  }
  <template>
    <Choreo
      class='stage'
      style='position:relative;width:400px;height:200px'
      as |c|
    >
      <div style='padding-top:{{if this.low "60px" "0px"}}'>
        {{#if this.shown}}
          <div
            id='cc-row'
            style='width:80px;height:40px;background:#0af'
            {{motion id='cc-row' role='cc-row'}}
          ></div>
        {{/if}}
      </div>
      <c.Parallel>
        {{#if (this.is 'delayed')}}
          <c.Tween
            @of={{c.inserted 'cc-row'}}
            @opacity={{array 0 1}}
            @duration={{0.6}}
            @delay={{0.5}}
          />
        {{else if (this.is 'blink')}}
          <c.Tween
            @of={{c.inserted 'cc-row'}}
            @opacity={{array 1 0.3}}
            @duration={{0.4}}
            @repeat={{1}}
            @repeatType='reverse'
          />
        {{else if (this.is 'two')}}
          <c.Tween
            @of={{c.inserted 'cc-row'}}
            @opacity={{array 0 1}}
            @duration={{0.3}}
          />
          <c.Tween
            @of={{c.inserted 'cc-row'}}
            @filter={{array 'blur(4px)' 'blur(0px)'}}
            @duration={{2}}
          />
        {{else}}
          <c.Tween
            @of={{c.inserted 'cc-row'}}
            @opacity={{array 0 1}}
            @duration={{0.6}}
          />
        {{/if}}
        <c.Move @of={{c.moved 'cc-row'}} @duration={{0.3}} @size={{false}} />
      </c.Parallel>
    </Choreo>
  </template>
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const opacity = () => Number(getComputedStyle(el('#cc-row')).opacity);

/** show the row, let its fade run a few frames, then move it */
async function interrupt() {
  row!.shown = true;
  await settled();
  await nextFrame();
  await nextFrame();
  await nextFrame();
  row!.low = true;
  await nextFrame();
}

module('Integration | choreo | continuity', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  test('a score replaced mid-flight carries the flight on, not to a snap', async function (assert) {
    class App extends Component {
      @tracked far = false;
      @tracked scored = true;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo
          class='stage'
          style='position:relative;width:400px;height:200px'
          as |c|
        >
          <div style='padding-left:{{if this.far "260px" "0px"}}'>
            <div
              id='cc-card'
              style='width:80px;height:40px;background:#0af'
              {{motion id='cc-card' role='cc'}}
            ></div>
          </div>
          {{#if this.scored}}
            <c.Move @of={{c.moved 'cc'}} @spring={{SLOW}} />
          {{/if}}
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();

    const lefts: number[] = [];
    const stamps: number[] = [];
    let stop = false;
    const watch = () => {
      if (stop) {
        return;
      }
      lefts.push(el('#cc-card').getBoundingClientRect().left);
      stamps.push(performance.now());
      requestAnimationFrame(watch);
    };

    app!.far = true;
    await settled();
    requestAnimationFrame(watch);
    await nextFrame();
    await nextFrame();
    await nextFrame();

    // the unrelated render: the conditional timeline un-renders, and the
    // pass that replays compiles NOTHING that names the flying card
    app!.scored = false;
    await settled();
    await animationsSettled();
    stop = true;

    const worstRate = (() => {
      let worst = 0;
      for (let i = 1; i < lefts.length; i++) {
        const dt = Math.max(stamps[i]! - stamps[i - 1]!, 12);
        worst = Math.max(
          worst,
          (Math.abs(lefts[i]! - lefts[i - 1]!) * 16.7) / dt,
        );
      }
      return worst;
    })();
    const travel = Math.max(...lefts) - Math.min(...lefts);
    assert.true(
      travel > 60,
      `the flight is real at this scale (${Math.round(travel)}px over ${lefts.length} frames)`,
    );
    assert.true(
      worstRate < travel / 3,
      `no frame snaps when the score is replaced (worst per-frame rate ${Math.round(
        worstRate,
      )}px of ${Math.round(travel)}px)`,
    );
    const rest = el('#cc-card').getBoundingClientRect();
    const stage = el('.stage').getBoundingClientRect();
    assert.true(
      Math.abs(rest.left - (stage.left + 260)) < 2,
      `and it still lands at its rest (${Math.round(rest.left - stage.left)})`,
    );
  });

  test('an unnamed reflow stays instant: continuity is only for what was flying', async function (assert) {
    class Still extends Component {
      @tracked far = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        still = this;
      }
      <template>
        <Choreo
          class='stage'
          style='position:relative;width:400px;height:200px'
          as |c|
        >
          <div style='padding-left:{{if this.far "260px" "0px"}}'>
            <div
              id='cc-still'
              style='width:80px;height:40px;background:#fa0'
              {{motion id='cc-still' role='cc-still'}}
            ></div>
          </div>
          {{! a timeline that never names the card — its reflow is its own }}
          <c.Hold @of={{c.id 'nothing-here'}} @zIndex={{1}} @duration={{0.2}} />
        </Choreo>
      </template>
    }
    let still: Still | undefined;
    await render(<template><Still /></template>);
    await animationsSettled();

    still!.far = true;
    await settled();
    await nextFrame();
    const early = el('#cc-still').getBoundingClientRect();
    const stage = el('.stage').getBoundingClientRect();
    assert.true(
      Math.abs(early.left - (stage.left + 260)) < 2,
      `an unnamed reflow lands instantly, as it always has (${Math.round(
        early.left - stage.left,
      )})`,
    );
    await animationsSettled();
  });

  test('a fade-in cut short by a pass that only moves the sprite still ends opaque', async function (assert) {
    class Feed extends Component {
      @tracked shown = false;
      @tracked low = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        feed = this;
      }
      <template>
        <Choreo
          class='stage'
          style='position:relative;width:400px;height:200px'
          as |c|
        >
          <div style='padding-top:{{if this.low "60px" "0px"}}'>
            {{#if this.shown}}
              <div
                id='cc-arrival'
                style='width:80px;height:40px;background:#0af'
                {{motion id='cc-arrival' role='cc-row'}}
              ></div>
            {{/if}}
          </div>
          {{! the transcript's shape: arrivals fade in, moves translate only }}
          <c.Parallel>
            <c.Tween
              @of={{c.inserted 'cc-row'}}
              @opacity={{array 0 1}}
              @duration={{0.6}}
            />
            <c.Move
              @of={{c.moved 'cc-row'}}
              @duration={{0.3}}
              @size={{false}}
            />
          </c.Parallel>
        </Choreo>
      </template>
    }
    let feed: Feed | undefined;
    await render(<template><Feed /></template>);
    await animationsSettled();

    feed!.shown = true;
    await settled();
    await nextFrame();
    await nextFrame();
    await nextFrame();
    let early = Number(getComputedStyle(el('#cc-arrival')).opacity);
    assert.true(
      early < 0.9,
      `the fade is still going when the next pass comes (${early.toFixed(2)})`,
    );

    // the next pass: the arrival is now a moved participant, and its score
    // moves it without naming its opacity
    feed!.low = true;
    await settled();
    await animationsSettled();

    assert.strictEqual(
      getComputedStyle(el('#cc-arrival')).opacity,
      '1',
      'the cut-short fade is carried on to its end',
    );
  });

  test('a fade-in that had not begun when the pass came still ends opaque', async function (assert) {
    await render(<template><Row @fade='delayed' /></template>);
    await animationsSettled();
    await interrupt();
    await settled();
    await animationsSettled();
    assert.strictEqual(opacity(), 1, 'the delayed fade is carried on');
    row = undefined;
  });

  test('a tween that repeats in reverse is carried on to the keyframe Motion ends it on', async function (assert) {
    await render(<template><Row @fade='blink' /></template>);
    await animationsSettled();
    await interrupt();
    await settled();
    await animationsSettled();
    assert.strictEqual(
      opacity(),
      1,
      'an odd reverse repeat ends on its first keyframe',
    );
    row = undefined;
  });

  test('each tween cut short keeps the time it had left', async function (assert) {
    await render(<template><Row @fade='two' /></template>);
    await animationsSettled();
    await interrupt();
    // the opacity tween had well under 0.3 s left; the blur, nearly 2 s
    await wait(450);
    assert.true(
      opacity() > 0.97,
      `the short fade lands in its own time, not the blur's (${opacity().toFixed(2)})`,
    );
    await settled();
    await animationsSettled();
    row = undefined;
  });

  test('the time a fade had left is counted once under a slowed motion speed', async function (assert) {
    setMotionSpeed(2);
    try {
      await render(<template><Row @fade='plain' /></template>);
      await animationsSettled();
      await interrupt();
      // 0.6 s at speed 2 is 1.2 s, and most of it is left: carried on in
      // that time, not scaled again into twice that
      await wait(1450);
      assert.true(
        opacity() > 0.97,
        `the fade lands in the time it had left (${opacity().toFixed(2)})`,
      );
      await settled();
      await animationsSettled();
    } finally {
      setMotionSpeed(1);
      row = undefined;
    }
  });
});
