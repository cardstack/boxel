// @ts-nocheck — vendored verbatim; type-checked upstream under Motion's tsconfig
// Vendored from Motion's packages/framer-motion/src/gestures/drag/index.ts (motion@bbabb00) — framework-free; only imports were re-pointed.
import type { VisualElement } from 'motion-dom';
import { Feature } from 'motion-dom';
import { noop } from 'motion-utils';

import { VisualElementDragControls } from './visual-element-drag-controls.ts';

export class DragGesture extends Feature<HTMLElement> {
  controls: VisualElementDragControls;

  removeGroupControls: Function = noop;
  removeListeners: Function = noop;

  constructor(node: VisualElement<HTMLElement>) {
    super(node);
    this.controls = new VisualElementDragControls(node);
  }

  mount() {
    // If we've been provided a DragControls for manual control over the drag gesture,
    // subscribe this component to it on mount.
    const { dragControls } = this.node.getProps();

    if (dragControls) {
      this.removeGroupControls = dragControls.subscribe(this.controls);
    }

    this.removeListeners = this.controls.addListeners() || noop;
  }

  update() {
    const { dragControls } = this.node.getProps();
    const { dragControls: prevDragControls } = this.node.prevProps || {};

    if (dragControls !== prevDragControls) {
      this.removeGroupControls();
      if (dragControls) {
        this.removeGroupControls = dragControls.subscribe(this.controls);
      }
    }
  }

  unmount() {
    this.removeGroupControls();
    this.removeListeners();
    /**
     * DEVIATION from upstream (see VENDORED.md). Motion keeps the pan session
     * alive across an unmount that happens mid-drag:
     *
     *   if (!this.controls.isDragging) this.controls.endPanSession();
     *
     * because in React 19 a list reorder can unmount and remount a component
     * while the gesture is still live, and ending the session there would
     * drop the drag. Glimmer has no such reconciliation: a keyed `{{#each}}`
     * MOVES a node rather than tearing it down and building it again, so an
     * unmount here means the element is genuinely gone and the gesture has
     * nothing left to move.
     *
     * Keeping the upstream guard costs a leak with no expiry. `setDragLock`
     * is a module-global `{x, y}`; the lock is released in `cancel()`, which
     * this branch skips. If the pointerup never arrives — the element was
     * removed mid-gesture, the tab lost the pointer, a module reloaded — the
     * lock is held forever and `onStart` bails at `if (!this.openDragLock)`
     * for EVERY later drag on the page. The failure is invisible: the pan
     * session still moves elements, so dragging looks fine while every
     * `onDragStart` / `onDragEnd` silently stops firing, until a reload.
     *
     * `cancel()` ends the session, releases the lock and clears `whileDrag`.
     */
    this.controls.cancel();
  }
}
