import { getPanelGroupElement } from './dom/get-panel-group-element.ts';
import { getResizeHandleElement } from './dom/get-resize-handle-element.ts';
import { getResizeEventCursorPosition } from './get-resize-event-cursor-position.ts';
import type { DragState, Orientation, ResizeEvent } from './types.ts';

export function calculateDeltaPercentage(
  event: ResizeEvent,
  dragHandleId: string,
  orientation: Orientation,
  initialDragState: DragState,
  panelGroupElement: HTMLElement,
): number {
  const isHorizontal = orientation === 'horizontal';

  const handleElement = getResizeHandleElement(dragHandleId, panelGroupElement);
  if (!handleElement) {
    throw new Error(`No resize handle element found for id "${dragHandleId}"`);
  }

  const groupId = handleElement.getAttribute('data-boxel-panel-group-id');
  if (!groupId) {
    throw new Error(`Resize handle element has no group id attribute`);
  }

  let { initialCursorPosition } = initialDragState;

  const cursorPosition = getResizeEventCursorPosition(orientation, event);

  const groupElement = getPanelGroupElement(groupId, panelGroupElement);
  if (!groupElement) {
    throw new Error(`No group element found for id "${groupId}"`);
  }

  const groupRect = groupElement.getBoundingClientRect();
  const groupSizeInPixels = isHorizontal ? groupRect.width : groupRect.height;

  const offsetPixels = cursorPosition - initialCursorPosition;
  const offsetPercentage = (offsetPixels / groupSizeInPixels) * 100;

  return offsetPercentage;
}
