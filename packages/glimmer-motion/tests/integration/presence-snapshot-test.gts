/**
 * <Presence @mode="snapshot">, this package's own mode (Motion has no test to
 * port): a leaver's block leaves with the render that removes it, and a static
 * copy of its last frame plays its exit.
 */
import { find, findAll, render, settled, waitUntil } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import MotionConfig from 'glimmer-motion/motion-config';
import Presence from 'glimmer-motion/presence';
import { animationsSettled, setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { nextFrame, spy } from '../helpers/motion';

const keyOf = (it: { key: string }) => it.key;
const copies = () => findAll('[inert][aria-hidden="true"]') as HTMLElement[];
const FADE = { opacity: 0 };
const SLOW = { duration: 0.4, ease: 'linear' } as const;

class State {
  @tracked open = true;
  @tracked label = 'menu';
  @tracked face = 'a';
  get items() {
    return this.open ? [{ key: 'panel' }] : [];
  }
  get faces() {
    return [{ key: this.face }];
  }
  /** the item leaves, and the state its block renders from moves on in the same change */
  close() {
    this.open = false;
    this.label = 'moved on';
  }
}

module('Integration | motion | Presence snapshot', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('the leaving block goes with the render, and a copy of its last frame stands in its seat', async function (assert) {
    const s = new State();
    await render(
      <template>
        <div style='position:relative;width:300px;height:200px'>
          <p style='margin:0;height:40px'>above</p>
          <Presence
            @items={{s.items}}
            @key={{keyOf}}
            @mode='snapshot'
            as |it h|
          >
            <div
              id='panel'
              data-test-panel
              style='margin-left:20px;width:120px;height:60px'
              {{motion presence=h exit=FADE transition=SLOW}}
            ><span data-test-label>{{s.label}}</span></div>
          </Presence>
        </div>
      </template>,
    );
    await nextFrame();
    const panel = find('#panel') as HTMLElement;
    const seat = {
      top: panel.offsetTop,
      left: panel.offsetLeft,
      width: panel.offsetWidth,
      height: panel.offsetHeight,
    };

    s.close();
    await settled();

    assert
      .dom('[data-test-panel]')
      .doesNotExist('the live block left with the render');
    assert.dom('#panel').doesNotExist('the copy carries no ids');
    assert
      .dom('[data-test-label]')
      .doesNotExist('the copy carries no test hooks');
    const [copy] = copies();
    assert.ok(copy, 'an inert, hidden copy plays the exit');
    assert.strictEqual(
      copy?.textContent?.trim(),
      'menu',
      'the copy shows the last render, not the state that moved on',
    );
    assert.strictEqual(getComputedStyle(copy!).position, 'absolute');
    assert.deepEqual(
      {
        top: copy!.offsetTop,
        left: copy!.offsetLeft,
        width: copy!.offsetWidth,
        height: copy!.offsetHeight,
      },
      seat,
      'the copy is pinned to the seat its element had',
    );

    await animationsSettled();
    assert.strictEqual(
      copies().length,
      0,
      'the copy is removed when its exit ends',
    );
  });

  test('the copy plays the exit its element declared', async function (assert) {
    const s = new State();
    await render(
      <template>
        <Presence @items={{s.items}} @key={{keyOf}} @mode='snapshot' as |it h|>
          <div
            style='width:120px;height:60px'
            {{motion presence=h exit=FADE transition=SLOW}}
          >panel</div>
        </Presence>
      </template>,
    );
    await nextFrame();
    s.close();
    await settled();

    const seen: number[] = [];
    while (copies().length && seen.length < 120) {
      seen.push(parseFloat(getComputedStyle(copies()[0]!).opacity));
      await nextFrame();
    }
    assert.true(
      seen.some((o) => o > 0 && o < 1),
      `the copy fades through intermediate opacities: ${JSON.stringify(seen)}`,
    );
    assert.strictEqual(copies().length, 0, 'and is gone once it has faded');
  });

  test('with no exit to play, nothing is copied', async function (assert) {
    const s = new State();
    await render(
      <template>
        <Presence @items={{s.items}} @key={{keyOf}} @mode='snapshot' as |it h|>
          <div
            data-test-panel
            style='width:120px;height:60px'
            {{motion presence=h}}
          >panel</div>
        </Presence>
      </template>,
    );
    await nextFrame();
    s.close();
    await settled();
    assert.dom('[data-test-panel]').doesNotExist();
    assert.strictEqual(
      copies().length,
      0,
      'the DOM is what it is with motion off',
    );
  });

  test('with animations skipped, nothing is copied', async function (assert) {
    const s = new State();
    await render(
      <template>
        <MotionConfig @skipAnimations={{true}}>
          <Presence
            @items={{s.items}}
            @key={{keyOf}}
            @mode='snapshot'
            as |it h|
          >
            <div
              data-test-panel
              style='width:120px;height:60px'
              {{motion presence=h exit=FADE transition=SLOW}}
            >panel</div>
          </Presence>
        </MotionConfig>
      </template>,
    );
    await nextFrame();
    s.close();
    await settled();
    assert.dom('[data-test-panel]').doesNotExist();
    assert.strictEqual(copies().length, 0);
  });

  test('an item that comes back replaces the copy of it still leaving', async function (assert) {
    const s = new State();
    await render(
      <template>
        <Presence @items={{s.items}} @key={{keyOf}} @mode='snapshot' as |it h|>
          <div
            data-test-panel
            style='width:120px;height:60px'
            {{motion presence=h exit=FADE transition=SLOW}}
          >panel</div>
        </Presence>
      </template>,
    );
    await nextFrame();
    s.close();
    await settled();
    assert.strictEqual(copies().length, 1, 'the copy is leaving');

    s.open = true;
    await settled();
    assert.strictEqual(copies().length, 0, 'the copy is gone at once');
    assert.dom('[data-test-panel]').exists({ count: 1 });
  });

  test('onExitComplete waits for the copy to finish its exit', async function (assert) {
    const s = new State();
    const done = spy();
    await render(
      <template>
        <Presence
          @items={{s.items}}
          @key={{keyOf}}
          @mode='snapshot'
          @onExitComplete={{done}}
          as |it h|
        >
          <div
            style='width:120px;height:60px'
            {{motion presence=h exit=FADE transition=SLOW}}
          >panel</div>
        </Presence>
      </template>,
    );
    await nextFrame();
    s.close();
    await settled();
    assert.strictEqual(done.calls.length, 0, 'not while the copy is leaving');
    await animationsSettled();
    assert.strictEqual(done.calls.length, 1, 'once it has left');
  });

  test("a copy's form controls stay out of the live page's radio groups", async function (assert) {
    const s = new State();
    await render(
      <template>
        <Presence
          @items={{s.faces}}
          @key={{keyOf}}
          @mode='snapshot'
          as |face h|
        >
          <div
            style='width:120px;height:60px'
            {{motion presence=h exit=FADE transition=SLOW}}
          ><input
              type='radio'
              aria-label={{face.key}}
              name='face'
              checked
              data-test-radio={{face.key}}
            /></div>
        </Presence>
      </template>,
    );
    await nextFrame();
    s.face = 'b';
    await settled();
    assert.strictEqual(copies().length, 1, 'the copy of face a is leaving');
    assert.true(
      (find('[data-test-radio="b"]') as HTMLInputElement).checked,
      "face b's radio stays checked beside the copy of face a's",
    );
  });

  test('the copy holds the CSS animations and scroll offsets its element showed', async function (assert) {
    const s = new State();
    await render(
      <template>
        <style>
          @keyframes presence-snapshot-rise {
            from {
              opacity: 0.25;
            }
            to {
              opacity: 1;
            }
          }
          .presence-snapshot-rise {
            animation: presence-snapshot-rise 30ms;
          }
          .presence-snapshot-scroller {
            height: 40px;
            overflow: auto;
          }
        </style>
        <Presence @items={{s.items}} @key={{keyOf}} @mode='snapshot' as |it h|>
          <div
            style='width:120px;height:60px'
            {{motion presence=h exit=FADE transition=SLOW}}
          >
            <div class='presence-snapshot-rise' data-test-risen>risen</div>
            <div class='presence-snapshot-scroller' data-test-scroller>
              <div style='height:200px'></div>
            </div>
          </div>
        </Presence>
      </template>,
    );
    const risen = find('[data-test-risen]') as HTMLElement;
    await waitUntil(() => risen.getAnimations().length === 0);
    (find('[data-test-scroller]') as HTMLElement).scrollTop = 50;

    s.close();
    await settled();

    const [copy] = copies();
    const copiedRisen = copy!.querySelector('.presence-snapshot-rise')!;
    assert.strictEqual(
      getComputedStyle(copiedRisen).opacity,
      '1',
      'an entrance that had finished does not replay on the copy',
    );
    assert.strictEqual(
      copy!.querySelector('.presence-snapshot-scroller')!.scrollTop,
      50,
      'the copy is scrolled where its element was',
    );
  });
});
