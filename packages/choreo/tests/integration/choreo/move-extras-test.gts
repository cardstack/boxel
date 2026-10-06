/**
 * Move's flights and skins — @path, @rotate, @swap
 * (docs/choreo-constructs.md §4.4, §6.3).
 */
import { Choreo } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { array } from '@ember/helper';
import { find, render, settled, waitUntil } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion } from 'glimmer-motion';
import { animationsSettled, bounds } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame } from '../../helpers/motion';

module('Integration | choreo | move extras', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  test('closure: a @path flight lands exactly on the FLIP bounds', async function (assert) {
    class App extends Component {
      @tracked side = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo
          class='stage'
          style='position:relative;width:300px;height:200px'
          as |c|
        >
          <div
            id='comet'
            style='position:absolute;width:40px;height:40px;background:#fa0;{{if
              this.side
              "left:200px;top:120px"
              "left:20px;top:20px"
            }}'
            {{motion id='comet' role='comet'}}
          ></div>
          <c.Move
            @of={{c.moved 'comet'}}
            @path='M 0 0 C 40 -80, 160 -80, 200 0'
            @rotate='auto'
            @duration={{0.12}}
            @ease='easeInOut'
          />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    const before = bounds(find('#comet') as HTMLElement);
    app!.side = true;
    await settled();
    await nextFrame();
    const mid = bounds(find('#comet') as HTMLElement);
    assert.true(
      mid.top < before.top + 100,
      'the journey bends off the straight line (arcs upward)',
    );
    await animationsSettled();
    const after = bounds(find('#comet') as HTMLElement);
    assert.strictEqual(after.left, before.left + 180, 'lands the exact x');
    assert.strictEqual(after.top, before.top + 100, 'lands the exact y');
  });

  test("@swap='during': both skins cross over the one flying box", async function (assert) {
    class App extends Component {
      @tracked gen = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo
          class='stage'
          style='position:relative;width:300px;height:200px'
          as |c|
        >
          {{#each (array this.gen) key='@identity' as |g|}}
            <div
              id='skin-{{g}}'
              style='position:absolute;width:60px;height:30px;background:#0af;{{if
                g
                "left:180px;top:100px"
                "left:10px;top:10px"
              }}'
              {{motion id='card' role='card'}}
            ></div>
          {{/each}}
          {{! roomy on purpose: this test reads a mid-crossfade still, and
              a headless CI can hand out its first animation frame late
              enough that a tenth-of-a-second move has not begun }}
          <c.Move
            @of={{c.received 'card'}}
            @duration={{0.4}}
            @ease='easeInOut'
          />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    app!.gen = 1;
    await settled();
    // mid-flight is a STATE, not a frame count: wait until the crossfade
    // is genuinely underway — the old skin off its seat AND dissolving —
    // then read that still. Counting frames asserts the CI machine's
    // frame budget, which is nobody's subject.
    await waitUntil(
      () => {
        const el = find('#skin-0') as HTMLElement | null;
        return (
          el !== null &&
          bounds(el).left > 10 &&
          parseFloat(getComputedStyle(el).opacity) < 1
        );
      },
      { timeout: 2000 },
    );
    const receiver = find('#skin-1') as HTMLElement;
    const leaver = find('#skin-0') as HTMLElement;
    assert.ok(leaver, 'the old skin is aloft with the new');
    // both skins wear a real background, so the crossfade carries color
    // (§4.7): the receiver holds SOLID — the ground can never leak through
    // the flying box — while the old skin dissolves above it
    const rOp = parseFloat(getComputedStyle(receiver).opacity);
    const lOp = parseFloat(getComputedStyle(leaver).opacity);
    assert.strictEqual(rOp, 1, 'the new skin holds solid under the dissolve');
    assert.strictEqual(
      getComputedStyle(receiver).backgroundColor,
      'rgb(0, 170, 255)',
      'the flying box wears its effective color, full alpha',
    );
    assert.true(lOp < 1, `the old skin is fading out (${lOp})`);
    const lb = bounds(leaver);
    assert.true(lb.left > 10, `the old skin flies too (${lb.left})`);
    await animationsSettled();
    assert.notOk(find('#skin-0'), 'the old skin is dropped at the landing');
    assert.strictEqual(
      parseFloat(getComputedStyle(find('#skin-1') as HTMLElement).opacity),
      1,
    );
  });

  test("@swap='settle': the old rendering is carried whole; the swap is the landing", async function (assert) {
    class App extends Component {
      @tracked gen = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <Choreo
          class='stage'
          style='position:relative;width:300px;height:200px'
          as |c|
        >
          {{#each (array this.gen) key='@identity' as |g|}}
            <div
              id='skin-{{g}}'
              style='position:absolute;width:60px;height:30px;background:#0af;{{if
                g
                "left:180px;top:100px"
                "left:10px;top:10px"
              }}'
              {{motion id='card' role='card'}}
            ></div>
          {{/each}}
          <c.Move
            @of={{c.received 'card'}}
            @swap='settle'
            @duration={{0.12}}
            @ease='easeInOut'
          />
        </Choreo>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    app!.gen = 1;
    await settled();
    await nextFrame();
    const receiver = find('#skin-1') as HTMLElement;
    const leaver = find('#skin-0') as HTMLElement;
    assert.strictEqual(
      parseFloat(getComputedStyle(receiver).opacity),
      0,
      'the receiver hides for the flight',
    );
    assert.strictEqual(
      parseFloat(getComputedStyle(leaver).opacity),
      1,
      'the old rendering is carried whole',
    );
    await animationsSettled();
    assert.notOk(find('#skin-0'));
    assert.strictEqual(
      parseFloat(getComputedStyle(find('#skin-1') as HTMLElement).opacity),
      1,
      'the swap happened at the landing',
    );
  });
});
