/**
 * How a participant finds its region: the nearest `[data-choreo]` ancestor, by
 * DOM — the same discovery <LayoutGroup> and <MotionConfig> use, so nothing
 * has to be threaded through the tree. No imports from node.ts here: node.ts
 * imports this.
 */
import type { ChoreoNode } from './types.ts';

export interface ChoreoHost {
  /** a destroyed participant asks whether the region still needs its element; true → the region unmounts it later */
  claim(node: ChoreoNode): boolean;
  /**
   * Is this region going to run a row for `node` as a leaver — i.e. will it be
   * the one to say when the element may go?
   *
   * `claim` above answers the same question for a participant that is already
   * being destroyed, and takes the node ON as a side effect. This one only
   * reads, because it is asked of a node that is still very much mounted: a
   * leaving <Presence> child waiting to find out whether anybody owes it a
   * timeline. Nothing about the region changes by asking.
   */
  handling(node: ChoreoNode): boolean;
  register(node: ChoreoNode): () => void;
}

const hosts = new WeakMap<Element, ChoreoHost>();

export function setChoreoHost(el: Element, host: ChoreoHost | undefined) {
  if (host) {
    hosts.set(el, host);
  } else {
    hosts.delete(el);
  }
}

export function closestChoreo(el: Element): ChoreoHost | undefined {
  const root = el.parentElement?.closest('[data-choreo]');
  return root ? hosts.get(root) : undefined;
}
