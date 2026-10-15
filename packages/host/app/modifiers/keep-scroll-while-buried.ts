import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';

import Modifier from 'ember-modifier';

import type { ArgsFor, NamedArgs } from 'ember-modifier';

interface Signature {
  Element: HTMLElement;
  Args: {
    Positional: [];
    Named: {
      // True while another card covers this one in its stack. The element is
      // hidden (`display: none`) for that time, so every scroller inside it
      // reads an offset of 0.
      buried: boolean;
    };
  };
}

// A scroller's offset, and the size of its content when the offset was taken.
interface Offset {
  top: number;
  left: number;
  width: number;
  height: number;
}

// Restoring gives up after this long, leaving the content wherever the last
// re-apply put it. It only runs this long when the content never returns to
// the size it had (it changed while the item was buried), so the saved offset
// can't hold the scroller forever.
const RESTORE_CAP_MS = 5000;
// The restore is done once every saved offset sticks, the content is back at
// the size it had when the offset was taken, and the scrollers' geometry has
// gone this many consecutive rendered frames, and this long in wall-clock time,
// without changing. During the item's grow-back transition the geometry
// changes every frame, so the frame count is what tells "still moving" from
// "stopped"; the wall-clock floor keeps the window from collapsing on
// high-refresh displays.
const QUIET_FRAMES = 3;
const QUIET_MS = 100;
// The ways a user drives a scroller. A programmatic assignment or a layout
// clamp fires `scroll` but none of these.
const GESTURE_EVENTS = ['wheel', 'touchmove', 'pointerdown', 'keydown'];

// Keeps the scroll offsets of a stack item's content across the time the item
// is buried under another card.
//
// While the item is on top, every scroll inside the content (the card's own
// scroller and any nested one) records that scroller's offset. Burying the item
// hides its content. The browser keeps each scroller's offset while it is
// hidden, but applies it only once, as the content reappears, against whatever
// layout the content has at that moment. Content that lays itself out from its
// own measurements (fitted tiles, virtualized lists, live previews that remount)
// is not at its settled size then: shorter content clamps the offset, and
// content that settles from taller to shorter carries the offset with it
// through scroll anchoring. Either way it lands away from where it was left.
//
// So when the item is on top again, the saved offsets are re-applied every frame
// until they stick and the content is back at the size it had when they were
// taken. A user gesture inside the content ends the restore, so it never fights
// the user's own scrolling.
export default class KeepScrollWhileBuried extends Modifier<Signature> {
  #element: HTMLElement | undefined;
  #buried = false;
  #offsets = new Map<Element, Offset>();
  #stopRestoring: (() => void) | undefined;

  constructor(owner: Owner, args: ArgsFor<Signature>) {
    super(owner, args);
    registerDestructor(this, () => this.#teardown());
  }

  modify(
    element: HTMLElement,
    _positional: [],
    { buried }: NamedArgs<Signature>,
  ) {
    if (this.#element !== element) {
      this.#teardown();
      this.#element = element;
      element.addEventListener('scroll', this.#record, {
        capture: true,
        passive: true,
      });
      for (let name of GESTURE_EVENTS) {
        element.addEventListener(name, this.#endRestore, {
          capture: true,
          passive: true,
        });
      }
    }
    if (buried && !this.#buried) {
      this.#endRestore();
    } else if (!buried && this.#buried) {
      this.#restore(element);
    }
    this.#buried = buried;
  }

  // `scroll` doesn't bubble, so this listens in the capture phase to hear
  // every scroller inside the content.
  #record = (event: Event) => {
    if (this.#buried || this.#stopRestoring) {
      return;
    }
    let scroller = event.target;
    if (scroller instanceof Element) {
      if (!this.#offsets.has(scroller)) {
        // A scroller the card has since re-rendered away is never restored,
        // so it shouldn't keep its detached subtree alive either.
        for (let recorded of this.#offsets.keys()) {
          if (!recorded.isConnected) {
            this.#offsets.delete(recorded);
          }
        }
      }
      this.#offsets.set(scroller, {
        top: scroller.scrollTop,
        left: scroller.scrollLeft,
        width: scroller.scrollWidth,
        height: scroller.scrollHeight,
      });
    }
  };

  #restore(element: HTMLElement) {
    this.#endRestore();
    let saved: [Element, Offset][] = [];
    for (let [scroller, offset] of this.#offsets) {
      if (!element.contains(scroller)) {
        // the card re-rendered that part of its content while it was buried
        this.#offsets.delete(scroller);
      } else if (offset.top !== 0 || offset.left !== 0) {
        saved.push([scroller, offset]);
      }
    }
    if (saved.length === 0) {
      return;
    }

    // `instant`, so a card that styles its scroller `scroll-behavior: smooth`
    // still gets its offset back in one step rather than as an animation.
    let apply = () => {
      for (let [scroller, { top, left }] of saved) {
        scroller.scrollTo({ top, left, behavior: 'instant' });
      }
    };
    let stuck = () =>
      saved.every(
        ([scroller, { top, left }]) =>
          Math.abs(scroller.scrollTop - top) <= 1 &&
          Math.abs(scroller.scrollLeft - left) <= 1,
      );
    let atSavedSize = () =>
      saved.every(
        ([scroller, { width, height }]) =>
          Math.abs(scroller.scrollWidth - width) <= 1 &&
          Math.abs(scroller.scrollHeight - height) <= 1,
      );
    let geometry = () =>
      saved
        .map(
          ([scroller]) =>
            `${scroller.clientWidth}x${scroller.clientHeight}/${scroller.scrollWidth}x${scroller.scrollHeight}`,
        )
        .join(' ');

    let startedAt = performance.now();
    let lastGeometry = geometry();
    let lastChangeAt = startedAt;
    let quietFrames = 0;
    let rafId: number | undefined;

    let tick = () => {
      rafId = undefined;
      apply();
      let now = performance.now();
      let current = geometry();
      if (current !== lastGeometry) {
        lastGeometry = current;
        lastChangeAt = now;
        quietFrames = 0;
      } else {
        quietFrames += 1;
      }
      let settled =
        stuck() &&
        atSavedSize() &&
        quietFrames >= QUIET_FRAMES &&
        now - lastChangeAt >= QUIET_MS;
      if (settled || now - startedAt >= RESTORE_CAP_MS) {
        this.#endRestore();
        return;
      }
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- restore needs post-layout scroll geometry
      rafId = requestAnimationFrame(tick);
    };

    this.#stopRestoring = () => {
      if (rafId !== undefined) {
        cancelAnimationFrame(rafId);
        rafId = undefined;
      }
    };
    // Apply once as the item reappears, before it paints, then keep
    // re-applying after each layout until the offsets stick.
    apply();
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- restore needs post-layout scroll geometry
    rafId = requestAnimationFrame(tick);
  }

  #endRestore = () => {
    this.#stopRestoring?.();
    this.#stopRestoring = undefined;
  };

  #teardown() {
    this.#endRestore();
    if (this.#element) {
      this.#element.removeEventListener('scroll', this.#record, {
        capture: true,
      });
      for (let name of GESTURE_EVENTS) {
        this.#element.removeEventListener(name, this.#endRestore, {
          capture: true,
        });
      }
    }
    this.#element = undefined;
    this.#offsets.clear();
  }
}
