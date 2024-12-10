import type { ResizeEvent } from './types.ts';

export function getResizeEventCoordinates(event: ResizeEvent) {
  return {
    x: event.clientX,
    y: event.clientY,
  };
}
