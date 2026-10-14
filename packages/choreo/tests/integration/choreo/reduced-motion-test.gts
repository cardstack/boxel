/**
 * Reduced motion: a region inside `<MotionConfig @reducedMotion='always'>`
 * (or `'user'`, with the preference set) keeps its score's timing but moves
 * nothing — positional values land at their step's start, on every path the
 * run drives (the engine, loops, text deliveries, path flights, the
 * camera), while opacity still animates. `'never'` is the opt-out.
 */
import { Choreo, type ChoreoContext } from '@cardstack/choreo';
import { setupChoreo } from '@cardstack/choreo/test-support';
import { array } from '@ember/helper';
import { find, render, settled, waitUntil } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import { motion, MotionConfig } from 'glimmer-motion';
import { animationsSettled, bounds } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupFixtureViewport } from '../../helpers/layout-fixture';
import { nextFrame } from '../../helpers/motion';

type Policy = 'always' | 'never';

/** every property a platform animation on `el` writes */
function animatedProperties(el: Element): Set<string> {
  const keys = new Set<string>();
  for (const animation of el.getAnimations()) {
    const effect = animation.effect as KeyframeEffect | null;
    for (const frame of effect?.getKeyframes() ?? []) {
      for (const key of Object.keys(frame)) {
        if (
          !['offset', 'computedOffset', 'easing', 'composite'].includes(key)
        ) {
          keys.add(key);
        }
      }
    }
  }
  return keys;
}

module('Integration | choreo | reduced motion', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);
  setupChoreo(hooks);

  test('an ambient loop keeps its opacity and drops its travel', async function (assert) {
    class App extends Component<{ Args: { policy: Policy } }> {
      @tracked ready = false;
      constructor(o: unknown, a: { policy: Policy }) {
        super(o as never, a);
        app = this;
      }
      <template>
        <MotionConfig @reducedMotion={{@policy}}>
          <Choreo as |c|>
            <div id='looping' {{motion id='looping'}}>●</div>
            {{#if this.ready}}
              <c.Tween
                @of={{c.id 'looping'}}
                @x={{array 0 100 0}}
                @opacity={{array 1 0.4 1}}
                @duration={{1}}
                @ease='linear'
                @repeat={{Infinity}}
              />
            {{/if}}
          </Choreo>
        </MotionConfig>
      </template>
    }
    let app: App | undefined;
    const loopOn = async (policy: Policy) => {
      await render(<template><App @policy={{policy}} /></template>);
      await nextFrame();
      app!.ready = true;
      await waitUntil(() => find('#looping')!.getAnimations().length > 0);
      return animatedProperties(find('#looping')!);
    };

    const reduced = await loopOn('always');
    assert.true(reduced.has('opacity'), 'the loop still breathes');
    assert.false(reduced.has('transform'), 'the loop no longer travels');

    const full = await loopOn('never');
    assert.true(full.has('transform'), "'never' keeps the loop's travel");
  });

  test('a text delivery fades each word in where it stands', async function (assert) {
    class App extends Component {
      @tracked visible = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <MotionConfig @reducedMotion='always'>
          <Choreo class='stage' style='width:300px;height:100px' as |c|>
            {{#if this.visible}}
              <p id='line' {{motion id='line' role='line'}}>Pour 42 complete</p>
            {{/if}}
            <c.Tween
              @of={{c.inserted 'line'}}
              @by='word'
              @opacity={{array 0 1}}
              @y={{array 12 0}}
              @duration={{0.6}}
            />
          </Choreo>
        </MotionConfig>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    app!.visible = true;
    await waitUntil(() => find('#line span'));
    const slots = [...find('#line')!.querySelectorAll('span')];
    const keys = new Set(slots.flatMap((s) => [...animatedProperties(s)]));
    assert.true(keys.has('opacity'), 'the words still fade in');
    assert.false(keys.has('transform'), 'no word rises into place');
    await animationsSettled();
    assert.strictEqual(
      find('#line')!.textContent,
      'Pour 42 complete',
      'the delivery restores its text as ever',
    );
  });

  test('a path flight lands as its window opens', async function (assert) {
    class App extends Component {
      @tracked side = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <MotionConfig @reducedMotion='always'>
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
              @duration={{0.6}}
              @ease='easeInOut'
            />
          </Choreo>
        </MotionConfig>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    const before = bounds(find('#comet') as HTMLElement);
    app!.side = true;
    await settled();
    await nextFrame();
    await nextFrame();
    const early = bounds(find('#comet') as HTMLElement);
    assert.strictEqual(early.left, before.left + 180, 'already at the end x');
    assert.strictEqual(early.top, before.top + 100, 'already at the end y');
  });

  test('the camera cuts to its shot rather than travelling', async function (assert) {
    let ctx: ChoreoContext | undefined;
    const grab = (c: ChoreoContext) => {
      ctx = c;
      return '';
    };
    class App extends Component {
      @tracked take = 0;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <MotionConfig @reducedMotion='always'>
          <Choreo
            class='stage'
            style='position:relative;width:300px;height:200px'
            as |c|
          >
            {{grab c}}
            <div
              id='subject'
              data-take={{this.take}}
              style='position:absolute;top:20px;left:20px;width:40px;height:20px'
              {{motion id='subject' role='subject'}}
            ></div>
            <c.Camera @zoom={{2}} @duration={{0.6}} />
          </Choreo>
        </MotionConfig>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    // the first render plays nothing; the bump compiles the score
    app!.take = 1;
    await waitUntil(() => ctx?.run);
    await nextFrame();
    await nextFrame();
    const frame = find('[data-choreo]') as HTMLElement;
    const scale = new DOMMatrix(getComputedStyle(frame).transform).a;
    assert.strictEqual(scale, 2, 'the frame already holds the zoomed shot');
  });

  test('an engine tween jumps its position and still fades', async function (assert) {
    class App extends Component {
      @tracked shown = false;
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      <template>
        <MotionConfig @reducedMotion='always'>
          <Choreo
            class='stage'
            style='position:relative;width:300px;height:200px'
            as |c|
          >
            {{#if this.shown}}
              <div id='card' {{motion id='card' role='card'}}>card</div>
            {{/if}}
            <c.Tween
              @of={{c.inserted 'card'}}
              @x={{array 120 0}}
              @opacity={{array 0 1}}
              @duration={{0.6}}
              @ease='linear'
            />
          </Choreo>
        </MotionConfig>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    await animationsSettled();
    app!.shown = true;
    await settled();
    await nextFrame();
    await nextFrame();
    const card = find('#card') as HTMLElement;
    const style = getComputedStyle(card);
    assert.strictEqual(
      new DOMMatrix(style.transform).e,
      0,
      'the card is already at its resting x',
    );
    assert.true(
      parseFloat(style.opacity) < 1,
      `the card is still fading in (opacity ${style.opacity})`,
    );
    await animationsSettled();
  });
});
