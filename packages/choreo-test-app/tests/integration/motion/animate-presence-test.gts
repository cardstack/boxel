/**
 * Port of Motion's packages/framer-motion/src/components/AnimatePresence/__tests__/AnimatePresence.test.tsx (motion@bbabb00).
 *   <AnimatePresence>{cond && <motion.div key=… />}</AnimatePresence>
 *     → <Presence @items={{…}} @key={{keyOf}} as |it h|><div {{motion presence=h …}} /></Presence>
 * "custom components" wrapping a motion.div become nested elements; presence reaches them
 * through the VisualElement tree as React's PresenceContext would.
 */
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render, settled, find } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { frame, motionValue, type Variants } from 'motion-dom';
import motion from 'glimmer-motion/motion';
import Presence from 'glimmer-motion/presence';
import LayoutGroup from 'glimmer-motion/layout-group';
import { nextFrame, sleep } from '../../helpers/motion';

const NO = { type: false } as const;
const keyOf = (it: { key: string }) => it.key;
const root = () => find('#root') as HTMLElement;
const el = (id = 'm') => find(`#${id}`) as HTMLElement | null;
const waitFor = async (pred: () => boolean, timeout = 1000) => { const t0 = performance.now(); while (!pred()) { if (performance.now() - t0 > timeout) throw new Error('waitFor timed out'); await sleep(16); } };

class P {
  @tracked isVisible = true;
  @tracked i = 0;
  @tracked id = 0;
  @tracked color = 'red';
  @tracked mode: 'sync' | 'wait' | 'popLayout' = 'sync';
  @tracked nums: number[] = [];
  @tracked active = 0;
  @tracked showA = true;
  @tracked showB = true;
  @tracked direction = 0;
  @tracked childOpen = true;
  constructor(p: Partial<P> = {}) { Object.assign(this, p); }
  /** {isVisible && <motion.div/>} */
  get one() { return this.isVisible ? [{ key: 'one' }] : []; }
  /** <motion.div key={i}/> */
  get keyed() { return [{ key: String(this.i), i: this.i }]; }
  get byId() { return [{ key: String(this.id), id: this.id }]; }
  get numItems() { return this.nums.map((n) => ({ key: String(n), n })); }
  get ab() { return [...(this.showA ? [{ key: 'a' }] : []), ...(this.showB ? [{ key: 'b' }] : [])]; }
}

module('Integration | motion | AnimatePresence', function (hooks) {
  setupRenderingTest(hooks);

  test('Allows initial animation if no `initial` prop defined', async function (assert) {
    const x = motionValue(0);
    const animate = { x: 100 }, style = { x }, exit = { x: 0 };
    const items = [{ key: 'one' }];
    const seen = await new Promise<number>((resolve) => {
      const onStart = () => frame.postRender(() => frame.postRender(() => resolve(x.get())));
      void render(<template><Presence @items={{items}} @key={{keyOf}} as |it h|><div {{motion presence=h animate=animate style=style exit=exit onAnimationStart=onStart}}></div></Presence></template>);
    });
    assert.notStrictEqual(seen, 0);
    assert.notStrictEqual(seen, 100);
  });

  test('Suppresses initial animation if `initial={false}`', async function (assert) {
    const initial = { x: 0 }, animate = { x: 100 }, exit = { opacity: 0 };
    const items = [{ key: 'one' }];
    await render(<template><Presence @items={{items}} @key={{keyOf}} @initial={{false}} as |it h|><div id="m" {{motion presence=h initial=initial animate=animate exit=exit}}></div></Presence></template>);
    await sleep(50);
    assert.strictEqual(el()!.style.transform, 'translateX(100px)');
  });

  test('Normal rerenders work as expected', async function (assert) {
    const p = new P({ color: 'red' });
    const items = [{ key: 'one' }];
    await render(<template><Presence @items={{items}} @key={{keyOf}} as |it h|><div id="m" style="background-color: {{p.color}}"></div></Presence></template>);
    p.color = 'green'; await settled();
    assert.strictEqual(getComputedStyle(el()!).backgroundColor, 'rgb(0, 128, 0)');
  });

  test('Animates out a component when its removed', async function (assert) {
    const opacity = motionValue(1);
    const exit = { opacity: 0 }, t = { duration: 0.1 }, style = { opacity };
    const p = new P({ isVisible: true });
    await render(<template><div id="root"><Presence @items={{p.one}} @key={{keyOf}} as |it h|><div {{motion presence=h exit=exit transition=t style=style}}></div></Presence></div></template>);
    p.isVisible = false; await settled();
    await new Promise<void>((resolve) => {
      setTimeout(() => { assert.notStrictEqual(opacity.get(), 1); assert.notStrictEqual(opacity.get(), 0); }, 50);
      setTimeout(resolve, 150);
    });
    await settled();
    assert.strictEqual(root().childElementCount, 0);
  });

  test('Allows nested exit animations', async function (assert) {
    const opacity = motionValue(0);
    const exitX = { x: 100 }, animate = { opacity: 0.9 }, style = { opacity }, exitO = { opacity: 0.1 };
    const p = new P({ isVisible: true });
    await render(<template><Presence @items={{p.one}} @key={{keyOf}} as |it h|><div {{motion presence=h exit=exitX}}><div {{motion animate=animate style=style exit=exitO transition=NO}}></div></div></Presence></template>);
    await nextFrame();
    assert.strictEqual(opacity.get(), 0.9);
    p.isVisible = false; await settled();
    await nextFrame();
    assert.strictEqual(opacity.get(), 0.1);
  });

  test('when: afterChildren fires correctly', async function (assert) {
    const parentOpacityOutput: unknown[] = [];
    const variants = { visible: { opacity: 1 }, hidden: { opacity: 0 } };
    const t = { duration: 0.2, when: 'afterChildren' as const };
    const p = new P({ isVisible: true });
    const count = await new Promise<number>((resolve) => {
      const onUpdate = (v: unknown) => parentOpacityOutput.push(v);
      const onComplete = () => resolve(parentOpacityOutput.length);
      void (async () => {
        await render(<template><Presence @items={{p.one}} @key={{keyOf}} as |it h|><div {{motion presence=h initial=false animate="visible" exit="hidden" transition=t variants=variants onUpdate=onUpdate onAnimationComplete=onComplete}}><div {{motion variants=variants transition=NO}}></div></div></Presence></template>);
        await nextFrame(); await nextFrame();
        p.isVisible = false;
      })();
    });
    assert.true(count > 1);
  });

  test("Animates a component back in if it's re-added before animating out", async function (assert) {
    const animate = { opacity: 1 }, exit = { opacity: 0 }, t = { duration: 0.1 };
    const p = new P({ isVisible: true });
    await render(<template><Presence @items={{p.one}} @key={{keyOf}} as |it h|><div id="m" {{motion presence=h animate=animate exit=exit transition=t}}></div></Presence></template>);
    await sleep(50);
    p.isVisible = false; await settled();
    await sleep(50);
    p.isVisible = true; await settled();
    await sleep(150);
    assert.strictEqual(el()!.style.opacity, '1');
  });

  test('Animates a component out after having an animation cancelled', async function (assert) {
    const opacity = motionValue(1);
    const exit = { opacity: 0 }, t = { duration: 0.1 }, style = { opacity };
    const p = new P({ isVisible: true });
    await render(<template><div id="root"><Presence @items={{p.one}} @key={{keyOf}} as |it h|><div {{motion presence=h exit=exit transition=t style=style}}></div></Presence></div></template>);
    p.isVisible = false; await settled();
    p.isVisible = true; await settled();
    p.isVisible = false; await settled();
    await new Promise<void>((resolve) => {
      setTimeout(() => { assert.notStrictEqual(opacity.get(), 1); assert.notStrictEqual(opacity.get(), 0); }, 50);
      setTimeout(resolve, 300);
    });
    await settled();
    assert.strictEqual(root().childElementCount, 0);
  });

  test('Removes a child with no animations', async function (assert) {
    const p = new P({ isVisible: true });
    await render(<template><div id="root"><Presence @items={{p.one}} @key={{keyOf}} as |it h|><div></div></Presence></div></template>);
    p.isVisible = false; await settled();
    assert.strictEqual(root().childElementCount, 0);
  });

  test('Can cycle through multiple components', async function (assert) {
    const animate = { opacity: 1 }, exit = { opacity: 0 }, t = { duration: 0.5 };
    const p = new P({ i: 0 });
    await render(<template><div id="root"><Presence @items={{p.keyed}} @key={{keyOf}} as |it h|><div {{motion presence=h animate=animate exit=exit transition=t}}></div></Presence></div></template>);
    await sleep(50); p.i = 1; await settled();
    await sleep(350); p.i = 2; await settled();
    assert.strictEqual(root().childElementCount, 3);
  });

  test("Only renders one child at a time if mode === 'wait'", async function (assert) {
    const animate = { opacity: 1 }, exit = { opacity: 0 }, t = { duration: 0.1 };
    const p = new P({ i: 0 });
    await render(<template><div id="root"><Presence @items={{p.keyed}} @key={{keyOf}} @mode="wait" as |it h|><div {{motion presence=h animate=animate exit=exit transition=t}}></div></Presence></div></template>);
    await sleep(50); p.i = 1; await settled();
    await sleep(150); p.i = 2; await settled();
    assert.strictEqual(root().childElementCount, 1);
  });

  test('Immediately remove child if no exit animations defined', async function (assert) {
    const animate = { opacity: 1 }, t = { duration: 0.5 };
    const p = new P({ i: 0 });
    await render(<template><Presence @items={{p.keyed}} @key={{keyOf}} @mode="wait" as |it h|><div id="m{{it.i}}" {{motion presence=h animate=animate transition=t}}></div></Presence></template>);
    await sleep(50); p.i = 1; await settled();
    await sleep(100); p.i = 2; await settled();
    assert.ok(el('m2'));
  });

  test('Fast animations with wait render the child content correctly', async function (assert) {
    const animate = { opacity: 1 }, exit = { opacity: 0 }, t = { duration: 0.1 };
    const p = new P({ i: 0 });
    await render(<template><Presence @items={{p.keyed}} @key={{keyOf}} @mode="wait" as |it h|><div id="m{{it.i}}" {{motion presence=h initial=false exit=exit animate=animate transition=t}}>{{it.i}}</div></Presence></template>);
    await sleep(50); p.i = 1; await settled();
    await sleep(50); p.i = 2; await settled();
    await sleep(250);
    assert.strictEqual(el('m2')?.textContent, '2');
  });

  test('Fast animations with wait render the child content correctly (polling)', async function (assert) {
    const animate = { opacity: 1 }, exit = { opacity: 0 }, t = { duration: 0.1 };
    const p = new P({ i: 0 });
    await render(<template><Presence @items={{p.keyed}} @key={{keyOf}} @mode="wait" as |it h|><div id="m{{it.i}}" {{motion presence=h exit=exit animate=animate transition=t}}>{{it.i}}</div></Presence></template>);
    await sleep(50); p.i = 1; await settled();
    await sleep(150); p.i = 2; await settled();
    await waitFor(() => el('m2')?.textContent === '2');
    assert.ok(true);
  });

  test('Elements exit in sequence during fast renders', async function (assert) {
    const exit = { opacity: 0 }, animate = { opacity: 1 }, t = { duration: 0.01 };
    const p = new P({ nums: [0, 1, 2, 3] });
    await render(<template><div id="root"><Presence @items={{p.numItems}} @key={{keyOf}} as |it h|><div class="n" {{motion presence=h exit=exit animate=animate transition=t}}>{{it.n}}</div></Presence></div></template>);
    const texts = () => Array.from(root().querySelectorAll('.n')).map((e) => parseInt(e.textContent ?? ''));
    await sleep(100); p.nums = [1, 2, 3]; await settled(); await sleep(100);
    assert.deepEqual(texts(), [1, 2, 3]);
    await sleep(50); p.nums = [2, 3]; await settled(); await sleep(100);
    assert.deepEqual(texts(), [2, 3]);
    await sleep(50); p.nums = [3]; await settled(); await sleep(100);
    assert.deepEqual(texts(), [3]);
  });

  test('Exit variants are triggered with `AnimatePresence.custom`, not that of the element.', async function (assert) {
    const variants: Variants = { enter: { x: 0, transition: NO }, exit: (i: number) => ({ x: i * 100, transition: NO }) };
    const x = motionValue(0);
    const style = { x };
    const p = new P({ isVisible: true });
    await render(<template><Presence @items={{p.one}} @key={{keyOf}} @custom={{2}} as |it h|><div {{motion presence=h custom=1 variants=variants initial="exit" animate="enter" exit="exit" style=style}}></div></Presence></template>);
    p.isVisible = false; await settled();
    await nextFrame();
    assert.strictEqual(x.get(), 200);
  });

  test('Exit propagates through variants', async function (assert) {
    const variants: Variants = { enter: { opacity: 1, transition: NO }, exit: { opacity: 0, transition: NO } };
    const opacity = motionValue(1);
    const style = { opacity };
    const p = new P({ isVisible: true });
    await render(<template><Presence @items={{p.one}} @key={{keyOf}} as |it h|><div {{motion presence=h initial="enter" animate="enter" exit="exit" variants=variants}}><div {{motion variants=variants}}><div {{motion variants=variants style=style}}></div></div></div></Presence></template>);
    p.isVisible = false; await settled();
    await nextFrame();
    assert.strictEqual(opacity.get(), 0);
  });

  test('Handles external refs on a single child', async function (assert) {
    const initial = { opacity: 0 }, animate = { opacity: 1 }, exit = { opacity: 0 };
    const p = new P({ id: 0 });
    await render(<template><Presence @items={{p.byId}} @key={{keyOf}} @initial={{false}} as |it h|><div class="ref" data-id="{{it.id}}" {{motion presence=h initial=initial animate=animate exit=exit}}></div></Presence></template>);
    await sleep(30);
    p.id = 1; await settled();
    p.id = 2; await settled();
    const refs = Array.from(document.querySelectorAll('.ref'));
    assert.strictEqual(refs[refs.length - 1]?.getAttribute('data-id'), '2');
  });

  test("popLayout mode with anchorY='bottom' preserves bottom positioning", async function (assert) {
    const exit = { opacity: 0 }, t = { duration: 0.5 };
    const p = new P({ isVisible: true });
    await render(<template><div style="position:relative;height:200px;width:200px"><Presence @items={{p.one}} @key={{keyOf}} @mode="popLayout" @anchorY="bottom" as |it h|><div id="m" style="position:absolute;bottom:0;width:50px;height:50px" {{motion presence=h exit=exit transition=t}}></div></Presence></div></template>);
    await nextFrame();
    const m = el()!;
    const initialBottom = m.parentElement!.offsetHeight - m.offsetTop - m.offsetHeight;
    p.isVisible = false; await settled();
    await nextFrame();
    assert.strictEqual(getComputedStyle(m).position, 'absolute');
    assert.true(initialBottom <= 1);
  });

  for (const [from, to] of [['wait', 'popLayout'], ['popLayout', 'wait']] as const) {
    test(`Switching mode from ${from} to ${to} doesn't break animations`, async function (assert) {
      const opacity = motionValue(0);
      const animate = { opacity: 1 }, style = { opacity };
      const items = [{ key: 'stable' }];
      const p = new P({ mode: from });
      await render(<template><Presence @items={{items}} @key={{keyOf}} @mode={{p.mode}} as |it h|><div {{motion presence=h animate=animate transition=NO style=style}}></div></Presence></template>);
      await nextFrame();
      assert.strictEqual(opacity.get(), 1);
      p.mode = to; await settled(); await nextFrame();
      assert.strictEqual(opacity.get(), 1);
    });
  }
});

module('Integration | motion | AnimatePresence with custom components', function (hooks) {
  setupRenderingTest(hooks);

  test('Does nothing on initial render by default', async function (assert) {
    const x = motionValue(0);
    const animate = { x: 100 }, style = { x }, exit = { x: 0 };
    const items = [{ key: 'one' }];
    // the "custom component": a wrapper element around the motion element
    await render(<template><Presence @items={{items}} @key={{keyOf}} as |it h|><div><div {{motion presence=h animate=animate style=style exit=exit}}></div></div></Presence></template>);
    await sleep(75);
    assert.notStrictEqual(x.get(), 0);
    assert.notStrictEqual(x.get(), 100);
  });

  test('Suppresses initial animation if `initial={false}`', async function (assert) {
    const initial = { x: 0 }, animate = { x: 100 }, exit = { x: 0 };
    const items = [{ key: 'one' }];
    await render(<template><Presence @items={{items}} @key={{keyOf}} @initial={{false}} as |it h|><div><div id="m" {{motion presence=h initial=initial animate=animate exit=exit}}></div></div></Presence></template>);
    await sleep(50);
    assert.strictEqual(el()!.style.transform, 'translateX(100px)');
  });

  // Not ported: "Animation controls children of initial={false} don't throw" — useAnimation()/MotionConfig isStatic are React hooks.

  test('Animates out a component when its removed', async function (assert) {
    const opacity = motionValue(1);
    const exit = { opacity: 0 }, t = { duration: 0.1 }, style = { opacity };
    const p = new P({ isVisible: true });
    await render(<template><div id="root"><Presence @items={{p.one}} @key={{keyOf}} as |it h|><div><div {{motion presence=h exit=exit transition=t style=style}}></div></div></Presence></div></template>);
    p.isVisible = false; await settled();
    await new Promise<void>((resolve) => {
      setTimeout(() => { assert.notStrictEqual(opacity.get(), 1); assert.notStrictEqual(opacity.get(), 0); }, 50);
      setTimeout(resolve, 150);
    });
    await settled();
    assert.strictEqual(root().childElementCount, 0);
  });

  test('Can cycle through multiple components', async function (assert) {
    const animate = { opacity: 1 }, exit = { opacity: 0 }, t = { duration: 1 };
    const p = new P({ i: 0 });
    await render(<template><div id="root"><Presence @items={{p.keyed}} @key={{keyOf}} as |it h|><div><div {{motion presence=h animate=animate exit=exit transition=t}}></div></div></Presence></div></template>);
    await sleep(50); p.i = 1; await settled();
    await sleep(150); p.i = 2; await settled();
    await sleep(550);
    assert.strictEqual(root().childElementCount, 3);
  });

  test('Exit variants are triggered with `AnimatePresence.custom`, not that of the element.', async function (assert) {
    const variants: Variants = { enter: { x: 0, transition: NO }, exit: (i: number) => ({ x: i * 100, transition: NO }) };
    const x = motionValue(0);
    const style = { x };
    const p = new P({ isVisible: true });
    await render(<template><Presence @items={{p.one}} @key={{keyOf}} @custom={{2}} as |it h|><div><div {{motion presence=h custom=1 variants=variants initial="exit" animate="enter" exit="exit" style=style}}></div></div></Presence></template>);
    p.isVisible = false; await settled();
    await nextFrame();
    assert.strictEqual(x.get(), 200);
  });

  test('Exit variants are triggered with `AnimatePresence.custom` throughout the tree', async function (assert) {
    const variants: Variants = { enter: { x: 0, transition: NO }, exit: (i: number) => ({ x: i * 100, transition: NO }) };
    const xParent = motionValue(0), xChild = motionValue(0);
    const sp = { x: xParent }, sc = { x: xChild };
    const p = new P({ isVisible: true });
    await render(<template><Presence @items={{p.one}} @key={{keyOf}} @custom={{2}} as |it h|><div {{motion presence=h custom=1 variants=variants style=sp initial="exit" animate="enter" exit="exit"}}><div {{motion custom=1 variants=variants style=sc}}></div></div></Presence></template>);
    await nextFrame();
    p.isVisible = false; await settled();
    await nextFrame();
    assert.deepEqual([xParent.get(), xChild.get()], [200, 200]);
  });

  test('Exit propagates through variants', async function (assert) {
    const variants: Variants = { enter: { opacity: 1, transition: NO }, exit: { opacity: 0, transition: NO } };
    const opacity = motionValue(1);
    const style = { opacity };
    const p = new P({ isVisible: true });
    await render(<template><Presence @items={{p.one}} @key={{keyOf}} as |it h|><div {{motion presence=h initial="enter" animate="enter" exit="exit" variants=variants}}><div {{motion variants=variants}}><div {{motion variants=variants style=style}}></div></div></div></Presence></template>);
    p.isVisible = false; await settled();
    await nextFrame();
    assert.strictEqual(opacity.get(), 0);
  });

  test('Sibling AnimatePresence wrapped in LayoutGroup remove exiting elements', async function (assert) {
    const opacityA = motionValue(1), opacityB = motionValue(1);
    const exit = { opacity: 0 };
    const sa = { opacity: opacityA }, sb = { opacity: opacityB };
    const p = new P({ isVisible: true });
    await render(<template><LayoutGroup><Presence @items={{p.one}} @key={{keyOf}} as |it h|><div id="a" {{motion presence=h exit=exit transition=NO style=sa}}></div></Presence><Presence @items={{p.one}} @key={{keyOf}} as |it h|><div id="b" {{motion presence=h exit=exit transition=NO style=sb}}></div></Presence></LayoutGroup></template>);
    p.isVisible = false; await settled();
    await nextFrame();
    await sleep(50);
    await settled();
    assert.strictEqual(opacityA.get(), 0);
    assert.strictEqual(opacityB.get(), 0);
    assert.strictEqual(el('a'), null);
    assert.strictEqual(el('b'), null);
  });

  test('AnimatePresence - nested AnimatePresence should not animate exit', async function (assert) {
    const outerOpacity = motionValue(1), innerOpacity = motionValue(1);
    const exit = { opacity: 0 }, t = { duration: 0.1 };
    const so = { opacity: outerOpacity }, si = { opacity: innerOpacity };
    const inner = [{ key: 'inner' }];
    const p = new P({ isVisible: true });
    await new Promise<void>((resolve) => {
      const complete = async () => {
        await nextFrame(); await nextFrame(); await settled();
        assert.strictEqual(outerOpacity.get(), 0);
        assert.strictEqual(innerOpacity.get(), 1);
        assert.strictEqual(el('outer'), null);
        assert.strictEqual(el('inner'), null);
        resolve();
      };
      void (async () => {
        await render(<template><Presence @items={{p.one}} @key={{keyOf}} @onExitComplete={{complete}} as |it h|><div id="outer" {{motion presence=h exit=exit transition=t style=so}}><Presence @items={{inner}} @key={{keyOf}} as |it2 h2|><div id="inner" {{motion presence=h2 exit=exit transition=t style=si}}></div></Presence></div></Presence></template>);
        p.isVisible = false;
      })();
    });
  });

  test('AnimatePresence - nested AnimatePresence should animate exit when propagate is true', async function (assert) {
    const outerOpacity = motionValue(1), innerOpacity = motionValue(1);
    const exit = { opacity: 0 }, t = { duration: 0.1 };
    const so = { opacity: outerOpacity }, si = { opacity: innerOpacity };
    const inner = [{ key: 'inner' }];
    const p = new P({ isVisible: true });
    await new Promise<void>((resolve) => {
      const complete = async () => {
        await nextFrame(); await nextFrame(); await settled();
        assert.strictEqual(outerOpacity.get(), 0);
        assert.strictEqual(innerOpacity.get(), 0);
        assert.strictEqual(el('outer'), null);
        assert.strictEqual(el('inner'), null);
        resolve();
      };
      void (async () => {
        await render(<template><Presence @items={{p.one}} @key={{keyOf}} @onExitComplete={{complete}} as |it h|><div id="outer" {{motion presence=h exit=exit transition=t style=so}}><Presence @items={{inner}} @key={{keyOf}} @propagate={{true}} @parent={{h}} as |it2 h2|><div id="inner" {{motion presence=h2 exit=exit transition=t style=si}}></div></Presence></div></Presence></template>);
        p.isVisible = false;
      })();
    });
  });

  const dynamicVariants: Variants = {
    enter: (custom: string) => ({ ...(custom === 'fade' ? { opacity: 0 } : { x: -100 }), transition: { duration: 0.1 } }),
    center: { opacity: 1, x: 0, transition: { duration: 0.1 } },
    exit: (custom: string) => ({ ...(custom === 'fade' ? { opacity: 0 } : { x: 100 }), transition: { duration: 0.1 } }),
  };
  const dynItems = [{ id: 'a', transition: 'fade' }, { id: 'b', transition: 'slide' }, { id: 'c', transition: 'fade' }, { id: 'd', transition: 'slide' }];

  test('Removes exiting children during rapid key switches with dynamic custom variants', async function (assert) {
    const p = new P({ active: 0 });
    const items = () => { const it = dynItems[p.active]!; return [{ key: it.id, transition: it.transition }]; };
    const custom = () => dynItems[p.active]!.transition;
    await render(<template><div id="root"><Presence @items={{(items)}} @key={{keyOf}} @custom={{(custom)}} as |it h|><div {{motion presence=h variants=dynamicVariants initial="enter" animate="center" exit="exit" custom=it.transition}}></div></Presence></div></template>);
    p.active = 1; await settled();
    p.active = 2; await settled();
    p.active = 3; await settled();
    await sleep(500); await nextFrame(); await nextFrame(); await settled();
    assert.strictEqual(root().childElementCount, 1);
  });

  test('Fires onExitComplete during rapid key switches with dynamic custom variants', async function (assert) {
    let exitCompleteCount = 0;
    const onExitComplete = () => { exitCompleteCount++; };
    const p = new P({ active: 0 });
    const items = () => { const it = dynItems[p.active]!; return [{ key: it.id, transition: it.transition }]; };
    const custom = () => dynItems[p.active]!.transition;
    await render(<template><Presence @items={{(items)}} @key={{keyOf}} @custom={{(custom)}} @onExitComplete={{onExitComplete}} as |it h|><div {{motion presence=h variants=dynamicVariants initial="enter" animate="center" exit="exit" custom=it.transition}}></div></Presence></template>);
    p.active = 1; await settled();
    p.active = 2; await settled();
    p.active = 3; await settled();
    await sleep(500); await nextFrame(); await nextFrame();
    assert.true(exitCompleteCount > 0);
  });

  test('Re-entering child replays enter animation when exit was complete', async function (assert) {
    const enterCustomValues: number[] = [];
    const variants: Variants = {
      enter: (direction: number) => { enterCustomValues.push(direction); return { x: direction > 0 ? 1000 : -1000, opacity: 0 }; },
      center: { x: 0, opacity: 1 },
      exit: (direction: number) => ({ x: direction < 0 ? 1000 : -1000, opacity: 0 }),
    };
    const slow = { duration: 10 };
    const p = new P({ showA: true, showB: true, direction: 0 });
    const tFor = (key: string) => (key === 'a' ? slow : NO);
    await render(<template><Presence @items={{p.ab}} @key={{keyOf}} @initial={{false}} @custom={{p.direction}} as |it h|><div {{motion presence=h custom=p.direction variants=variants initial="enter" animate="center" exit="exit" transition=(tFor it.key)}}></div></Presence></template>);
    await nextFrame();
    // Remove both: a exits slowly (10s), b exits instantly
    p.direction = -1; p.showA = false; p.showB = false; await settled();
    await nextFrame();
    // b's exit completed, a's is still running: both stay. Re-add b — a genuine re-entry.
    enterCustomValues.length = 0;
    p.direction = 1; p.showB = true; await settled();
    await nextFrame();
    assert.true(enterCustomValues.includes(1));
  });

  test('Re-entering child with object-form initial resets to initial values when exit was complete', async function (assert) {
    const opacity = motionValue(1);
    const opacityChanges: number[] = [];
    opacity.on('change', (v) => opacityChanges.push(v));
    const ai = { x: 0 }, aa = { x: 100 }, ae = { x: -100 }, slow = { duration: 10 };
    const bi = { opacity: 0.5 }, ba = { opacity: 1 }, be = { opacity: 0 }, bs = { opacity };
    const p = new P({ showA: true, showB: true });
    await render(<template><Presence @items={{p.ab}} @key={{keyOf}} as |it h|>{{#if (eq it.key "a")}}<div {{motion presence=h initial=ai animate=aa exit=ae transition=slow}}></div>{{else}}<div {{motion presence=h initial=bi animate=ba exit=be style=bs transition=NO}}></div>{{/if}}</Presence></template>);
    await nextFrame();
    p.showA = false; p.showB = false; await settled();
    await nextFrame();
    assert.strictEqual(opacity.get(), 0);
    opacityChanges.length = 0;
    p.showB = true; await settled();
    await nextFrame();
    assert.true(opacityChanges.length > 0);
    assert.strictEqual(opacityChanges[0], 0.5);
  });

  test("Does not get stuck when state changes cause rapid key alternation in mode='wait'", async function (assert) {
    // #3141 without React effects: the key flips loading-N → document-N four times in quick succession
    const initial = { opacity: 0 }, animate = { opacity: 1 }, exit = { opacity: 0 }, t = { duration: 0.1 };
    const p = new P({ i: 0 });
    const items = () => [{ key: `document-${p.i}` }];
    await render(<template><Presence @items={{(items)}} @key={{keyOf}} @mode="wait" as |it h|><div id="content" {{motion presence=h initial=initial animate=animate exit=exit transition=t}}>{{it.key}}</div></Presence></template>);
    for (let n = 1; n <= 4; n++) { p.i = n; await settled(); }
    await sleep(1000); await nextFrame(); await nextFrame(); await settled();
    assert.true(el('content')!.textContent!.includes('document-4'));
  });

  test("Shows latest child after rapid key switches in mode='wait'", async function (assert) {
    const initial = { opacity: 0 }, animate = { opacity: 1 }, exit = { opacity: 0 }, t = { duration: 0.1 };
    const p = new P({ i: 0 });
    await render(<template><div id="root"><Presence @items={{p.keyed}} @key={{keyOf}} @mode="wait" as |it h|><div id="content" {{motion presence=h initial=initial animate=animate exit=exit transition=t}}>{{it.i}}</div></Presence></div></template>);
    p.i = 1; await settled();
    p.i = 2; await settled();
    p.i = 3; await settled();
    await sleep(500); await nextFrame(); await nextFrame(); await settled();
    assert.strictEqual(root().childElementCount, 1);
    assert.strictEqual(el('content')!.textContent, '3');
  });

  test('Removes child when nested variant children have exit matching current values', async function (assert) {
    const mi = { opacity: 0 }, ma = { opacity: 1 }, me = { opacity: 0 };
    const ulv = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };
    const liv = { hidden: { opacity: 0, scale: 0.5 }, visible: { opacity: 1, scale: 1 } };
    const lie = { opacity: 1, scale: 1, transition: { duration: 100 } };
    const p = new P({ isVisible: true });
    await render(<template><div id="root"><Presence @items={{p.one}} @key={{keyOf}} @mode="wait" as |it h|><div {{motion presence=h initial=mi animate=ma exit=me transition=NO}}><ul {{motion initial="hidden" animate="visible" variants=ulv}}><li {{motion variants=liv exit=lie transition=NO}}></li><li {{motion variants=liv exit=lie transition=NO}}></li></ul></div></Presence></div></template>);
    await sleep(200);
    assert.strictEqual(root().childElementCount, 1);
    p.isVisible = false; await settled();
    await sleep(500); await nextFrame(); await nextFrame(); await settled();
    assert.strictEqual(root().childElementCount, 0);
  });

  test('Removes child when motion components inside unmount during exit (#3243)', async function (assert) {
    const exit = { opacity: 0 }, slow = { duration: 10 };
    const p = new P({ isVisible: true, childOpen: true });
    await render(<template><div id="root"><Presence @items={{p.one}} @key={{keyOf}} as |it h|>{{#if p.childOpen}}<div id="motion" {{motion presence=h exit=exit transition=slow}}></div>{{else}}<div id="closed">closed</div>{{/if}}</Presence></div></template>);
    p.isVisible = false; await settled();
    p.childOpen = false; await settled();
    await nextFrame(); await nextFrame(); await settled();
    assert.strictEqual(root().childElementCount, 0);
  });
});

function eq(a: unknown, b: unknown) { return a === b; }
