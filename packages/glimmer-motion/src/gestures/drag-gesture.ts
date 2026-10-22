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

type PanSession = NonNullable<VisualElementDragControls['panSession']>;

/**
 * Upstream's drag controls, holding the document's text-selection lock for as
 * long as a pan session is open.
 *
 * The lock follows the session rather than the drag: `PanSession.end()` runs
 * on every pointerup, including a press that never moved, where upstream
 * skips `onSessionEnd` (and with it `endPanSession()`).
 */
class TextLockingDragControls extends VisualElementDragControls {
  /** the open pan session that holds the lock */
  private lockedSession: PanSession | undefined;

  override start(originEvent: PointerEvent, options?: DragControlOptions) {
    const previous = this.panSession;
    super.start(originEvent, options);
    const session = this.panSession;
    // `start()` opens no session while the element is exiting, and a session
    // only starts for a primary pointer.
    if (!session || session === previous || !isPrimaryPointer(originEvent)) {
      return;
    }
    this.holdLockFor(session);
  }

  private holdLockFor(session: PanSession) {
    if (!this.lockedSession) {
      lockTextSelect();
    }
    this.lockedSession = session;
    const end = session.end;
    session.end = () => {
      end.call(session);
      this.releaseLockFor(session);
    };
  }

  private releaseLockFor(session: PanSession) {
    if (this.lockedSession !== session) {
      return;
    }
    this.lockedSession = undefined;
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
