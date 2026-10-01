/**
 * Port of Motion's packages/framer-motion/src/components/MotionConfig/__tests__/{MotionConfig,index}.test.tsx
 * (motion@bbabb00). `useContext(MotionConfigContext)` in a consumer becomes closestMotionConfig(element).
 * The isValidProp cases are not ported: there is no prop forwarding here (attributes are the template's).
 */
import { render, settled } from '@ember/test-helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import MotionConfig, {
  closestMotionConfig,
} from 'glimmer-motion/motion-config';
import { motionValue, type Transition, visualElementStore } from 'motion-dom';
import { module, test } from 'qunit';

import { nextFrame } from '../../helpers/motion';

const consumer = () => document.querySelector('#consumer')!;
const transitionOf = () => closestMotionConfig(consumer()).transition!;
const SPRING: Transition = { type: 'spring' };
const SPRING_1 = { type: 'spring', duration: 1 } as Transition;
const DELAY = { delay: 0.5 } as Transition;
const INHERIT_DELAY = { inherit: true, delay: 0.5 } as Transition;
const INHERIT_DURATION_2 = {
  inherit: true,
  duration: 2,
  delay: 0.5,
} as Transition;
const INHERIT_EASE = { inherit: true, ease: 'easeIn' } as Transition;
const TARGET = { opacity: 1, x: 100 };
const TWO_SECONDS = { duration: 2 };
const OFF = { type: false } as Transition;
const HALF = { opacity: 0.5 };

module('Integration | motion | MotionConfig', function (hooks) {
  setupRenderingTest(hooks);

  test('Passes down transition', async function (assert) {
    await render(
      <template>
        <MotionConfig @transition={{SPRING}}><div
            id="consumer"
          ></div></MotionConfig>
      </template>
    );
    assert.strictEqual(transitionOf().type, 'spring');
  });

  test('Passes down transition changes', async function (assert) {
    class App extends Component {
      @tracked type = 'spring';
      constructor(o: unknown, a: object) {
        super(o as never, a);
        app = this;
      }
      get transition() {
        return { type: this.type } as Transition;
      }
      <template>
        <MotionConfig @transition={{this.transition}}><div
            id="consumer"
          ></div></MotionConfig>
      </template>
    }
    let app: App | undefined;
    await render(<template><App /></template>);
    app!.type = 'tween';
    await settled();
    assert.strictEqual(transitionOf().type, 'tween');
  });

  test('Nested MotionConfig without inherit fully replaces parent transition', async function (assert) {
    await render(
      <template>
        <MotionConfig @transition={{SPRING_1}}><MotionConfig
            @transition={{DELAY}}
          ><div id="consumer"></div></MotionConfig></MotionConfig>
      </template>
    );
    const t = transitionOf();
    assert.strictEqual(t.delay, 0.5);
    assert.strictEqual(t.type, undefined);
    assert.strictEqual(t.duration, undefined);
  });

  test('Nested MotionConfig with inherit shallow-merges with parent transition', async function (assert) {
    await render(
      <template>
        <MotionConfig @transition={{SPRING_1}}><MotionConfig
            @transition={{INHERIT_DELAY}}
          ><div id="consumer"></div></MotionConfig></MotionConfig>
      </template>
    );
    const t = transitionOf();
    assert.strictEqual(t.type, 'spring');
    assert.strictEqual(t.duration, 1);
    assert.strictEqual(t.delay, 0.5);
  });

  test('inherit key is stripped from resulting transition', async function (assert) {
    await render(
      <template>
        <MotionConfig @transition={{SPRING}}><MotionConfig
            @transition={{INHERIT_DELAY}}
          ><div id="consumer"></div></MotionConfig></MotionConfig>
      </template>
    );
    assert.false('inherit' in transitionOf());
  });

  test('inherit inner keys win over parent keys', async function (assert) {
    await render(
      <template>
        <MotionConfig @transition={{SPRING_1}}><MotionConfig
            @transition={{INHERIT_DURATION_2}}
          ><div id="consumer"></div></MotionConfig></MotionConfig>
      </template>
    );
    const t = transitionOf();
    assert.strictEqual(t.type, 'spring');
    assert.strictEqual(t.duration, 2);
    assert.strictEqual(t.delay, 0.5);
  });

  test('inherit cascades through deeply nested MotionConfigs', async function (assert) {
    await render(
      <template>
        <MotionConfig @transition={{SPRING_1}}><MotionConfig
            @transition={{INHERIT_DELAY}}
          ><MotionConfig @transition={{INHERIT_EASE}}><div
                id="consumer"
              ></div></MotionConfig></MotionConfig></MotionConfig>
      </template>
    );
    const t = transitionOf();
    assert.strictEqual(t.type, 'spring');
    assert.strictEqual(t.duration, 1);
    assert.strictEqual(t.delay, 0.5);
    assert.strictEqual(t.ease, 'easeIn');
  });

  test('the config transition is the default for motion elements below it', async function (assert) {
    const opacity = motionValue(0);
    const style = { opacity };
    const instant = { type: false } as Transition;
    await render(
      <template>
        <MotionConfig @transition={{instant}}><div
            {{motion animate=HALF style=style}}
          ></div></MotionConfig>
      </template>
    );
    await nextFrame();
    assert.strictEqual(
      opacity.get(),
      0.5,
      'animated instantly with the config transition'
    );
  });

  test('reducedMotion warning fires in development mode', async function (assert) {
    const warned: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warned.push(args);
    };
    try {
      const done = new Promise<void>((resolve) => {
        (window as any).__rm = resolve;
      });
      const complete = () => (window as any).__rm();
      await render(
        <template>
          <MotionConfig @reducedMotion="always"><div
              id="el"
              {{motion
                animate=HALF
                transition=OFF
                onAnimationComplete=complete
              }}
            ></div></MotionConfig>
        </template>
      );
      await done;
      assert.true(warned.length > 0, 'console.warn was called');
      assert.true(
        (visualElementStore.get(document.querySelector('#el')!) as any)
          .shouldReduceMotion
      );
    } finally {
      console.warn = original;
    }
  });

  test('reducedMotion makes transforms animate instantly', async function (assert) {
    const x = motionValue(0),
      opacity = motionValue(0);
    const style = { x, opacity };
    await render(
      <template>
        <MotionConfig @reducedMotion="always"><div
            {{motion animate=TARGET transition=TWO_SECONDS style=style}}
          ></div></MotionConfig>
      </template>
    );
    await nextFrame();
    assert.strictEqual(x.get(), 100);
    assert.notStrictEqual(opacity.get(), 1);
  });

  test('skipAnimations makes all animations complete instantly', async function (assert) {
    const x = motionValue(0),
      opacity = motionValue(0);
    const style = { x, opacity };
    await render(
      <template>
        <MotionConfig @skipAnimations={{true}}><div
            {{motion animate=TARGET transition=TWO_SECONDS style=style}}
          ></div></MotionConfig>
      </template>
    );
    await nextFrame();
    assert.strictEqual(x.get(), 100);
    assert.strictEqual(opacity.get(), 1);
  });

  test('skipAnimations=false does not skip animations', async function (assert) {
    const x = motionValue(0),
      opacity = motionValue(0);
    const style = { x, opacity };
    await render(
      <template>
        <MotionConfig @skipAnimations={{false}}><div
            {{motion animate=TARGET transition=TWO_SECONDS style=style}}
          ></div></MotionConfig>
      </template>
    );
    await nextFrame();
    assert.notStrictEqual(x.get(), 100);
    assert.notStrictEqual(opacity.get(), 1);
  });

  test('skipAnimations is scoped to component tree', async function (assert) {
    const x1 = motionValue(0),
      o1 = motionValue(0),
      x2 = motionValue(0),
      o2 = motionValue(0);
    const s1 = { x: x1, opacity: o1 },
      s2 = { x: x2, opacity: o2 };
    await render(
      <template>
        <MotionConfig @skipAnimations={{true}}><div
            {{motion animate=TARGET transition=TWO_SECONDS style=s1}}
          ></div></MotionConfig><div
          {{motion animate=TARGET transition=TWO_SECONDS style=s2}}
        ></div>
      </template>
    );
    await nextFrame();
    assert.strictEqual(x1.get(), 100);
    assert.strictEqual(o1.get(), 1);
    assert.notStrictEqual(x2.get(), 100);
    assert.notStrictEqual(o2.get(), 1);
  });
});
