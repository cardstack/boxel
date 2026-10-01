/**
 * A region is a participant host (glimmer-motion/participant): its root
 * renders `data-motion-host` beside `data-choreo`, and registering a region
 * here registers it as that element's participant host too, so the {{motion}}
 * elements inside join it. The lookups below are Choreo's own, for code that
 * already speaks in regions.
 */
import { type ParticipantHost, setParticipantHost } from '../participant.ts';
import type { ChoreoRun } from './run.ts';
import type { ChoreoNode, TimelineNode } from './types.ts';

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
