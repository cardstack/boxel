/**
 * The layout handshake React does in getSnapshotBeforeUpdate / componentDidUpdate:
 * every projecting node snapshots itself BEFORE the DOM changes, and the root
 * measures AFTER. In Glimmer we wrap the state mutation that causes the change.
 *
 *   layoutChange(() => { this.items = next; });
 */
import type { IProjectionNode } from 'motion-dom';
import { microtask, rootProjectionNode } from 'motion-dom';

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
  postRender(settleNow);
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
