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
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { Choreo, type ChoreoContext, motion } from 'glimmer-motion';
import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame } from '../../helpers/motion';

let ctx: ChoreoContext;
const grab = (c: ChoreoContext) => {
  ctx = c;
  return '';
};
void ctx;

const SLOW = { damping: 30, stiffness: 120 };

const el = (sel: string) => document.querySelector(sel) as HTMLElement;

module('Integration | choreo | continuity', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

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
          class="stage"
          style="position:relative;width:400px;height:200px"
          as |c|
        >
          {{grab c}}
          <div style="padding-left:{{if this.far '260px' '0px'}}">
            <div
              id="cc-card"
              style="width:80px;height:40px;background:#0af"
              {{motion id="cc-card" role="cc"}}
            ></div>
          </div>
          {{#if this.scored}}
            <c.Move @of={{c.moved "cc"}} @spring={{SLOW}} />
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
          (Math.abs(lefts[i]! - lefts[i - 1]!) * 16.7) / dt
        );
      }
      return worst;
    })();
    const travel = Math.max(...lefts) - Math.min(...lefts);
    assert.true(
      travel > 60,
      `the flight is real at this scale (${Math.round(travel)}px over ${lefts.length} frames)`
    );
    assert.true(
      worstRate < travel / 3,
      `no frame snaps when the score is replaced (worst per-frame rate ${Math.round(
        worstRate
      )}px of ${Math.round(travel)}px)`
    );
    const rest = el('#cc-card').getBoundingClientRect();
    const stage = el('.stage').getBoundingClientRect();
    assert.true(
      Math.abs(rest.left - (stage.left + 260)) < 2,
      `and it still lands at its rest (${Math.round(rest.left - stage.left)})`
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
          class="stage"
          style="position:relative;width:400px;height:200px"
          as |c|
        >
          {{grab c}}
          <div style="padding-left:{{if this.far '260px' '0px'}}">
            <div
              id="cc-still"
              style="width:80px;height:40px;background:#fa0"
              {{motion id="cc-still" role="cc-still"}}
            ></div>
          </div>
          {{! a timeline that never names the card — its reflow is its own }}
          <c.Hold @of={{c.id "nothing-here"}} @zIndex={{1}} @duration={{0.2}} />
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
        early.left - stage.left
      )})`
    );
    await animationsSettled();
  });
});
