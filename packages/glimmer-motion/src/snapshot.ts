/**
 * `<Presence @mode="snapshot">`: a leaver's exit played on a static copy of
 * it that the engine owns, instead of on its live block.
 *
 * A Glimmer block re-runs from live state for as long as it is rendered, so a
 * leaver kept on screen for its exit shows state that has already moved on.
 * In snapshot mode the leaver's block is torn down in the render that removes
 * it, as if no <Presence> were there. Before that render patches the
 * leaver's block, the element is copied as it stands. After it, the copy goes
 * back where the element stood (before the first node that followed it and is
 * still there), lifted out of flow at its recorded seat, plays the element's
 * exit, and is removed.
 *
 * The seat is read in every frame that follows a render, and whenever the
 * element or the box it is pinned inside resizes, not at the diff: Glimmer
 * patches the DOM in template order, so by the time <Presence> diffs, content
 * earlier in the template has already been patched for the render, and may
 * have moved or resized the element. Its content is still the last frame's;
 * its box may not be. A move that is neither a render nor one of those
 * resizes is not seen: a transition on a sibling's width can shift the
 * element without resizing either box, and the copy is then pinned where the
 * element stood before that move.
 *
 * The copy is kept as a memory (see memory.ts): it shows the element's last
 * frame, and nothing in it acts. A clone does not carry everything the
 * element showed, so the copy also takes the canvas pixels it showed, the
 * option each of its selects had chosen, and the values its script
 * animations and transitions had reached.
 */
import type { PresenceContextProps } from 'motion-dom';

import {
  elementsOf,
  keepAsMemory,
  readShown,
  type Shown,
  shownOnCopy,
} from './memory.ts';
import {
  flushPendingMounts,
  type MotionEl,
  MotionNode,
  type MotionProps,
  type PopSeat,
  seatInsets,
  seatOf,
} from './node.ts';
import type { PresenceHandle } from './presence-types.ts';

/** where a copy is pinned, and what its exit variants resolve against */
export interface CopyPlacement {
  anchorX: 'left' | 'right';
  anchorY: 'top' | 'bottom';
  custom: unknown;
}

/** what the diff read from a leaver, for its copy to use after the render */
interface Captured {
  copy: MotionEl;
  /**
   * the nodes that followed the element: the copy goes back in before the
   * first one the render left in place (the next ones are often the leaver's
   * own whitespace and bounds, which leave with its block)
   */
  following: Node[];
  parent: Node;
  props: MotionProps;
  seat: PopSeat;
  /** what the element showed, keyed to the copy's elements */
  shown: Shown;
}

let copyId = 0;

/** an element's CSS property for a keyframe key: `clipPath` → `clip-path`, `--x` stays */
function cssProperty(key: string) {
  if (key.startsWith('--')) {
    return key;
  }
  return key === 'cssFloat'
    ? 'float'
    : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

const KEYFRAME_META = new Set([
  'composite',
  'computedOffset',
  'easing',
  'offset',
]);

/** a script animation or a transition: the copy keeps the value it shows now */
function freezeComputed(animation: Animation, live: Element, copy: Element) {
  const effect = animation.effect as KeyframeEffect;
  const computed = getComputedStyle(live);
  const style = (copy as HTMLElement | SVGElement).style;
  for (const frame of effect.getKeyframes()) {
    for (const key of Object.keys(frame)) {
      if (!KEYFRAME_META.has(key)) {
        const property = cssProperty(key);
        style.setProperty(property, computed.getPropertyValue(property));
      }
    }
  }
}

function copyCanvas(live: HTMLCanvasElement, copy: HTMLCanvasElement) {
  try {
    copy.getContext('2d')?.drawImage(live, 0, 0);
  } catch {
    // a canvas the copy cannot draw from stays blank
  }
}

/**
 * Copies an element that is about to be removed, as it stands. Called from
 * <Presence>'s diff, before the render patches the element's block. `seat` is
 * the one recorded for it (see MotionNode.recordSeat); an element that is
 * leaving before any seat was recorded is pinned where it stands now.
 */
export function captureExit(source: {
  element: MotionEl;
  props: MotionProps;
  seat: PopSeat | undefined;
}): ExitCopy | undefined {
  const { element, props } = source;
  const parent = element.parentNode;
  const seat = source.seat ?? seatOf(element);
  if (!parent || !seat) {
    return undefined;
  }
  const copy = element.cloneNode(true) as MotionEl;
  const live = elementsOf(element);
  const copies = elementsOf(copy);
  const indexOf = new Map(live.map((el, i) => [el, i]));
  for (const animation of element.getAnimations({ subtree: true })) {
    const effect = animation.effect;
    const index =
      !(animation instanceof CSSAnimation) &&
      effect instanceof KeyframeEffect &&
      !effect.pseudoElement &&
      effect.target
        ? indexOf.get(effect.target)
        : undefined;
    if (index !== undefined) {
      freezeComputed(animation, live[index]!, copies[index]!);
    }
  }
  live.forEach((el, i) => {
    if (el instanceof HTMLCanvasElement) {
      copyCanvas(el, copies[i] as HTMLCanvasElement);
    } else if (el instanceof HTMLOptionElement) {
      // a clone's options take their selectedness from the markup, not from
      // the choice the user made
      (copies[i] as HTMLOptionElement).selected = el.selected;
    }
  });
  const following: Node[] = [];
  for (let node = element.nextSibling; node; node = node.nextSibling) {
    following.push(node);
  }
  return new ExitCopy({
    copy,
    following,
    parent,
    props,
    seat,
    shown: shownOnCopy(readShown(element), element, copy),
  });
}

/** one static copy of a leaver, from the render that removed the leaver until its exit ends */
export class ExitCopy {
  private node?: MotionNode;
  private ended = false;
  /** set once the copy has mounted and its exit has started: before that, a report is the mount's */
  private armed = false;
  private readonly reports = new Map<string | number, boolean>();
  private onDone?: () => void;
  private readonly captured: Captured;

  constructor(captured: Captured) {
    this.captured = captured;
  }

  /** after the render: put the copy where its element stood and play the exit */
  start(placement: CopyPlacement, onDone: () => void) {
    this.onDone = onDone;
    const { copy, following, parent, props, shown } = this.captured;
    if (this.ended || !parent.isConnected) {
      this.end(true);
      return;
    }
    this.pin(placement);
    const before = following.find((node) => node.parentNode === parent);
    keepAsMemory(copy, shown, () => parent.insertBefore(copy, before ?? null));
    const node = (this.node = new MotionNode());
    node.update(copy, { ...props, presence: this.handle(placement) });
    flushPendingMounts();
    this.armed = true;
    this.check();
  }

  /** stop now and remove the copy, without reporting an exit (its item came back) */
  cut() {
    this.end(false);
  }

  /** lifted out of flow at the seat its element had: inline and important, so the copy's own CSS cannot move it */
  private pin({ anchorX, anchorY }: CopyPlacement) {
    const { copy, seat } = this.captured;
    const { inline, block } = seatInsets(seat, anchorX, anchorY);
    const style = copy.style;
    const set = (property: string, value: string) =>
      style.setProperty(property, value, 'important');
    set('position', 'absolute');
    set('margin', '0');
    set('width', `${seat.w}px`);
    set('height', `${seat.h}px`);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      set(side, 'auto');
    }
    set(inline[0], `${inline[1]}px`);
    set(block[0], `${block[1]}px`);
  }

  /** the copy is not present, and its exit is done once every motion element registered in it reports */
  private handle(placement: CopyPlacement): PresenceHandle {
    const id = `presence-copy-${copyId++}`;
    const context: PresenceContextProps = {
      id,
      isPresent: false,
      custom: placement.custom,
      register: (childId) => {
        this.reports.set(childId, false);
        return () => {
          this.reports.delete(childId);
          this.check();
        };
      },
      onExitComplete: (childId) => {
        this.reports.set(childId, true);
        this.check();
      },
    };
    return {
      anchorX: placement.anchorX,
      anchorY: placement.anchorY,
      context,
      isPresent: false,
      key: id,
      mode: 'sync',
      popCandidate: () => () => undefined,
      subscribe: () => () => undefined,
    };
  }

  private check() {
    if (
      this.armed &&
      !this.ended &&
      [...this.reports.values()].every(Boolean)
    ) {
      this.end(true);
    }
  }

  private end(report: boolean) {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.node?.destroy();
    this.node = undefined;
    this.captured.copy.remove();
    if (report) {
      this.onDone?.();
    }
  }
}
