/**
 * The layout handshake React does in getSnapshotBeforeUpdate / componentDidUpdate:
 * every projecting node snapshots itself BEFORE the DOM changes, and the root
 * measures AFTER. In Glimmer we wrap the state mutation that causes the change.
 *
 *   layoutChange(() => { this.items = next; });
 */
import type { IProjectionNode } from 'motion-dom';
import { microtask, rootProjectionNode } from 'motion-dom';
import { warnOnce } from 'motion-utils';

import { registerBusyProbe } from './activity.ts';
import { postRender } from './scheduler.ts';

const nodes = new Set<IProjectionNode>();
export let hasTakenAnySnapshot = false;

export function registerProjection(node: IProjectionNode) {
  nodes.add(node);
  return () => nodes.delete(node);
}

export function snapshotAll() {
  hasTakenAnySnapshot = true;
  nodes.forEach((n) => n.willUpdate());
}

/** the modifier registers its mount flush here (it imports this module, so no cycle) */
let flushMounts: () => void = () => {};
export function setMountFlusher(fn: () => void) {
  flushMounts = fn;
}

let settlePending = false;
/** a render pass whose projection didUpdate() has not happened yet */
registerBusyProbe(() => settlePending && 'projection settle pending');

/**
 * The circuit breaker: how many settles are allowed before the browser gets a
 * frame.
 *
 * A settle measures every projecting node in the document, and it is scheduled
 * into the runloop — which Ember drains in a MICROTASK. So does the engine's
 * own projection update. That is fine, and it is also the whole danger: a
 * microtask that schedules another microtask never yields, and a chain of them
 * starves timers, animation frames, input and paint alike. The tab does not
 * get slow. It stops.
 *
 * Application code can close that chain without doing anything obviously
 * wrong. The case this was written for: a `@tracked` property assigned on
 * every frame of a drag. Tracked properties have no equality check, so
 * assigning the value it already holds still invalidates every consumer; the
 * consumers re-render; re-rendering a {{motion}} element asks for a settle;
 * the settle's projection update reports a layout change to the drag gesture,
 * which nudges the element; and the next frame has something to re-render
 * again. Every step of that is a legitimate thing for a library to do. The
 * loop is only fatal because none of it ever yields.
 *
 * So past this many settles without an intervening animation frame, the next
 * one is scheduled FROM a frame instead of from a microtask. The loop, if it
 * is a real loop, keeps going — but at sixty passes a second instead of as
 * fast as the CPU allows, which leaves the page painting, scrolling, and
 * answering the pointer while the developer reads the warning below. A hang
 * becomes jank, and jank can be debugged.
 *
 * Sixty is far above anything legitimate: a settle is per render pass, and a
 * pass that settles sixty times before the browser draws once is already the
 * bug this is here to survive.
 */
const BURST_LIMIT = 60;

/**
 * `process` is not a browser global; a bundler replaces this expression at
 * build time. Declared locally rather than pulling in Node's types for one
 * string, and defaulting to "warn" when nothing replaced it — a warning that
 * should not have fired is cheap, and a silent hang is not.
 */
declare const process: { env?: { NODE_ENV?: string } } | undefined;
const isDev = () =>
  typeof process === 'undefined' || process?.env?.NODE_ENV !== 'production';
let burst = 0;
let frameBooked = false;
let breakerTripped = false;

function bookFrameReset() {
  if (frameBooked || typeof requestAnimationFrame !== 'function') {
    return;
  }
  frameBooked = true;
  requestAnimationFrame(() => {
    frameBooked = false;
    burst = 0;
  });
}

/**
 * Did the breaker trip since it was last reset?
 *
 * Nothing in an application should need this. It is here for test support: a
 * layout loop is always a bug, and a suite that can see one is a suite that
 * can fail on it by name instead of timing out with no stack.
 */
export function layoutLoopDetected(): boolean {
  return breakerTripped;
}

export function resetLayoutLoopGuard() {
  breakerTripped = false;
  burst = 0;
}
/**
 * React's componentDidUpdate timing: every projection root's didUpdate() runs once per render pass, after
 * render and after every element rendered in the pass has mounted. The engine's update then happens in a
 * microtask after that — never between Glimmer's render and the mounts.
 */
export function requestSettle() {
  if (settlePending) {
    return;
  }
  settlePending = true;
  bookFrameReset();
  burst += 1;
  if (burst <= BURST_LIMIT || typeof requestAnimationFrame !== 'function') {
    postRender(settleNow);
    return;
  }
  breakerTripped = true;
  if (isDev()) {
    warnOnce(
      false,
      `glimmer-motion: ${BURST_LIMIT} layout settles without a single animation frame. ` +
        'Something is re-rendering a motion element in a loop. The usual cause is a ' +
        '@tracked property assigned unconditionally from a per-frame callback — an ' +
        'onDrag, onScroll or onViewportEnter handler — because a tracked property has ' +
        'no equality check and assigning the value it already holds still invalidates ' +
        'every consumer. Assign only on change. Settles are being deferred to animation ' +
        'frames so the page keeps responding; without that the tab would stop entirely.',
    );
  }
  // From a frame, not a microtask: this is the yield. Ember's afterRender still
  // runs the settle, so its ordering guarantees hold — it simply happens one
  // frame later than it wanted to.
  requestAnimationFrame(() => postRender(settleNow));
}
const afterSettleQueue: (() => void)[] = [];
/** run after this pass has settled (mounts + didUpdate), in the engine's post-render microtask —
 *  React's componentDidUpdate → microtask.postRender slot */
export function afterSettle(fn: () => void) {
  afterSettleQueue.push(fn);
  requestSettle();
}
function settleNow() {
  settlePending = false;
  flushMounts();
  settleAll();
  if (afterSettleQueue.length) {
    const fns = afterSettleQueue.splice(0);
    microtask.postRender(() => fns.forEach((fn) => fn()));
  }
}

export function settleAll() {
  const roots = new Set<IProjectionNode>();
  nodes.forEach((n) => roots.add(n.root ?? n));
  roots.forEach((r) => r.didUpdate());
}

export function layoutChange<T>(fn: () => T): T {
  snapshotAll();
  const out = fn();
  requestSettle();
  return out;
}

/**
 * Motion's useInstantLayoutTransition(): run a state change without layout animation —
 * the root blocks the next update so no projection animates.
 */
export function instantLayoutTransition(callback?: () => void) {
  const root = rootProjectionNode.current as IProjectionNode | undefined;
  if (!root) {
    callback?.();
    return;
  }
  (root as any).isUpdating = false;
  (root as any).blockUpdate();
  callback?.();
}
