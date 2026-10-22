/**
 * glimmer-motion/test-support — how a test waits for motion.
 *
 *   import { setupMotion, animationsSettled, bounds } from 'glimmer-motion/test-support';
 *
 *   module('…', function (hooks) {
 *     setupRenderingTest(hooks);
 *     setupMotion(hooks);
 *
 *     test('…', async function (assert) {
 *       await render(<template>…</template>);
 *       await click('.open');
 *       await animationsSettled();
 *       assert.deepEqual(bounds(find('.card')), { top: 0, left: 0, … });
 *     });
 *   });
 *
 * Two things earn this module its keep, and they are both Ember Animated's
 * lessons rather than Motion's:
 *
 *   `animationsSettled()` replaces `sleep(200)`. A sleep encodes a duration
 *   the test does not own — change a spring and every sleep in the suite is
 *   either flaky or slow, and you cannot tell which until CI is red on a
 *   different machine.
 *
 *   `bounds()` is relative to `#ember-testing`, not the viewport. QUnit moves
 *   its container around (and scales it, unless a fixture pins it), so a raw
 *   getBoundingClientRect() answers a different question depending on how many
 *   tests have run. Every assertion about position should go through
 *   this.
 *
 * `animationsSettled()` is explicit rather than an `@ember/test-waiters` waiter
 * hooked into `settled()`. A blocking waiter is the tidier-looking option and
 * the wrong one: the interruption suite's whole method is to click again while
 * something is still in flight, and a waiter would silently turn each of those
 * into a wait-for-completion. The tests would go green by no longer testing
 * anything. See src/activity.ts.
 */
import { settled } from '@ember/test-helpers';
import { frame } from 'motion-dom';
import { rootProjectionNode } from 'motion-dom';

import { isMotionIdle, whatIsBusy } from '../activity.ts';
import { layoutLoopDetected, resetLayoutLoopGuard } from '../layout.ts';
import { setMotionSpeed } from '../speed.ts';

export { isMotionIdle, whatIsBusy } from '../activity.ts';

const nextFrame = () =>
  new Promise<void>((resolve) => frame.postRender(() => resolve()));

/** the box QUnit renders the test into; every measurement here is relative to it */
const container = (): DOMRect =>
  (
    document.querySelector('#ember-testing') ?? document.body
  ).getBoundingClientRect();

export interface Box {
  height: number;
  left: number;
  top: number;
  width: number;
}

/**
 * getBoundingClientRect(), relative to `#ember-testing`.
 *
 * Ember Animated's `bounds()`, and for the same reason: the container is not
 * at the page origin and QUnit is free to move it.
 */
export function bounds(element: Element): Box {
  const r = element.getBoundingClientRect();
  const root = container();
  return {
    height: r.height,
    left: r.left - root.left,
    top: r.top - root.top,
    width: r.width,
  };
}

/**
 * The linear part of every transform between this element and the document —
 * a 2×2 matrix, which is the element's shape.
 *
 * A layout animation distorts by scale, and a scale a parent applied is
 * invisible in the child's own `style.transform`. This is what a test asserts
 * on when the question is "did the label get stretched", which no amount of
 * reading `x` will answer.
 */
export function shape(element: Element): {
  a: number;
  b: number;
  c: number;
  d: number;
} {
  let m = new DOMMatrix();
  let el: Element | null = element;
  while (el) {
    const t = getComputedStyle(el).transform;
    if (t && t !== 'none') {
      m = new DOMMatrix(t).multiply(m);
    }
    el = el.parentElement;
  }
  return { a: m.a, b: m.b, c: m.c, d: m.d };
}

export function boundsAndShape(
  element: Element,
): Box & ReturnType<typeof shape> {
  return { ...shape(element), ...bounds(element) };
}

export interface SettleOptions {
  /** give up after this long and report what was still moving (default 5000) */
  timeout?: number;
}

/**
 * Resolve when every motion element, layout animation and <Choreo> timeline in
 * the document has stopped.
 *
 * Idle is required on two consecutive checks, not one. A value clears its
 * animation in a microtask after it resolves, and a Choreo row that ends
 * commonly unmounts a leaver — which is a render, which is another pass. One
 * check would catch the gap between those and call it settled.
 */
export async function animationsSettled({
  timeout = 5000,
}: SettleOptions = {}): Promise<void> {
  const start = performance.now();
  let idle = 0;
  for (;;) {
    await settled();
    idle = isMotionIdle() ? idle + 1 : 0;
    if (idle >= 2) {
      return;
    }
    if (performance.now() - start > timeout) {
      throw new Error(
        `animationsSettled() timed out after ${timeout}ms. Still moving: ${
          whatIsBusy().join('; ') || '(nothing — a probe is lying)'
        }`,
      );
    }
    await nextFrame();
  }
}

/* ---- measuring motion ---- */

/** how fast an element is moving, in px/s, sampled across two frames */
export async function velocityOf(
  el: HTMLElement,
): Promise<{ x: number; y: number }> {
  const a = el.getBoundingClientRect();
  const t0 = performance.now();
  await nextFrame();
  await nextFrame();
  const b = el.getBoundingClientRect();
  const dt = (performance.now() - t0) / 1000;
  return dt > 0
    ? { x: (b.left - a.left) / dt, y: (b.top - a.top) / dt }
    : { x: 0, y: 0 };
}

/* ---- setup ---- */

/**
 * Reset the state that outlives an owner.
 *
 * The projection root, the layout-loop guard and the speed dial are one per
 * document by design. That is right for an app and a leak between tests: a root
 * left blocked by one test makes the next test's layout animations snap.
 *
 * Every reset added with `registerMotionReset()` runs here too, so a layer
 * built on glimmer-motion that keeps document-wide state of its own is cleared
 * by the same call.
 */
export function setupMotion(hooks: {
  afterEach(fn: (assert?: LoopAssert) => void): void;
  beforeEach(fn: () => void): void;
}) {
  hooks.beforeEach(function () {
    resetMotion();
  });
  hooks.afterEach(function (assert?: LoopAssert) {
    // Read BEFORE the reset, and reported rather than thrown: a layout loop is
    // always a bug, and a test that hits one otherwise ends as a runner
    // timeout — no stack, no assertion, no clue which test it was. The engine
    // keeps the page alive by deferring settles to animation frames; this is
    // what makes the suite say so out loud.
    const looped = layoutLoopDetected();
    resetMotion();
    if (looped) {
      assert?.ok?.(
        false,
        'glimmer-motion: a layout loop ran during this test — settles kept ' +
          'coming with no animation frame between them. Something re-renders a ' +
          'motion element in a loop; the usual cause is a @tracked property ' +
          'assigned unconditionally from a per-frame callback (onDrag, onScroll). ' +
          'Assign only on change.',
      );
    }
  });
}

/** the sliver of QUnit's assert this module uses, so test-support needs no QUnit types */
interface LoopAssert {
  ok?: (state: boolean, message?: string) => void;
}

const resets = new Set<() => void>();

/**
 * Add a reset that `resetMotion()` runs after glimmer-motion's own.
 *
 * For a layer that keeps per-document state — a registry, a barrier, a
 * gesture table — that would otherwise leak from one test into the next. Adding
 * the same function twice adds it once. Resets run in the order they were
 * first added. The returned function removes it.
 */
export function registerMotionReset(reset: () => void): () => void {
  resets.add(reset);
  return () => {
    resets.delete(reset);
  };
}

export function resetMotion() {
  setMotionSpeed(1);
  resetLayoutLoopGuard();
  unblockLayout();
  for (const reset of resets) {
    reset();
  }
}

/**
 * Clear a layout block left behind by the test that ran before this one.
 *
 * `instantLayoutTransition()` blocks the ROOT projection node — one global — so
 * that the next projection update lands without animating. It is cleared by
 * that update. A test that blocks and then ends before the update happens
 * leaves the block in place, and the next test's layout animations silently
 * snap instead of running. That is a test failing because of its neighbour,
 * which is the worst kind, and the demo that uses instantLayoutTransition is
 * exactly the one whose test needs layout animations to work.
 */
function unblockLayout() {
  const root = rootProjectionNode.current as
    | { unblockUpdate?: () => void }
    | undefined;
  root?.unblockUpdate?.();
}
