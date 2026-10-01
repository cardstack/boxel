/**
 * Port of Motion's packages/framer-motion/src/motion/__tests__/animate-prop.test.tsx (motion@v13.4.6)
 * to the Glimmer binding. Same cases, same assertions; only the render glue differs:
 *   render(<motion.div …/>) + rerender   →  render(<template>…{{motion …}}…</template>)
 *   rerender with new props              →  set a @tracked value, await settled()
 *   container.firstChild / ref           →  find('#m')
 */
import { find, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import { frame, motionValue } from 'motion-dom';
import { MotionGlobalConfig } from 'motion-utils';
import { module, test } from 'qunit';

import { nextFrame, sleep, spy } from '../../helpers/motion';

const el = () => find('#m') as HTMLElement;
const NO = { type: false } as const;

/**
 * The first change subscriber is stored on the value directly and only a
 * second creates a SubscriptionManager, so count both. Private API.
 */
const countChangeSubscribers = (value: any): number =>
  (value.changeSubscriber ? 1 : 0) + (value.events.change?.getSize() ?? 0);

/** the "props" a React test would pass; tracked so a change re-runs the modifier like a rerender */
class Props {
  @tracked initial: any;
  @tracked animate: any;
  @tracked transition: any;
  @tracked style: any;
  @tracked onUpdate: any;
  @tracked onAnimationStart: any;
  @tracked onAnimationComplete: any;
  @tracked transformTemplate: any;
  @tracked show = true;
  constructor(p: Partial<Props> = {}) {
    Object.assign(this, p);
  }
}

module('Integration | motion | animate prop as object', function (hooks) {
  setupRenderingTest(hooks);

  const mount = (p: Props) =>
    render(
      <template>
        {{#if p.show}}
          <div
            id="m"
            {{motion
              initial=p.initial
              animate=p.animate
              transition=p.transition
              style=p.style
              onUpdate=p.onUpdate
              onAnimationStart=p.onAnimationStart
              onAnimationComplete=p.onAnimationComplete
              transformTemplate=p.transformTemplate
            }}
          ></div>
        {{/if}}
      </template>
    );

  test('animates to set prop', async function (assert) {
    const x = motionValue(0);
    const done = new Promise<number>((resolve) => {
      void mount(
        new Props({
          animate: { x: 20 },
          style: { x },
          onAnimationComplete: () => resolve(x.get()),
        })
      );
    });
    assert.strictEqual(await done, 20);
  });

  test('accepts custom transition prop', async function (assert) {
    const x = motionValue(0);
    const done = new Promise<number>((resolve) => {
      void mount(
        new Props({
          animate: { x: 20 },
          transition: { x: { type: 'tween', from: 10, ease: () => 0.5 } },
          onUpdate: () => resolve(x.get()),
          style: { x },
        })
      );
    });
    assert.strictEqual(await done, 15);
  });

  test('fires onAnimationStart when animation begins', async function (assert) {
    const onStart = spy();
    const done = new Promise<void>((resolve) => {
      void mount(
        new Props({
          animate: { x: 20 },
          transition: NO,
          onAnimationStart: onStart,
          onAnimationComplete: () => resolve(),
        })
      );
    });
    await done;
    assert.strictEqual(onStart.calls.length, 1);
  });

  test('uses transition on subsequent renders', async function (assert) {
    const x = motionValue(0);
    const p = new Props({ animate: { x: 10, transition: NO }, style: { x } });
    await mount(p);
    p.animate = { x: 20, transition: NO };
    p.animate = { x: 30, transition: NO };
    await settled();
    await new Promise((r) => requestAnimationFrame(r));
    assert.strictEqual(x.get(), 30);
  });

  test('transition accepts manual from value', async function (assert) {
    const output: number[] = [];
    const done = new Promise<boolean>((resolve) => {
      void mount(
        new Props({
          initial: { x: 100 },
          animate: { x: 50 },
          transition: { from: 0, ease: 'linear' },
          onUpdate: (v: { x: number }) => output.push(v.x),
          onAnimationComplete: () => resolve(output.every((v) => v <= 50)),
        })
      );
    });
    assert.true(await done);
  });

  test('uses transitionEnd on subsequent renders', async function (assert) {
    const x = motionValue(0);
    const p = new Props({
      animate: { x: 10, transition: NO, transitionEnd: { x: 100 } },
      style: { x },
    });
    await mount(p);
    p.animate = { x: 20, transition: NO, transitionEnd: { x: 200 } };
    p.animate = { x: 30, transition: NO, transitionEnd: { x: 300 } };
    await settled();
    await nextFrame();
    await nextFrame();
    assert.strictEqual(x.get(), 300);
  });

  test('animates to set prop and preserves existing initial transform props', async function (assert) {
    const done = new Promise<HTMLElement>((resolve) => {
      void mount(
        new Props({
          initial: { scale: 0 },
          animate: { x: 20 },
          onAnimationComplete: () => setTimeout(() => resolve(el()), 20),
        })
      );
    });
    assert.strictEqual(
      (await done).style.transform,
      'translateX(20px) scale(0)'
    );
  });

  test("style doesn't overwrite in subsequent renders", async function (assert) {
    const history: number[] = [];
    const done = new Promise<boolean>((resolve) => {
      const onAnimationComplete = () =>
        setTimeout(() => {
          let overridden = false,
            prev = 0;
          for (const h of history) {
            if (h < prev) {
              overridden = true;
              break;
            }
            prev = h;
          }
          resolve(overridden);
        }, 20);
      const p = new Props({
        animate: { rotate: '1000deg' },
        transition: { duration: 0.05 },
        style: { rotate: '0deg' },
        onUpdate: ({ rotate }: any) => history.push(parseFloat(rotate)),
      });
      void mount(p);
      setTimeout(() => {
        p.animate = { rotate: '1001deg' };
        p.onAnimationComplete = onAnimationComplete;
      }, 120);
    });
    assert.false(await done);
  });

  test('applies custom transform', async function (assert) {
    const done = new Promise<HTMLElement>((resolve) => {
      void mount(
        new Props({
          initial: { x: 10 },
          animate: { x: 30 },
          transition: { duration: 0.01 },
          transformTemplate: ({ x }: any, generated: string) =>
            `translateY(${x}) ${generated}`,
          onAnimationComplete: () => requestAnimationFrame(() => resolve(el())),
        })
      );
    });
    assert.strictEqual(
      (await done).style.transform,
      'translateY(30px) translateX(30px)'
    );
  });

  test('animating between none/block fires onAnimationComplete', async function (assert) {
    const done = new Promise<boolean>((resolve) => {
      void mount(
        new Props({
          initial: { display: 'none' },
          animate: { display: 'block' },
          transition: { duration: 0.01 },
          onAnimationComplete: () => resolve(true),
        })
      );
    });
    assert.true(await done);
  });

  test('animate display none => block immediately switches to block', async function (assert) {
    const display = motionValue('block');
    let hasChecked = false;
    const done = new Promise<[boolean, string]>((resolve) => {
      void mount(
        new Props({
          initial: { display: 'none', opacity: 0 },
          animate: { display: 'block', opacity: 1 },
          style: { display },
          transition: { duration: 0.1 },
          onUpdate: (latest: any) => {
            if (!hasChecked) {
              assert.strictEqual(latest.display, 'block');
              hasChecked = true;
            }
          },
          onAnimationComplete: () => resolve([hasChecked, display.get()]),
        })
      );
    });
    assert.deepEqual(await done, [true, 'block']);
  });

  test('animate display block => none switches to none on animation end', async function (assert) {
    const display = motionValue('block');
    let hasChecked = false;
    const done = new Promise<[boolean, string]>((resolve) => {
      void mount(
        new Props({
          initial: { display: 'block', opacity: 1 },
          animate: { display: 'none', opacity: 0 },
          style: { display },
          transition: { duration: 0.1 },
          onUpdate: (latest: any) => {
            if (!hasChecked) {
              assert.strictEqual(latest.display, 'block');
              hasChecked = true;
            }
          },
          onAnimationComplete: () => resolve([hasChecked, display.get()]),
        })
      );
    });
    assert.deepEqual(await done, [true, 'none']);
  });

  test('animate visibility hidden => visible immediately switches to visible', async function (assert) {
    const visibility = motionValue('visible');
    let hasChecked = false;
    const done = new Promise<[boolean, string]>((resolve) => {
      void mount(
        new Props({
          initial: { visibility: 'hidden', opacity: 0 },
          animate: { visibility: 'visible', opacity: 1 },
          style: { visibility },
          transition: { duration: 0.1 },
          onUpdate: (latest: any) => {
            if (!hasChecked) {
              assert.strictEqual(latest.visibility, 'visible');
              hasChecked = true;
            }
          },
          onAnimationComplete: () => resolve([hasChecked, visibility.get()]),
        })
      );
    });
    assert.deepEqual(await done, [true, 'visible']);
  });

  test('animate visibility visible => hidden switches to hidden on animation end', async function (assert) {
    const visibility = motionValue('hidden');
    let hasChecked = false;
    const done = new Promise<[boolean, string]>((resolve) => {
      void mount(
        new Props({
          initial: { visibility: 'visible', opacity: 1 },
          animate: { visibility: 'hidden', opacity: 0 },
          style: { visibility },
          transition: { duration: 0.1 },
          onUpdate: (latest: any) => {
            if (!hasChecked) {
              assert.strictEqual(latest.visibility, 'visible');
              hasChecked = true;
            }
          },
          onAnimationComplete: () => resolve([hasChecked, visibility.get()]),
        })
      );
    });
    assert.deepEqual(await done, [true, 'hidden']);
  });

  test('keyframes - accepts ease as an array', async function (assert) {
    const x = motionValue(0);
    const easingListener = spy();
    const easing = (v: number) => {
      easingListener();
      return v;
    };
    const done = new Promise<void>((resolve) => {
      void mount(
        new Props({
          animate: { x: [0, 1, 2] },
          transition: { ease: [easing, easing], duration: 0.1 },
          style: { x },
          onAnimationComplete: () => resolve(),
        })
      );
    });
    await done;
    assert.true(easingListener.calls.length > 0);
  });

  test('will switch from non-animatable value to animatable value', async function (assert) {
    const done = new Promise<HTMLElement>((resolve) => {
      void mount(
        new Props({
          animate: { fontWeight: 100 },
          style: { fontWeight: 'normal' },
          onAnimationComplete: () => resolve(el()),
        })
      );
    });
    assert.strictEqual(getComputedStyle(await done).fontWeight, '100');
  });

  test("doesn't animate no-op values", async function (assert) {
    let isAnimating = false;
    await mount(
      new Props({
        initial: { opacity: 1, x: 0 },
        animate: { opacity: 1, x: 0 },
        transition: {
          opacity: { duration: 2, type: 'tween', velocity: 100 },
          x: { type: 'spring', velocity: 0 },
        },
        onAnimationStart: () => (isAnimating = true),
        onAnimationComplete: () => (isAnimating = false),
      })
    );
    await nextFrame();
    await nextFrame();
    assert.false(isAnimating);
  });

  test("doesn't animate no-op keyframes", async function (assert) {
    let isAnimating = false;
    await mount(
      new Props({
        initial: { opacity: 1, x: 0 },
        animate: { opacity: [1, 1], x: [0, 0] },
        transition: {
          opacity: { duration: 2, type: 'tween', velocity: 100 },
          x: { type: 'spring', velocity: 0 },
        },
        onAnimationStart: () => (isAnimating = true),
        onAnimationComplete: () => (isAnimating = false),
      })
    );
    await nextFrame();
    await nextFrame();
    assert.false(isAnimating);
  });

  test('does animate different keyframes', async function (assert) {
    let isAnimating = false;
    await mount(
      new Props({
        initial: { opacity: 1, x: 0 },
        animate: { opacity: [0, 1], x: [0, 1] },
        transition: {
          opacity: { duration: 2, type: 'tween', velocity: 100 },
          x: { type: 'spring', velocity: 0 },
        },
        onAnimationStart: () => (isAnimating = true),
        onAnimationComplete: () => (isAnimating = false),
      })
    );
    await nextFrame();
    await nextFrame();
    assert.true(isAnimating);
  });

  test('does animate no-op values if velocity is non-zero and animation type is spring', async function (assert) {
    let isAnimating = false;
    await mount(
      new Props({
        initial: { opacity: 1 },
        animate: { opacity: 1, transition: { type: 'spring', velocity: 100 } },
        onAnimationStart: () => (isAnimating = true),
        onAnimationComplete: () => (isAnimating = false),
      })
    );
    const seen = await new Promise<boolean>((resolve) =>
      frame.postRender(() => frame.postRender(() => resolve(isAnimating)))
    );
    assert.true(seen);
  });

  test("doesn't animate zIndex", async function (assert) {
    await mount(new Props({ animate: { zIndex: 100 } }));
    await nextFrame();
    assert.strictEqual(el().style.zIndex, '100');
  });

  test('when value is removed from animate, animates back to value originally defined in initial prop', async function (assert) {
    const p = new Props({
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: NO,
    });
    await mount(p);
    await nextFrame();
    assert.strictEqual(el().style.opacity, '1');
    p.animate = {};
    await settled();
    await nextFrame();
    assert.strictEqual(el().style.opacity, '0');
  });

  test('when value is removed from animate, animates back to value currently defined in initial prop', async function (assert) {
    const p = new Props({
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: NO,
    });
    await mount(p);
    await nextFrame();
    assert.strictEqual(el().style.opacity, '1');
    p.initial = { opacity: 0.5 };
    p.animate = {};
    await settled();
    await nextFrame();
    assert.strictEqual(el().style.opacity, '0.5');
  });

  test('when value is removed from both animate and initial, perform no animation', async function (assert) {
    const p = new Props({
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: NO,
    });
    await mount(p);
    await nextFrame();
    assert.strictEqual(el().style.opacity, '1');
    p.initial = {};
    p.animate = {};
    await settled();
    await nextFrame();
    assert.strictEqual(el().style.opacity, '1');
  });

  test('accepts default transition prop', async function (assert) {
    const x = motionValue(0),
      opacity = motionValue(0);
    const done = new Promise<[number, number]>((resolve) => {
      void mount(
        new Props({
          animate: { opacity: 1, x: 20 },
          transition: {
            default: NO,
            x: { type: 'tween', from: 10, ease: () => 0.5 },
          },
          onUpdate: () => frame.read(() => resolve([x.get(), opacity.get()])),
          style: { x, opacity },
        })
      );
    });
    assert.deepEqual(await done, [15, 1]);
  });

  test('accepts base transition settings', async function (assert) {
    const x = motionValue(0),
      opacity = motionValue(0);
    const done = new Promise<[number, number]>((resolve) => {
      void mount(
        new Props({
          animate: { opacity: 1, x: 20 },
          transition: {
            type: false,
            duration: 1,
            x: { type: 'tween', from: 10, ease: () => 0.5 },
          },
          onUpdate: () => frame.read(() => resolve([x.get(), opacity.get()])),
          style: { x, opacity },
        })
      );
    });
    assert.deepEqual(await done, [15, 1]);
  });

  test('when value is removed from animate, animate back to value read from DOM', async function (assert) {
    const p = new Props({
      style: { opacity: 0.5 },
      animate: { opacity: 1 },
      transition: NO,
    });
    await mount(p);
    await nextFrame();
    // environment delta, not a binding one: the start value here is read from the DOM, which the engine
    // does in the next frame's read phase, and the instant animation commits the frame after. jsdom
    // (Motion's Jest env) collapses the frameloop; a real browser needs the second frame.
    await nextFrame();
    assert.strictEqual(el().style.opacity, '1');
    p.animate = {};
    await settled();
    await nextFrame();
    assert.strictEqual(el().style.opacity, '0.5');
  });

  test('respects repeatDelay prop', async function (assert) {
    const x = motionValue(0);
    const done = new Promise<number>((resolve) => {
      x.on('change', () => setTimeout(() => resolve(x.get()), 50));
      void mount(
        new Props({
          animate: { x: [0, 20] },
          transition: {
            x: {
              type: 'tween',
              duration: 0,
              repeatDelay: 0.1,
              repeat: 1,
              repeatType: 'reverse',
            },
          },
          style: { x },
        })
      );
    });
    assert.strictEqual(await done, 20);
  });

  for (const [repeatType, repeat, expected] of [
    ['reverse', 1, 0],
    ['mirror', 1, 0],
    ['loop', 1, 20],
    ['reverse', 2, 20],
    ['mirror', 2, 20],
    ['loop', 2, 20],
  ] as const) {
    test(`Correctly applies final keyframe with repeatType ${repeatType} and ${repeat % 2 ? 'odd' : 'even'} numbered repeat`, async function (assert) {
      const x = motionValue(0);
      const done = new Promise<number>((resolve) => {
        void mount(
          new Props({
            animate: { x: [0, 20] },
            transition: {
              x: {
                type: 'tween',
                duration: 0.1,
                repeatDelay: 0.1,
                repeat,
                repeatType,
              },
            },
            onAnimationComplete: () => frame.postRender(() => resolve(x.get())),
            style: { x },
          })
        );
      });
      assert.strictEqual(await done, expected);
    });
  }

  test('animates previously unseen properties, instant animation', async function (assert) {
    const p = new Props({ animate: { x: 100 }, transition: NO });
    await mount(p);
    p.animate = { y: 100 };
    await settled();
    await nextFrame();
    assert.strictEqual(el().style.transform, 'translateY(100px)');
  });

  test('animates previously unseen properties', async function (assert) {
    const p = new Props({ animate: { x: 100 }, transition: { duration: 0 } });
    await mount(p);
    p.animate = { y: 100 };
    await settled();
    await nextFrame();
    await nextFrame();
    assert.strictEqual(el().style.transform, 'translateY(100px)');
  });

  test('converts unseen zero unit types to number', async function (assert) {
    const done = new Promise<HTMLElement>((resolve) => {
      void mount(
        new Props({
          animate: { borderRadius: 20 },
          transition: { duration: 0.01 },
          onAnimationComplete: () => resolve(el()),
          style: { borderRadius: '0px' },
        })
      );
    });
    assert.strictEqual((await done).style.borderRadius, '20px');
  });

  test('animates previously unseen CSS variables', async function (assert) {
    let latestColor = '';
    const done = new Promise<string>((resolve) => {
      void mount(
        new Props({
          style: { '--foo': '#fff' },
          animate: { '--foo': '#000' },
          onUpdate: (latest: any) => (latestColor = latest['--foo']),
          onAnimationComplete: () => resolve(latestColor),
          transition: NO,
        })
      );
    });
    assert.strictEqual(await done, '#000');
  });

  test('forces an animation to fallback if has been set to `null`', async function (assert) {
    const p = new Props({ animate: { x: 100 }, transition: NO });
    await mount(p);
    await nextFrame();
    p.animate = { x: null };
    await settled();
    await nextFrame();
    assert.strictEqual(el().style.transform, 'none');
    const done = new Promise<boolean>((resolve) => {
      p.animate = { x: 100 };
      p.onAnimationComplete = () => resolve(true);
    });
    assert.true(await done);
  });

  test("mount animation doesn't run if `initial={false}`", async function (assert) {
    const onComplete = spy();
    const x = motionValue(0),
      y = motionValue(0),
      z = motionValue(0);
    await mount(
      new Props({
        initial: false,
        animate: { x: 20, y: 20, transitionEnd: { x: 10, z: 20 } },
        transition: NO,
        style: { x, y, z },
        onAnimationComplete: onComplete,
      })
    );
    await sleep(10);
    assert.strictEqual(onComplete.calls.length, 0);
    assert.deepEqual([x.get(), y.get(), z.get()], [10, 20, 20]);
  });

  test('unmount cancels active animations', async function (assert) {
    const onComplete = spy();
    const p = new Props({
      animate: { x: 20 },
      transition: { duration: 0.2 },
      onAnimationComplete: () => onComplete(),
    });
    await mount(p);
    await sleep(100);
    p.show = false;
    await settled();
    await sleep(200);
    assert.strictEqual(onComplete.calls.length, 0);
  });

  test('animate prop accepts pathOffset', async function (assert) {
    await mount(new Props({ animate: { pathOffset: 1, pathSpacing: 1 } }));
    assert.ok(el());
  });

  for (const [name, from, to, expected] of [
    [
      'RGB to HSLA',
      'rgb(0, 153, 255)',
      'hsl(345, 100%, 60%)',
      'rgb(255, 51, 102)',
    ],
    ['HEX to HSLA', '#0088ff', 'hsl(345, 100%, 60%)', 'rgb(255, 51, 102)'],
    ['HSLA to Hex', 'hsla(345, 100%, 60%, 1)', '#0088ff', 'rgb(0, 136, 255)'],
    [
      'HSLA to RGB',
      'hsla(345, 100%, 60%, 1)',
      'rgba(0, 136, 255, 1)',
      'rgb(0, 136, 255)',
    ],
  ] as const) {
    test(`Correctly animates from ${name}`, async function (assert) {
      const done = new Promise<HTMLElement>((resolve) => {
        void mount(
          new Props({
            initial: { backgroundColor: from },
            animate: { backgroundColor: to },
            onAnimationComplete: () => resolve(el()),
            transition: { duration: 0.01 },
          })
        );
      });
      // the browser normalises every colour to rgb(); jest-dom's toHaveStyle did the same in jsdom
      assert.strictEqual(
        getComputedStyle(await done).backgroundColor,
        expected
      );
    });
  }

  test('animationStart event fires as expected', async function (assert) {
    const x = motionValue(0);
    const fn = spy();
    x.on('animationStart', fn);
    const done = new Promise<void>((resolve) => {
      void mount(
        new Props({
          animate: { x: 100 },
          transition: { duration: 0.01 },
          style: { x },
          onUpdate: () => resolve(),
        })
      );
    });
    await done;
    assert.true(fn.calls.length > 0);
  });

  test("doesn't error when provided unknown animation type", async function (assert) {
    await mount(
      new Props({ animate: { x: 100 }, transition: { type: 'test' } })
    );
    assert.ok(el());
  });

  test('correctly implements custom mix function', async function (assert) {
    (MotionGlobalConfig as any).mix = () => () => 'black';
    const done = new Promise<boolean>((resolve) => {
      void mount(
        new Props({
          initial: { backgroundColor: 'rgba(255, 255, 0, 1)' },
          animate: { backgroundColor: 'color(display-p3 0 1 0 / 0.5)' },
          transition: { duration: 0.1 },
          onUpdate: ({ backgroundColor }: any) => {
            assert.strictEqual(backgroundColor, 'black');
            delete (MotionGlobalConfig as any).mix;
            resolve(true);
          },
        })
      );
    });
    assert.true(await done);
  });

  test('Correctly animates complex value types on first rerender', async function (assert) {
    const output: string[] = [];
    const done = new Promise<string[]>((resolve) => {
      void mount(
        new Props({
          animate: {
            background:
              'linear-gradient(0deg, hsl(216, 100%, 50%) 0%, hsl(301, 100%, 50%) 100%)',
          },
          onUpdate: ({ background }: any) => output.push(background),
          onAnimationComplete: () => resolve(output),
          style: {
            background:
              'linear-gradient(180deg, hsl(216, 100%, 50%) 0%, hsl(301, 100%, 50%) 100%)',
          },
        })
      );
    });
    assert.notStrictEqual((await done).length, 1);
  });

  test("Doesn't double-add listeners to externally-provided motion values", async function (assert) {
    const x = motionValue(0);
    const done = new Promise<number>((resolve) => {
      void mount(
        new Props({
          animate: { x: 100 },
          transition: { duration: 0.01 },
          onAnimationStart: () => resolve(countChangeSubscribers(x)),
          style: { x },
        })
      );
    });
    assert.strictEqual(await done, 1);
  });

  test('Positional values without specific handlers are not measured', async function (assert) {
    const done = new Promise<boolean>((resolve) => {
      void mount(
        new Props({
          initial: { rotate: '10deg', x: 100 },
          animate: { rotate: '2turn', x: 200 },
          transition: { duration: 0.01 },
          onAnimationComplete: () => resolve(true),
        })
      );
    });
    assert.true(await done);
  });

  // Not ported: "Resets motion values to initial after Suspense remount" — React Suspense has no Glimmer analogue.
});

// Not ported: "Suspense boundary re-suspends and reveals memoized content" — React Suspense has no Glimmer analogue.
