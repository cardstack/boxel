/**
 * @cardstack/choreo/test-support — how a test drives and checks <Choreo>.
 *
 *   import { animationsSettled } from 'glimmer-motion/test-support';
 *   import { live, orphanCount, setupChoreo } from '@cardstack/choreo/test-support';
 *
 *   module('…', function (hooks) {
 *     setupRenderingTest(hooks);
 *     setupChoreo(hooks);
 *
 *     test('…', async function (assert) {
 *       await render(<template>…</template>);
 *       await click(live('.open')!);
 *       await animationsSettled();
 *       assert.strictEqual(orphanCount(), 0);
 *     });
 *   });
 *
 * `setupChoreo()` is the one setup call a Choreo suite makes. It is
 * `setupMotion()`, and Choreo's document-wide state — the beacon registry, the
 * far-match barrier, the gesture samples — is reset alongside glimmer-motion's
 * own, because loading this module adds those resets to `resetMotion()`.
 *
 * They are document-wide by design: a beacon in the chrome has to be visible to
 * a region in an outlet, and the barrier exists to see across regions. That is
 * right for an app and a leak between tests: a torn-down element still holding
 * the name "trash" wins the first-registration race against the next test's
 * real one.
 */
import { settled } from '@ember/test-helpers';
import {
  animationsSettled,
  registerMotionReset,
  setupMotion,
} from 'glimmer-motion/test-support';
import { frame, visualElementStore } from 'motion-dom';

import { resetBeacons } from '../beacons.ts';
import { resetBarrier } from '../far.ts';
import { resetGestures } from '../gesture.ts';
import { activeRuns } from '../run.ts';

registerMotionReset(resetBeacons);
registerMotionReset(resetGestures);
registerMotionReset(resetBarrier);

const nextFrame = () =>
  new Promise<void>((resolve) => frame.postRender(() => resolve()));

/* ---- setup ---- */

/** `setupMotion(hooks)`, with Choreo's resets among the ones it runs */
export function setupChoreo(hooks: Parameters<typeof setupMotion>[0]) {
  setupMotion(hooks);
}

/* ---- driving the run from a test (§8.3) ---- */

/** open every parked gate and settle the segment it releases */
export async function advanceGate(): Promise<void> {
  for (const run of activeRuns) {
    if (run.parked) {
      run.advance();
    }
  }
  await animationsSettled();
}

/** set every live run's clock, in seconds — a scrubbed still */
export async function seekTo(seconds: number): Promise<void> {
  for (const run of activeRuns) {
    run.pause();
    run.time = seconds;
  }
  await settled();
  await nextFrame();
}

/* ---- Choreo invariants, shared by the contract suite and the soak ---- */

const testRoot = () =>
  (document.querySelector('#ember-testing') ?? document.body) as HTMLElement;

/** how many leavers are parked in a <Choreo> orphan layer right now */
export function orphanCount(root: HTMLElement = testRoot()): number {
  return [...root.querySelectorAll('[data-choreo-orphans]')].reduce(
    (n, layer) => n + layer.children.length,
    0,
  );
}

/**
 * The first LIVE match for `selector` — the copy that is still part of the
 * rendered tree, never a leaver parked in a region's orphan layer.
 *
 * Mid-crossing an identity exists twice: the arriving element in the live
 * tree, and the departing skin the region locked into `[data-choreo-orphans]`
 * so it can be flown and faded. That layer is the region's FIRST child, so a
 * bare `querySelector` answers with the ghost — an element whose component
 * has already been torn down, whose listeners are gone, and whose box is
 * where the OLD scene stood. Clicking it does nothing; measuring it measures
 * the past. Neither failure names itself.
 *
 * So any assertion or interaction a test performs while a crossing may be
 * aloft should come through here. A raised sprite (`c.Raise`) is deliberately
 * still live: it is the real element on a different layer, not a copy.
 */
export function live<E extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = testRoot(),
): E | null {
  return liveAll<E>(selector, root)[0] ?? null;
}

/** every live match for `selector`, in document order — see `live()` */
export function liveAll<E extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = testRoot(),
): E[] {
  return [...root.querySelectorAll<E>(selector)].filter(
    (el) => !el.closest('[data-choreo-orphans]'),
  );
}

/**
 * Elements still wearing a transform that nothing is animating.
 *
 * The identity spellings (`translateX(0px)`, `scale(1)`) are rest: the engine
 * writes them and they are harmless. Anything else, once everything has
 * settled, is a value somebody borrowed and never gave back.
 */
const IDENTITY =
  /^(translate[XYZ]?\(0px\)\s*|translate\(0px,\s*0px\)\s*|scale[XY]?\(1\)\s*|rotate\(0deg\)\s*)+$/;

export function strandedTransforms(root: HTMLElement = testRoot()): string[] {
  return [...root.querySelectorAll<HTMLElement>('*')]
    .filter((el) => {
      const t = el.style.transform;
      if (!t || t === 'none' || IDENTITY.test(t)) {
        return false;
      }
      // a region root's transform is its camera, and a directed plane
      // RESTS transformed — a held zoom is a pose, not a leak
      if (el.hasAttribute('data-choreo')) {
        return false;
      }
      return !isFollower(el);
    })
    .map(
      (el) =>
        `${el.tagName.toLowerCase()}.${el.className}: ${el.style.transform}`,
    );
}

/**
 * Is this element's transform owned by somebody else?
 *
 * A shared-element pair is one identity with two elements, and only one of them
 * leads. The follower is projected onto the lead's box on purpose — that is
 * what makes the crossfade possible — so a thumbnail sitting behind an open
 * lightbox wears a large scale at rest and is entirely correct.
 *
 * Without this, "no element kept a transform" fails for any stage a test
 * happens to leave open, which reads exactly like a leak and is not one.
 */
function isFollower(el: HTMLElement): boolean {
  const projection = visualElementStore.get(el)?.projection;
  if (!projection || projection.isLead()) {
    return false;
  }
  const lead = projection.getStack()?.lead;
  return Boolean(lead?.instance?.isConnected);
}
