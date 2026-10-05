/**
 * A region is a participant host (glimmer-motion/participant): its root
 * renders `data-motion-host` beside `data-choreo`, and registering a region
 * here registers it as that element's participant host too, so the {{motion}}
 * elements inside join it. The lookups below are Choreo's own, for code that
 * already speaks in regions.
 */
import { type ParticipantHost, setParticipantHost } from 'glimmer-motion';

import type { ChoreoRun } from './run.ts';
import type { ChoreoNode, TimelineNode } from './types.ts';

// The `{{motion}}` args a region adds, typed here because the package's root
// declarations re-export this module; measure.ts, which applies `pack`, is
// reached only at runtime, so an augmentation there would not ship.
declare module 'glimmer-motion/participant' {
  interface ParticipantArgs {
    /**
     * How Choreo measures this element for a shape-matched flight.
     * `'box'` (default) is the layout border box — right for plates, cards,
     * stages. `'content'` is the shrink-wrap (the ink): a full-bleed title
     * still matches as a word. Written as `data-choreo-pack`; an explicit
     * `[data-choreo-substance]` descendant still wins.
     */
    pack?: 'box' | 'content';
  }
}

/** anything that can put a node on a region's timeline — a step component, or a lane from outside */
export interface ChoreoProvider {
  node(): TimelineNode;
}

export interface ChoreoHost extends ParticipantHost {
  /** a destroyed participant asks whether the region still needs its element; true → the region unmounts it later */
  claim(node: ChoreoNode): boolean;
  /**
   * SPIKE (Lane): a provider from OUTSIDE the region's markup — a parent's
   * lane addressed at this region — whose node joins the tree the region
   * collects on every pass, after its own steps. Returns the remover.
   */
  contribute(provider: ChoreoProvider): () => void;
  /** the run the region is playing or holding, for an attachment to drive; null between runs */
  currentRun(): ChoreoRun | null;
  register(node: ChoreoNode): () => void;
}

const hosts = new WeakMap<Element, ChoreoHost>();
/** regions rendered with `@id`, so an attachment can name one without a DOM query per frame */
const hostsById = new Map<string, ChoreoHost>();

export function setChoreoHost(el: Element, host: ChoreoHost | undefined) {
  const id = el.getAttribute('data-choreo');
  if (host) {
    hosts.set(el, host);
    setParticipantHost(el, host);
    if (id) {
      hostsById.set(id, host);
    }
  } else {
    // a region re-keyed under the same id may already have registered its
    // successor: only the entry that is THIS host's comes off
    const mine = hosts.get(el);
    hosts.delete(el);
    setParticipantHost(el, undefined);
    if (id && mine && hostsById.get(id) === mine) {
      hostsById.delete(id);
    }
  }
}

export function closestChoreo(el: Element): ChoreoHost | undefined {
  const root = el.parentElement?.closest('[data-choreo]');
  return root ? hosts.get(root) : undefined;
}

/** the host of a region element itself (not an ancestor's) */
export function choreoHostAt(el: Element): ChoreoHost | undefined {
  return hosts.get(el);
}

/** the host of the region rendered with `@id` — a lane's way of naming the region it plays in */
export function choreoHostById(id: string): ChoreoHost | undefined {
  return hostsById.get(id);
}
