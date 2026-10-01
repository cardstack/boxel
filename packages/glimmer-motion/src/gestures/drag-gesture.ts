/**
 * Motion's drag feature, with the two places glimmer-motion's drag differs
 * from React's. Everything else is upstream's.
 */
import type { VisualElement } from 'motion-dom';
import { isPrimaryPointer } from 'motion-dom';

import {
  type DragControlOptions,
  DragGesture,
  VisualElementDragControls,
} from '../framer-motion-internals.ts';
import { lockTextSelect, unlockTextSelect } from './lock-select.ts';

/**
 * Upstream's drag controls, holding the document's text-selection lock for as
 * long as a pan session is open.
 */
class TextLockingDragControls extends VisualElementDragControls {
  private selectLocked = false;

  override start(originEvent: PointerEvent, options?: DragControlOptions) {
    super.start(originEvent, options);
    // A pan session starts only for a primary pointer, and `start()` returns
    // without one while the element is exiting.
    if (this.panSession && isPrimaryPointer(originEvent)) {
      this.lockSelect();
    }
  }

  override endPanSession() {
    super.endPanSession();
    this.unlockSelect();
  }

  private lockSelect() {
    if (this.selectLocked) {
      return;
    }
    this.selectLocked = true;
    lockTextSelect();
  }

  private unlockSelect() {
    if (!this.selectLocked) {
      return;
    }
    this.selectLocked = false;
    unlockTextSelect();
  }
}

export class GlimmerDragGesture extends DragGesture {
  constructor(node: VisualElement<HTMLElement>) {
    super(node);
    this.controls = new TextLockingDragControls(node);
  }

  /**
   * Upstream keeps the pan session alive when a component unmounts mid-drag,
   * because in React 19 a list reorder can unmount and remount a component
   * while the gesture is still live. Glimmer has no such reconciliation: a
   * keyed `{{#each}}` moves a node rather than tearing it down and building it
   * again, so an unmount here means the element is gone and the gesture has
   * nothing left to move.
   *
   * Upstream's guard skips `cancel()`, and `cancel()` is what releases the
   * module-global `setDragLock`. If the pointerup never arrives (the element
   * was removed mid-gesture, the tab lost the pointer, a module reloaded), the
   * lock is held forever and every later drag on the page bails before
   * `onDragStart`. The pan session still moves elements, so dragging looks
   * fine while `onDragStart` / `onDragEnd` silently stop firing.
   *
   * `cancel()` ends the session, releases the lock and clears `whileDrag`.
   */
  override unmount() {
    this.removeGroupControls();
    this.removeListeners();
    this.controls.cancel();
  }
}
