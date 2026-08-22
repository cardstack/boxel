/**
 * Port of Motion's packages/framer-motion/src/motion/__tests__/variant.test.tsx (motion@bbabb00).
 * Same cases and assertions; React glue → Glimmer glue (see animate-prop-test).
 * Nested motion.divs become nested elements carrying {{motion}}; variant context
 * and presence flow through the VisualElement tree, as MotionContext would.
 */
import { find, findAll, render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupRenderingTest } from 'ember-qunit';
import motion from 'glimmer-motion/motion';
import {
  frame,
  motionValue,
  stagger,
  type Variants,
  visualElementStore,
} from 'motion-dom';
import { module, test } from 'qunit';

import { nextFrame, sleep, spy } from '../../helpers/motion';

const NO = { type: false } as const;
const el = (id = 'm') => find(`#${id}`) as HTMLElement;
const raf = () => new Promise((r) => requestAnimationFrame(r));

class P {
  @tracked animate: any;
  @tracked initial: any;
  @tracked style: any;
  @tracked variants: any;
  @tracked onAnimationComplete: any;
  @tracked x = 0;
  @tracked opacity = 0;
  @tracked isOpen = false;
  @tracked isVisible = false;
  @tracked length = 1;
  @tracked items: string[] = [];
  @tracked activeVariants: string[] = [];
  constructor(p: Partial<P> = {}) {
    Object.assign(this, p);
  }
  get range() {
    return Array.from({ length: this.length }, (_, i) => i);
  }
}

module('Integration | motion | animate prop as variant', function (hooks) {
  setupRenderingTest(hooks);

  test('animates to set variant', async function (assert) {
    const variants: Variants = {
      hidden: { opacity: 0, x: -100, transition: NO },
      visible: { opacity: 1, x: 100, transition: NO },
    };
    const x = motionValue(0);
    const style = { x };
    const done = new Promise<number>((resolve) => {
      const onComplete = () => resolve(x.get());
      void render(
        <template>
          <div
            {{motion
              animate="visible"
              variants=variants
              style=style
              onAnimationComplete=onComplete
            }}
          ></div>
        </template>
      );
    });
    assert.strictEqual(await done, 100);
  });

  test('fires onAnimationStart when animation begins', async function (assert) {
    const onStart = spy();
    const done = new Promise<void>((resolve) => {
      const onComplete = () => resolve();
      void render(
        <template>
          <div
            {{motion
              animate="visible"
              transition=NO
              onAnimationStart=onStart
              onAnimationComplete=onComplete
            }}
          ></div>
        </template>
      );
    });
    await done;
    assert.strictEqual(onStart.calls.length, 1);
  });

  test('fires onAnimationStart with the animation definition', async function (assert) {
    const onStart = spy<[unknown]>();
    const done = new Promise<void>((resolve) => {
      const onComplete = () => resolve();
      const start = (definition: unknown) => onStart(definition);
      void render(
        <template>
          <div
            {{motion
              animate="visible"
              transition=NO
              onAnimationStart=start
              onAnimationComplete=onComplete
            }}
          ></div>
        </template>
      );
    });
    await done;
    assert.deepEqual(onStart.calls[0], ['visible']);
  });

  test('child animates to set variant', async function (assert) {
    const variants: Variants = {
      hidden: { opacity: 0, x: -100, transition: NO },
      visible: { opacity: 1, x: 100, transition: NO },
    };
    const childVariants: Variants = {
      hidden: { opacity: 0, x: -100, transition: NO },
      visible: { opacity: 1, x: 50, transition: NO },
    };
    const x = motionValue(0);
    const style = { x };
    const done = new Promise<number>((resolve) => {
      const onComplete = () => resolve(x.get());
      void render(
        <template>
          <div
            {{motion
              animate="visible"
              variants=variants
              onAnimationComplete=onComplete
            }}
          ><div {{motion variants=childVariants style=style}}></div></div>
        </template>
      );
    });
    assert.strictEqual(await done, 50);
  });

  test('child animates to set variant even if variants are not found on parent', async function (assert) {
    const childVariants: Variants = {
      hidden: { opacity: 0, x: -100, transition: NO },
      visible: { opacity: 1, x: 50, transition: NO },
    };
    const x = motionValue(0);
    const style = { x };
    const done = new Promise<number>((resolve) => {
      const onComplete = () => resolve(x.get());
      void render(
        <template>
          <div {{motion animate="visible" onAnimationComplete=onComplete}}><div
              {{motion variants=childVariants style=style}}
            ></div></div>
        </template>
      );
    });
    assert.strictEqual(await done, 50);
  });

  test('applies applyOnEnd if set on initial', async function (assert) {
    const variants: Variants = {
      visible: { background: '#f00', transitionEnd: { display: 'none' } },
    };
    await render(
      <template>
        <div id="m" {{motion variants=variants initial="visible"}}></div>
      </template>
    );
    assert.strictEqual(el().style.display, 'none');
  });

  test('applies applyOnEnd and end of animation', async function (assert) {
    const variants: Variants = {
      hidden: { background: '#00f' },
      visible: { background: '#f00', transitionEnd: { display: 'none' } },
    };
    const display = motionValue('block');
    const style = { display };
    const done = new Promise<string>((resolve) => {
      const onComplete = () => frame.postRender(() => resolve(display.get()));
      void render(
        <template>
          <div
            {{motion
              initial="hidden"
              animate="visible"
              variants=variants
              transition=NO
              onAnimationComplete=onComplete
              style=style
            }}
          ></div>
        </template>
      );
    });
    assert.strictEqual(await done, 'none');
  });

  test('accepts custom transition', async function (assert) {
    const variants: Variants = {
      hidden: { background: '#00f' },
      visible: {
        background: '#f00',
        transition: { from: '#555', ease: () => 0.5 },
      },
    };
    const background = motionValue('#00f');
    const style = { background };
    const done = new Promise<string>((resolve) => {
      const onUpdate = () => resolve(background.get());
      void render(
        <template>
          <div
            {{motion
              initial="hidden"
              animate="visible"
              variants=variants
              transition=NO
              onUpdate=onUpdate
              style=style
            }}
          ></div>
        </template>
      );
    });
    assert.strictEqual(await done, 'rgba(190, 60, 60, 1)');
  });

  test('respects orchestration props in transition prop', async function (assert) {
    const opacity = motionValue(0);
    const parentV = { visible: { opacity: 1 }, hidden: { opacity: 0 } };
    const childV = { visible: { opacity: 0.9 }, hidden: { opacity: 0 } };
    const t = { type: false as const, delayChildren: 1 };
    const style = { opacity };
    await render(
      <template>
        <div
          {{motion
            variants=parentV
            initial="hidden"
            animate="visible"
            transition=t
          }}
        ><div
            id="test"
            {{motion variants=childV transition=NO style=style}}
          ></div></div>
      </template>
    );
    await raf();
    assert.strictEqual(el('test').style.opacity, '0');
  });

  test('delay propagates throughout children', async function (assert) {
    const opacity = motionValue(0);
    const variants: Variants = {
      visible: { opacity: 1 },
      hidden: { opacity: 0 },
    };
    const t = { type: false as const, delayChildren: 1 };
    const style = { opacity };
    await render(
      <template>
        <div
          {{motion
            variants=variants
            initial="hidden"
            animate="visible"
            transition=t
          }}
        ><div {{motion variants=variants transition=NO}}><div
              {{motion variants=variants style=style}}
            ></div></div></div>
      </template>
    );
    await sleep(300);
    assert.strictEqual(opacity.get(), 0);
  });

  test('propagates through components with no `animate` prop', async function (assert) {
    const opacity = motionValue(0);
    const variants: Variants = { visible: { opacity: 1 } };
    const style = { opacity };
    await render(
      <template>
        <div
          {{motion
            variants=variants
            initial="hidden"
            animate="visible"
            transition=NO
          }}
        ><div {{motion}}><div
              {{motion variants=variants transition=NO style=style}}
            ></div></div></div>
      </template>
    );
    await raf();
    assert.strictEqual(opacity.get(), 1);
  });

  test("doesn't propagate to a component with its own `animate` prop", async function (assert) {
    const opacity = motionValue(1);
    const parentVariants = { initial: { x: 0 }, animate: { x: 100 } };
    const childVariants = { initial: { opacity: 0 }, animate: { opacity: 1 } };
    const t = { duration: 0.05 };
    const style = { opacity };
    await render(
      <template>
        <div
          {{motion
            initial="initial"
            animate="animate"
            variants=parentVariants
            transition=t
          }}
        ><div
            {{motion
              animate="initial"
              variants=childVariants
              style=style
              transition=t
            }}
          ></div></div>
      </template>
    );
    await sleep(100);
    assert.strictEqual(opacity.get(), 0);
  });

  test('when: beforeChildren works correctly', async function (assert) {
    const opacity = motionValue(0.1);
    const variants: Variants = {
      visible: {
        opacity: 1,
        transition: { duration: 1, when: 'beforeChildren' },
      },
    };
    const style = { opacity };
    // environment delta: the parent's initial="hidden" names no variant, so its start opacity is read from the
    // DOM. jsdom's getComputedStyle returns "" (→ 0) and the parent really animates for 1s before its children;
    // a browser returns "1", there is nothing to animate, and beforeChildren resolves at once. Start it at 0.
    const parentStyle = { opacity: 0 };
    await render(
      <template>
        <div
          {{motion
            variants=variants
            initial="hidden"
            animate="visible"
            style=parentStyle
          }}
        ><div {{motion}}><div
              {{motion variants=variants style=style}}
            ></div></div></div>
      </template>
    );
    await sleep(200);
    assert.strictEqual(opacity.get(), 0.1);
  });

  test('when: afterChildren works correctly', async function (assert) {
    const parentOpacity = motionValue(0.1);
    const childOpacity = motionValue(0.1);
    const variants: Variants = {
      hidden: { opacity: 0, display: 'block' },
      visible: { opacity: 1, transitionEnd: { display: 'none' } },
    };
    const t = { duration: 0.1, when: 'afterChildren' as const };
    const ct = { duration: 0.1 };
    const ps = { opacity: parentOpacity };
    const cs = { opacity: childOpacity };
    const p = new P({ animate: 'hidden' });
    await render(
      <template>
        <div
          {{motion
            variants=variants
            initial=false
            transition=t
            animate=p.animate
            style=ps
            onAnimationComplete=p.onAnimationComplete
          }}
        ><div {{motion}}><div
              {{motion variants=variants transition=ct style=cs}}
            ></div></div></div>
      </template>
    );
    await new Promise<void>((resolve) => {
      p.onAnimationComplete = () => {
        assert.strictEqual(parentOpacity.get(), 1);
        assert.strictEqual(childOpacity.get(), 1);
        p.onAnimationComplete = () => {
          assert.strictEqual(parentOpacity.get(), 0);
          assert.strictEqual(childOpacity.get(), 0);
          resolve();
        };
        p.animate = 'hidden';
        setTimeout(() => {
          assert.strictEqual(parentOpacity.get(), 1);
          assert.notStrictEqual(childOpacity.get(), 1);
        }, 50);
      };
      p.animate = 'visible';
      setTimeout(() => {
        assert.strictEqual(parentOpacity.get(), 0);
        assert.notStrictEqual(childOpacity.get(), 0);
      }, 50);
    });
  });

  test('FRAMER BUG: When a value is removed from an element as the result of a parent variant, fallback to style', async function (assert) {
    // MotionFragment (a variant-controlling node with no DOM) becomes a plain wrapper element here
    const variants = { a: { opacity: 0.5 }, b: { opacity: 1 }, c: {} };
    const style = { opacity: 0 };
    const p = new P();
    await render(
      <template>
        <div {{motion initial="a" animate=p.animate}}><div
            id="child"
            {{motion variants=variants transition=NO style=style}}
          ></div></div>
      </template>
    );
    assert.strictEqual(el('child').style.opacity, '0.5');
    p.animate = 'a';
    await settled();
    await nextFrame();
    assert.strictEqual(el('child').style.opacity, '0.5');
    p.animate = 'b';
    await settled();
    await nextFrame();
    assert.strictEqual(el('child').style.opacity, '1');
    p.animate = 'c';
    await settled();
    await nextFrame();
    assert.strictEqual(el('child').style.opacity, '0'); // Contained in variant a, which is set as initial
  });

  test('initial: false correctly propagates', async function (assert) {
    const opacity = motionValue(0.5);
    const variants = { visible: { opacity: 0.9 }, hidden: { opacity: 0 } };
    const style = { opacity };
    await render(
      <template>
        <div {{motion initial=false animate="visible"}}><div {{motion}}><div
              {{motion variants=variants style=style}}
            ></div></div></div>
      </template>
    );
    await sleep(200);
    assert.strictEqual(opacity.get(), 0.9);
  });

  test("initial=false doesn't propagate to props", async function (assert) {
    const animate = { opacity: 0.4 };
    await render(
      <template>
        <div {{motion initial=false animate="test"}}><div
            id="child"
            {{motion animate=animate}}
          ></div></div>
      </template>
    );
    assert.notStrictEqual(el('child').style.opacity, '0.4');
  });

  test('nested controlled variants switch correctly', async function (assert) {
    const parentOpacity = motionValue(0.2);
    const childOpacity = motionValue(0.1);
    const pv = { visible: { opacity: 0.3 }, hidden: { opacity: 0.4 } };
    const cv = { visible: { opacity: 0.5 }, hidden: { opacity: 0.6 } };
    const ps = { opacity: parentOpacity };
    const cs = { opacity: childOpacity };
    const p = new P({ isOpen: false });
    const state = () => (p.isOpen ? 'visible' : 'hidden');
    await render(
      <template>
        <div
          {{motion
            variants=pv
            initial="hidden"
            animate=(state)
            transition=NO
            style=ps
          }}
        ><div
            {{motion
              variants=cv
              initial="hidden"
              transition=NO
              animate=(state)
              style=cs
            }}
          ></div></div>
      </template>
    );
    await nextFrame();
    assert.strictEqual(parentOpacity.get(), 0.4);
    assert.strictEqual(childOpacity.get(), 0.6);
    p.isOpen = true;
    await settled();
    await nextFrame();
    assert.deepEqual([parentOpacity.get(), childOpacity.get()], [0.3, 0.5]);
  });

  for (const [name, transition, childTransition] of [
    [
      'delayChildren: stagger()',
      { delayChildren: stagger(0.15) },
      { duration: 0.1 },
    ],
    [
      'delayChildren: stagger() (value-specific transitions)',
      { delayChildren: stagger(0.15) },
      { opacity: { duration: 0.1 } },
    ],
    [
      'staggerChildren (deprecated)',
      { staggerChildren: 0.15 },
      { duration: 0.1 },
    ],
    [
      'staggerChildren (deprecated, value-specific transitions)',
      { staggerChildren: 0.15 },
      { opacity: { duration: 0.1 } },
    ],
  ] as const) {
    test(`Child variants correctly calculate delay based on ${name}`, async function (assert) {
      const a = motionValue(0),
        b = motionValue(0);
      const childVariants = {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: childTransition },
      };
      const parentVariants = { hidden: {}, visible: { x: 100, transition } };
      const sa = { opacity: a },
        sb = { opacity: b };
      const done = new Promise<boolean>((resolve) => {
        a.on('change', (latest) => {
          if (latest >= 1 && b.get() === 0) {
            resolve(true);
          }
        });
        void render(
          <template>
            <div
              {{motion
                variants=parentVariants
                initial="hidden"
                animate="visible"
              }}
            ><div {{motion variants=childVariants style=sa}}></div><div
                {{motion variants=childVariants style=sb}}
              ></div></div>
          </template>
        );
      });
      assert.true(await done);
    });
  }

  test('components without variants are transparent to stagger order', async function (assert) {
    const order: number[] = [];
    const delayedBy: number[] = [];
    const staggerDuration = 0.1;
    const updateDelayedBy = (i: number) => {
      if (delayedBy[i]) {
        return;
      }
      delayedBy[i] = performance.now();
    };
    const checkStaggerEquidistance = () => {
      let isEquidistant = true,
        prev = 0;
      for (let i = 0; i < delayedBy.length; i++) {
        if (prev) {
          const timeSincePrev = prev - delayedBy[i]!;
          if (
            Math.round(timeSincePrev / 100) * 100 !==
            staggerDuration * 1000
          ) {
            isEquidistant = false;
          }
        }
        prev = delayedBy[i]!;
      }
      return isEquidistant;
    };
    const parentVariants: Variants = {
      visible: {
        transition: { staggerChildren: staggerDuration, staggerDirection: -1 },
      },
    };
    const variants: Variants = {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: { duration: 0.000001 } },
    };
    const wc = { willChange: 'auto' };
    const u1 = () => {
      updateDelayedBy(0);
      order.push(1);
    };
    const u2 = () => {
      updateDelayedBy(1);
      order.push(2);
    };
    const u3 = () => {
      updateDelayedBy(2);
      order.push(3);
    };
    const u4 = () => {
      updateDelayedBy(3);
      order.push(4);
    };
    const [recordedOrder, staggeredEqually] = await new Promise<
      [number[], boolean]
    >((resolve) => {
      const onComplete = () =>
        requestAnimationFrame(() =>
          resolve([order, checkStaggerEquidistance()])
        );
      void render(
        <template>
          <div
            {{motion
              initial="hidden"
              animate="visible"
              variants=parentVariants
              onAnimationComplete=onComplete
            }}
          >
            <div {{motion}}>
              <div {{motion}}></div>
              <div {{motion variants=variants onUpdate=u1 style=wc}}></div>
              <div {{motion variants=variants onUpdate=u2 style=wc}}></div>
            </div>
            <div {{motion}}>
              <div {{motion variants=variants onUpdate=u3 style=wc}}></div>
              <div {{motion variants=variants onUpdate=u4 style=wc}}></div>
            </div>
          </div>
        </template>
      );
    });
    assert.deepEqual(recordedOrder, [4, 3, 2, 1]);
    assert.true(staggeredEqually);
  });

  test('onUpdate', async function (assert) {
    let latest = {};
    const onUpdate = (l: Record<string, number | string>) => {
      latest = l;
    };
    const initial = { x: 0, y: 0 },
      animate = { x: 100, y: 100 },
      t = { duration: 0.1 };
    const done = new Promise<unknown>((resolve) => {
      const onComplete = () => frame.postRender(() => resolve(latest));
      void render(
        <template>
          <div
            {{motion
              onUpdate=onUpdate
              initial=initial
              animate=animate
              transition=t
              onAnimationComplete=onComplete
            }}
          ></div>
        </template>
      );
    });
    assert.deepEqual(await done, { x: 100, y: 100 });
  });

  test('onUpdate doesnt fire if no values have changed', async function (assert) {
    const onUpdate = spy();
    const x = motionValue(0);
    const style = { x, willChange: 'transform' };
    const p = new P({ x: 0 });
    const animate = () => ({ x: p.x });
    const update = (latest: any) => {
      assert.notStrictEqual(latest.willChange, 'auto');
      onUpdate(latest);
    };
    await render(
      <template>
        <div
          {{motion animate=(animate) transition=NO onUpdate=update style=style}}
        ></div>
      </template>
    );
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        p.x = 1;
      }, 30);
      setTimeout(() => {
        p.x = 1;
      }, 60);
      setTimeout(() => resolve(), 90);
    });
    assert.strictEqual(onUpdate.calls.length, 1);
  });

  test('new child items animate from initial to animate', async function (assert) {
    const x = motionValue(0);
    const variants: Variants = {
      hidden: { opacity: 0, x: -100, transition: NO },
      visible: { opacity: 1, x: 100, transition: NO },
    };
    const p = new P({ length: 1 });
    const styleFor = (i: number) => ({ x: i === 1 ? x : 0 });
    await render(
      <template>
        <div {{motion initial="hidden" animate="visible"}}><div
            {{motion}}
          >{{#each p.range as |i|}}<div
                {{motion variants=variants style=(styleFor i)}}
              ></div>{{/each}}</div></div>
      </template>
    );
    p.length = 2;
    await settled();
    await nextFrame();
    assert.strictEqual(x.get(), 100);
  });

  test('style is used as fallback when a variant is removed from animate', async function (assert) {
    const variants = { a: { opacity: 1 } };
    const style = { opacity: 0 };
    const p = new P();
    await render(
      <template>
        <div
          id="m"
          {{motion
            animate=p.animate
            variants=variants
            transition=NO
            style=style
          }}
        ></div>
      </template>
    );
    assert.strictEqual(el().style.opacity, '0');
    // start values read from the DOM resolve a frame later in a real browser (see animate-prop port)
    p.animate = 'a';
    await settled();
    await nextFrame();
    await nextFrame();
    assert.strictEqual(el().style.opacity, '1');
    p.animate = undefined;
    await settled();
    await nextFrame();
    assert.strictEqual(el().style.opacity, '0');
  });

  test('style is active once value has been removed from animate', async function (assert) {
    const variants = { a: { opacity: 1, rotate: 1 } };
    const p = new P({ opacity: 0 });
    const style = () => ({ opacity: p.opacity, rotate: p.opacity });
    await render(
      <template>
        <div
          id="m"
          {{motion
            animate=p.animate
            variants=variants
            transition=NO
            style=(style)
          }}
        ></div>
      </template>
    );
    assert.strictEqual(el().style.opacity, '0');
    assert.strictEqual(el().style.transform, 'none');
    // start values read from the DOM resolve a frame later in a real browser (see animate-prop port)
    p.animate = 'a';
    await settled();
    await nextFrame();
    await nextFrame();
    assert.strictEqual(el().style.opacity, '1');
    assert.strictEqual(el().style.transform, 'rotate(1deg)');
    p.animate = undefined;
    await settled();
    await nextFrame();
    assert.strictEqual(el().style.opacity, '0');
    assert.strictEqual(el().style.transform, 'none');
    p.opacity = 0.5;
    await settled();
    await nextFrame();
    assert.strictEqual(el().style.opacity, '0.5');
    assert.strictEqual(el().style.transform, 'rotate(0.5deg)');
    // Re-adding value to animated stack will animate value correctly
    p.animate = 'a';
    await settled();
    await nextFrame();
    assert.strictEqual(el().style.opacity, '1');
    assert.strictEqual(el().style.transform, 'rotate(1deg)');
    // While animate is active, changing style doesn't change value
    p.opacity = 0.75;
    await settled();
    await nextFrame();
    assert.strictEqual(el().style.opacity, '1');
    assert.strictEqual(el().style.transform, 'rotate(1deg)');
  });

  test('variants work the same whether defined inline or not', async function (assert) {
    const variants = { foo: { opacity: [1, 0, 1] } };
    const inline = { foo: { opacity: [1, 0, 1] } };
    const outputA: number[] = [],
      outputB: number[] = [];
    const t = { duration: 0.1 };
    const ua = ({ opacity }: any) => outputA.push(opacity);
    const ub = ({ opacity }: any) => outputB.push(opacity);
    const p = new P({ activeVariants: ['foo'] });
    await render(
      <template>
        <div
          {{motion
            animate=p.activeVariants
            variants=inline
            transition=t
            onUpdate=ua
          }}
        ></div><div
          {{motion
            animate=p.activeVariants
            variants=variants
            transition=t
            onUpdate=ub
          }}
        ></div>
      </template>
    );
    await new Promise<void>((resolve) =>
      setTimeout(() => {
        p.activeVariants = ['foo', 'bar'];
        setTimeout(resolve, 100);
      }, 100)
    );
    assert.strictEqual(outputA.length, outputB.length);
  });

  test('style is used as fallback when a variant changes to not contain that style', async function (assert) {
    const variants = { a: { opacity: 1 }, b: { x: 100 } };
    const style = { opacity: 0 };
    const p = new P();
    await render(
      <template>
        <div
          id="m"
          {{motion
            animate=p.animate
            variants=variants
            transition=NO
            style=style
          }}
        ></div>
      </template>
    );
    assert.strictEqual(el().style.opacity, '0');
    // start values read from the DOM resolve a frame later in a real browser (see animate-prop port)
    p.animate = 'a';
    await settled();
    await nextFrame();
    await nextFrame();
    assert.strictEqual(el().style.opacity, '1');
    p.animate = 'b';
    await settled();
    await nextFrame();
    assert.strictEqual(el().style.opacity, '0');
  });

  test('Children correctly animate to removed values even when not rendering along with parents', async function (assert) {
    const variants = {
      visible: { x: 100, opacity: 1 },
      hidden: { opacity: 0 },
    };
    const initial = { x: 0 };
    const p = new P({ isVisible: false });
    const animate = () => (p.isVisible ? 'visible' : 'hidden');
    await render(
      <template>
        <div {{motion initial=initial animate=(animate)}}><div
            id="child"
            {{motion variants=variants transition=NO}}
          ></div></div>
      </template>
    );
    p.isVisible = true;
    await settled();
    await nextFrame();
    assert.strictEqual(el('child').style.transform, 'translateX(100px)');
    p.isVisible = false;
    await settled();
    await nextFrame();
    assert.strictEqual(el('child').style.transform, 'none');
  });

  // Not ported: "Protected keys don't persist after setActive fires" — hover/tap gesture features are not in the binding yet.

  test('child onAnimationStart triggers from parent animations', async function (assert) {
    const variants: Variants = {
      hidden: { opacity: 0, x: -100, transition: NO },
      visible: { opacity: 1, x: 100, transition: NO },
    };
    const childVariants: Variants = {
      hidden: { opacity: 0, x: -100, transition: NO },
      visible: { opacity: 1, x: 50, transition: NO },
    };
    const done = new Promise<string>((resolve) => {
      const onStart = (name: string) => resolve(name);
      void render(
        <template>
          <div {{motion animate="visible" variants=variants}}><div
              {{motion variants=childVariants onAnimationStart=onStart}}
            ></div></div>
        </template>
      );
    });
    assert.strictEqual(await done, 'visible');
  });

  test('child onAnimationComplete triggers from parent animations', async function (assert) {
    const variants: Variants = {
      hidden: { opacity: 0, x: -100, transition: NO },
      visible: { opacity: 1, x: 100, transition: NO },
    };
    const childVariants: Variants = {
      hidden: { opacity: 0, x: -100, transition: NO },
      visible: { opacity: 1, x: 50, transition: NO },
    };
    const done = new Promise<string>((resolve) => {
      const onComplete = (name: string) => resolve(name);
      void render(
        <template>
          <div {{motion animate="visible" variants=variants}}><div
              {{motion variants=childVariants onAnimationComplete=onComplete}}
            ></div></div>
        </template>
      );
    });
    assert.strictEqual(await done, 'visible');
  });

  test('changing values within an inherited variant triggers an animation', async function (assert) {
    const p = new P({ x: 0 });
    const variants = () => ({ variant: { x: p.x } });
    await render(
      <template>
        <div {{motion initial=false animate="variant"}}><div
            id="element"
            {{motion variants=(variants) transition=NO}}
          ></div></div>
      </template>
    );
    await nextFrame();
    assert.strictEqual(el('element').style.transform, 'none');
    p.x = 100;
    await settled();
    await nextFrame();
    assert.strictEqual(el('element').style.transform, 'translateX(100px)');
  });

  test('transitionEnd from instant animation does not override subsequent variant', async function (assert) {
    const variants = {
      on: { opacity: 1, transition: NO, transitionEnd: { display: 'flex' } },
      off: { opacity: 0.5, display: 'none', transition: NO },
    };
    const style = { display: 'none' };
    const p = new P({ animate: 'off' });
    await render(
      <template>
        <div
          id="target"
          {{motion
            animate=p.animate
            initial="off"
            variants=variants
            style=style
          }}
        ></div>
      </template>
    );
    await nextFrame();
    // Glimmer batches the two synchronous switches into one render, which is the same race
    // the React test provokes: the "on" transitionEnd must not land after "off"
    p.animate = 'on';
    p.animate = 'off';
    await settled();
    await nextFrame();
    await nextFrame();
    assert.strictEqual(el('target').style.display, 'none');
  });

  test('staggerChildren is calculated correctly for new children', async function (assert) {
    const variants = { enter: { transition: { delayChildren: stagger(0.1) } } };
    const cv = { enter: { opacity: 1 } };
    const ci = { opacity: 0 };
    const p = new P({ items: ['1', '2'] });
    await render(
      <template>
        <div {{motion animate="enter" variants=variants}}>{{#each
            p.items
            as |item|
          }}<div
              id={{item}}
              class="item"
              {{motion variants=cv initial=ci}}
            ></div>{{/each}}</div>
      </template>
    );
    for (let i = 0; i < 4; i++) {
      await nextFrame();
    }
    p.items = ['1', '2', '3', '4', '5'];
    await settled();
    for (let i = 0; i < 10; i++) {
      await nextFrame();
    }
    const opacities = findAll('.item').map((e) =>
      parseFloat(getComputedStyle(e).opacity)
    );
    assert.strictEqual(new Set(opacities).size, opacities.length);
  });

  test('a motion element exposes its VisualElement through visualElementStore', async function (assert) {
    // the hook the Suspense-remount tests use; the remount scenarios themselves are React-only and not ported
    await render(
      <template>
        <div id="m" {{motion animate="visible"}}></div>
      </template>
    );
    assert.ok(visualElementStore.get(el())?.animationState);
  });
});
