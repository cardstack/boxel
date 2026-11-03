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
import {
  animationsSettled,
  live,
  setupMotion,
} from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { nextFrame, spy } from '../helpers/motion';

const keyOf = (it: { key: string }) => it.key;
const copies = () => findAll('[data-motion-memory]') as HTMLElement[];
const FADE = { opacity: 0 };
const SLOW = { duration: 0.4, ease: 'linear' } as const;
const QUICK = { duration: 0.05, ease: 'linear' } as const;
const INNER = [{ key: 'inner' }];

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
    const [copy] = copies();
    assert.ok(copy, 'a copy plays the exit');
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

  test('the copy stands where the last frame showed its element, though content before the <Presence> moved it in the same render', async function (assert) {
    const s = new State();
    await render(
      <template>
        <div
          style='position:relative;display:flex;gap:8px;width:300px;height:60px'
        >
          {{#unless s.open}}
            <span data-test-pill style='flex:none;width:80px'>pill</span>
          {{/unless}}
          <Presence
            @items={{s.items}}
            @key={{keyOf}}
            @mode='snapshot'
            as |it h|
          >
            <div
              data-test-panel
              style='flex:1;height:60px'
              {{motion presence=h exit=FADE transition=SLOW}}
            >menu</div>
          </Presence>
        </div>
      </template>,
    );
    await nextFrame();
    const panel = find('[data-test-panel]') as HTMLElement;
    const seat = { left: panel.offsetLeft, width: panel.offsetWidth };

    s.close();
    await settled();

    assert
      .dom('[data-test-pill]')
      .exists('the pill came in with the render that removed the panel');
    const [copy] = copies();
    assert.deepEqual(
      { left: copy!.offsetLeft, width: copy!.offsetWidth },
      seat,
      'the copy keeps the seat the last frame showed, not the one the pill left the panel in',
    );
  });

  test("the copy's seat follows a resize that no render made", async function (assert) {
    const s = new State();
    await render(
      <template>
        <div data-test-box style='position:relative;width:300px;height:100px'>
          <Presence
            @items={{s.items}}
            @key={{keyOf}}
            @mode='snapshot'
            as |it h|
          >
            <div
              data-test-panel
              style='height:60px'
              {{motion presence=h exit=FADE transition=SLOW}}
            >menu</div>
          </Presence>
        </div>
      </template>,
    );
    await nextFrame();
    (find('[data-test-box]') as HTMLElement).style.width = '240px';
    // the resize is observed after the frame that lays it out runs its callbacks
    await nextFrame();
    await nextFrame();

    s.close();
    await settled();

    const [copy] = copies();
    assert.strictEqual(
      copy!.offsetWidth,
      240,
      'the copy is as wide as its element was in the last frame',
    );
  });

  test('the copy goes back where its element stood, before what followed the <Presence>', async function (assert) {
    const s = new State();
    await render(
      <template>
        <div style='position:relative;width:300px;height:100px'>
          <Presence
            @items={{s.items}}
            @key={{keyOf}}
            @mode='snapshot'
            as |it h|
          >
            <div
              style='width:120px;height:60px'
              {{motion presence=h exit=FADE transition=SLOW}}
            >menu</div>
          </Presence>
          <span data-test-after>after</span>
        </div>
      </template>,
    );
    await nextFrame();
    s.close();
    await settled();

    const [copy] = copies();
    assert.strictEqual(
      copy!.nextElementSibling,
      find('[data-test-after]'),
      'the whitespace that followed the element left with its block, and the copy goes in before the next node still there',
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

  test('nested with @propagate under a leaving parent, the parent waits for the copies to finish', async function (assert) {
    const s = new State();
    const done = spy();
    await render(
      <template>
        <Presence
          @items={{s.items}}
          @key={{keyOf}}
          @onExitComplete={{done}}
          as |it h|
        >
          <div
            data-test-outer
            style='position:relative;width:200px;height:100px'
            {{motion presence=h exit=FADE transition=QUICK}}
          >
            <Presence
              @items={{INNER}}
              @key={{keyOf}}
              @mode='snapshot'
              @propagate={{true}}
              @parent={{h}}
              as |inner h2|
            >
              <div
                style='width:120px;height:60px'
                {{motion presence=h2 exit=FADE transition=SLOW}}
              >inner</div>
            </Presence>
          </div>
        </Presence>
      </template>,
    );
    await nextFrame();
    s.close();
    await settled();
    assert.strictEqual(copies().length, 1, 'the inner copy is leaving');

    const seen: number[] = [];
    let outerStayed = true;
    while (copies().length && seen.length < 120) {
      seen.push(parseFloat(getComputedStyle(copies()[0]!).opacity));
      outerStayed &&= Boolean(find('[data-test-outer]'));
      await nextFrame();
    }
    assert.true(outerStayed, 'the parent kept its block while the copy played');
    assert.true(
      seen[seen.length - 1]! < 0.5,
      `the copy played its whole exit: ${JSON.stringify(seen)}`,
    );
    await animationsSettled();
    assert.dom('[data-test-outer]').doesNotExist('then the parent left');
    assert.strictEqual(done.calls.length, 1);
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

  test("a copy's selects show the options the user had chosen", async function (assert) {
    const s = new State();
    await render(
      <template>
        <Presence @items={{s.items}} @key={{keyOf}} @mode='snapshot' as |it h|>
          <div
            style='width:120px;height:60px'
            {{motion presence=h exit=FADE transition=SLOW}}
          >
            <select aria-label='size' data-test-size>
              <option value='s'>s</option>
              <option value='m'>m</option>
              <option value='l'>l</option>
            </select>
            <select aria-label='toppings' multiple data-test-toppings>
              <option value='a' selected>a</option>
              <option value='b'>b</option>
              <option value='c'>c</option>
            </select>
          </div>
        </Presence>
      </template>,
    );
    await nextFrame();
    (find('[data-test-size]') as HTMLSelectElement).value = 'l';
    const toppings = (find('[data-test-toppings]') as HTMLSelectElement)
      .options;
    toppings[0]!.selected = false;
    toppings[1]!.selected = true;
    toppings[2]!.selected = true;
    s.close();
    await settled();

    const [copy] = copies();
    assert.strictEqual(
      copy!.querySelector<HTMLSelectElement>('[data-test-size-memory]')!.value,
      'l',
    );
    assert.deepEqual(
      [
        ...copy!.querySelector<HTMLSelectElement>(
          '[data-test-toppings-memory]',
        )!.selectedOptions,
      ].map((o) => o.value),
      ['b', 'c'],
    );
  });

  test('the copy is a memory: inert, hidden, found only by its suffixed hooks, and skipped by live()', async function (assert) {
    const s = new State();
    await render(
      <template>
        <Presence @items={{s.items}} @key={{keyOf}} @mode='snapshot' as |it h|>
          <div
            id='panel'
            class='presence-snapshot-panel'
            data-test-panel='a'
            style='width:120px;height:60px'
            {{motion presence=h exit=FADE transition=SLOW}}
          >
            <label for='panel-name'>name</label>
            {{! template-lint-disable no-autofocus-attribute }}
            <input id='panel-name' autofocus />
            <svg width='10' height='10'>
              <defs>
                <linearGradient id='presence-snapshot-ink'>
                  <stop offset='0' stop-color='red' />
                </linearGradient>
              </defs>
              <rect width='10' height='10' fill='url(#presence-snapshot-ink)' />
            </svg>
          </div>
        </Presence>
      </template>,
    );
    await nextFrame();
    s.close();
    await settled();

    const [copy] = copies();
    assert.ok(copy, 'the copy is marked as a memory');
    assert.dom(copy).hasAttribute('inert').hasAttribute('aria-hidden', 'true');
    assert.strictEqual(copy!.style.willChange, 'transform, opacity');
    assert.dom('#panel').doesNotExist('its HTML elements carry no ids');
    assert.dom('#panel-name').doesNotExist();
    assert.false(
      copy!.querySelector('input')!.hasAttribute('autofocus'),
      'nor autofocus',
    );
    assert
      .dom('#presence-snapshot-ink')
      .exists('its SVG elements keep the ids its own fills resolve through');
    assert
      .dom('[data-test-panel]')
      .doesNotExist('a test hook selector finds only live elements');
    assert
      .dom('[data-test-panel-memory="a"]')
      .exists({ count: 1 }, 'the copy carries its hooks suffixed, with values');
    assert.dom('.presence-snapshot-panel').exists({ count: 1 });
    assert.strictEqual(
      live('.presence-snapshot-panel'),
      null,
      'live() skips it for any other selector',
    );
  });

  test('the copy holds still at the frame its element showed', async function (assert) {
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
          @keyframes presence-snapshot-turn {
            to {
              rotate: 1turn;
            }
          }
          .presence-snapshot-turn {
            animation: presence-snapshot-turn 10s linear infinite;
          }
          .presence-snapshot-glass {
            backdrop-filter: blur(4px);
          }
        </style>
        <Presence @items={{s.items}} @key={{keyOf}} @mode='snapshot' as |it h|>
          <div
            style='width:120px;height:60px'
            {{motion presence=h exit=FADE transition=SLOW}}
          >
            <div class='presence-snapshot-rise' data-test-risen>risen</div>
            <div class='presence-snapshot-turn' data-test-turn>turn</div>
            <div class='presence-snapshot-glass' data-test-glass>glass</div>
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
    const turned = Number(
      find('[data-test-turn]')!.getAnimations()[0]!.currentTime,
    );

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
    const [turn] = copy!
      .querySelector('[data-test-turn-memory]')!
      .getAnimations();
    assert.strictEqual(
      turn?.playState,
      'paused',
      'an animation the element was running holds still on the copy',
    );
    const held = Number(turn!.currentTime);
    assert.true(
      held >= turned && held < turned + 1000,
      `at the time it had reached (${turned} → ${held})`,
    );
    await nextFrame();
    assert.strictEqual(Number(turn!.currentTime), held, 'and stays there');
    assert.strictEqual(
      getComputedStyle(copy!.querySelector('[data-test-glass-memory]')!)
        .backdropFilter,
      'none',
      "the copy's backdrop filters are off",
    );
  });
});
