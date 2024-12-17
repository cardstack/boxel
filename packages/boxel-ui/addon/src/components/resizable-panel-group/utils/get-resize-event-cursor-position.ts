import type { Orientation, ResizeEvent } from './types.ts';

export function getResizeEventCursorPosition(
  orientation: Orientation,
  event: ResizeEvent,
): number {
  const isHorizontal = orientation === 'horizontal';

  return isHorizontal ? event.clientX : event.clientY;
}
