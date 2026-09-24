import { modifier } from 'ember-modifier';

import type HostMotionService from '@cardstack/host/services/host-motion';

import type { ChoreoContext } from 'glimmer-motion';

// Pointer tracking exists only while pressed. Crossing the drag threshold
// retires optional motion once; the host never drives drag frames here.
export default modifier(
  (
    anchor: HTMLElement,
    [budget, context, kind]: [
      HostMotionService,
      ChoreoContext,
      'stack' | 'sheet',
    ],
  ) => {
    let unbind = budget.bind(kind, context);
    if (kind === 'sheet') return unbind;
    let root = anchor.closest<HTMLElement>('.host-stack-motion')!;
    let pointer: { id: number; x: number; y: number } | undefined;
    let nativeDragging = false;
    let move = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 4)
        return;
      budget.beginDrag();
      window.removeEventListener('pointermove', move);
    };
    let end = () => {
      pointer = undefined;
      if (!nativeDragging) budget.endDrag();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    let start = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      window.addEventListener('pointermove', move, { passive: true });
      window.addEventListener('pointerup', end, { once: true });
      window.addEventListener('pointercancel', end, { once: true });
    };
    root.addEventListener('pointerdown', start, { passive: true });
    // Native drag/drop also sends pointercancel; keep its lifetime explicit.
    let nativeStart = () => {
      nativeDragging = true;
      budget.beginDrag();
    };
    let nativeEnd = () => {
      nativeDragging = false;
      end();
    };
    root.addEventListener('dragstart', nativeStart);
    window.addEventListener('dragend', nativeEnd);
    return () => {
      root.removeEventListener('pointerdown', start);
      root.removeEventListener('dragstart', nativeStart);
      window.removeEventListener('dragend', nativeEnd);
      nativeEnd();
      unbind();
    };
  },
);
