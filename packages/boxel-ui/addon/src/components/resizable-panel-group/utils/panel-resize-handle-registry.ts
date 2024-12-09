import {
  EXCEEDED_HORIZONTAL_MAX,
  EXCEEDED_HORIZONTAL_MIN,
  EXCEEDED_VERTICAL_MAX,
  EXCEEDED_VERTICAL_MIN,
} from './const.ts';
import { getResizeEventCoordinates } from './get-resize-event-coordinates.ts';
import type { Orientation, ResizeEvent } from './types.ts';

export type ResizeHandlerAction = 'down' | 'move' | 'up' | 'dblclick';
export type SetResizeHandlerState = (
  action: ResizeHandlerAction,
  isActive: boolean,
  event: ResizeEvent,
) => void;

export type PointerHitAreaMargins = {
  coarse: number;
  fine: number;
};

export type ResizeHandlerData = {
  element: HTMLElement;
  hitAreaMargins: PointerHitAreaMargins;
  orientation: Orientation;
  setResizeHandlerState: SetResizeHandlerState;
};

const isCoarsePointer = getInputType() === 'coarse';

let intersectingHandles: ResizeHandlerData[] = [];
let isPointerDown = false;
let ownerDocumentCounts: Map<Document, number> = new Map();
let panelConstraintFlags: Map<string, number> = new Map();

const registeredResizeHandlers = new Set<ResizeHandlerData>();

export function registerResizeHandle(
  resizeHandleId: string,
  element: HTMLElement,
  orientation: Orientation,
  hitAreaMargins: PointerHitAreaMargins,
  setResizeHandlerState: SetResizeHandlerState,
) {
  const { ownerDocument } = element;

  const data: ResizeHandlerData = {
    orientation,
    element,
    hitAreaMargins,
    setResizeHandlerState,
  };

  const count = ownerDocumentCounts.get(ownerDocument) ?? 0;
  ownerDocumentCounts.set(ownerDocument, count + 1);

  registeredResizeHandlers.add(data);

  updateListeners();

  return function unregisterResizeHandle() {
    panelConstraintFlags.delete(resizeHandleId);
    registeredResizeHandlers.delete(data);

    const count = ownerDocumentCounts.get(ownerDocument) ?? 1;
    ownerDocumentCounts.set(ownerDocument, count - 1);

    updateListeners();

    if (count === 1) {
      ownerDocumentCounts.delete(ownerDocument);
    }

    // If the resize handle that is currently unmounting is intersecting with the pointer,
    // update the global pointer to account for the change
    if (intersectingHandles.includes(data)) {
      const index = intersectingHandles.indexOf(data);
      if (index >= 0) {
        intersectingHandles.splice(index, 1);
      }

      updateCursor();
    }
  };
}

function handleDoubleClick(event: ResizeEvent) {
  const { target } = event;
  const { x, y } = getResizeEventCoordinates(event);

  recalculateIntersectingHandles({ target, x, y });
  updateListeners();

  if (intersectingHandles.length > 0) {
    updateResizeHandlerStates('dblclick', event);

    event.preventDefault();
    event.stopPropagation();
  }
}

function handlePointerDown(event: ResizeEvent) {
  const { target } = event;
  const { x, y } = getResizeEventCoordinates(event);

  isPointerDown = true;

  recalculateIntersectingHandles({ target, x, y });
  updateListeners();

  if (intersectingHandles.length > 0) {
    updateResizeHandlerStates('down', event);

    event.preventDefault();
    event.stopPropagation();
  }
}

function handlePointerMove(event: ResizeEvent) {
  const { x, y } = getResizeEventCoordinates(event);

  if (!isPointerDown) {
    const { target } = event;

    // Recalculate intersecting handles whenever the pointer moves, except if it has already been pressed
    // at that point, the handles may not move with the pointer (depending on constraints)
    // but the same set of active handles should be locked until the pointer is released
    recalculateIntersectingHandles({ target, x, y });
  }

  updateResizeHandlerStates('move', event);

  // Update cursor based on return value(s) from active handles
  updateCursor();

  if (intersectingHandles.length > 0) {
    event.preventDefault();
  }
}

function handlePointerUp(event: ResizeEvent) {
  const { target } = event;
  const { x, y } = getResizeEventCoordinates(event);

  panelConstraintFlags.clear();
  isPointerDown = false;

  if (intersectingHandles.length > 0) {
    event.preventDefault();
  }

  updateResizeHandlerStates('up', event);
  recalculateIntersectingHandles({ target, x, y });
  updateCursor();

  updateListeners();
}

function recalculateIntersectingHandles({
  target,
  x,
  y,
}: {
  target: EventTarget | null;
  x: number;
  y: number;
}) {
  intersectingHandles.splice(0);

  let targetElement: HTMLElement | null = null;
  if (target instanceof HTMLElement) {
    targetElement = target;
  }

  registeredResizeHandlers.forEach((data) => {
    const { element: dragHandleElement, hitAreaMargins } = data;

    const dragHandleRect = dragHandleElement.getBoundingClientRect();
    const { bottom, left, right, top } = dragHandleRect;

    const margin = isCoarsePointer
      ? hitAreaMargins.coarse
      : hitAreaMargins.fine;

    const eventIntersects =
      x >= left - margin &&
      x <= right + margin &&
      y >= top - margin &&
      y <= bottom + margin;

    if (eventIntersects) {
      // TRICKY
      // We listen for pointers events at the root in order to support hit area margins
      // (determining when the pointer is close enough to an element to be considered a 'hit')
      // Clicking on an element 'above' a handle (e.g. a modal) should prevent a hit though
      // so at this point we need to compare stacking order of a potentially intersecting drag handle,
      // and the element that was actually clicked/touched
      if (
        targetElement !== null &&
        dragHandleElement !== targetElement &&
        !dragHandleElement.contains(targetElement) &&
        !targetElement.contains(dragHandleElement)
      ) {
        // If the target is above the drag handle, then we also need to confirm they overlap
        // If they are beside each other (e.g. a panel and its drag handle) then the handle is still interactive
        //
        // It's not enough to compare only the target
        // The target might be a small element inside of a larger container
        // (For example, a SPAN or a DIV inside of a larger modal dialog)
        let currentElement: HTMLElement | null = targetElement;
        let didIntersect = false;
        while (currentElement) {
          if (currentElement.contains(dragHandleElement)) {
            break;
          } else if (
            intersects(
              currentElement.getBoundingClientRect(),
              dragHandleRect,
              true,
            )
          ) {
            didIntersect = true;
            break;
          }

          currentElement = currentElement.parentElement;
        }

        if (didIntersect) {
          return;
        }
      }

      intersectingHandles.push(data);
    }
  });
}

export function reportConstraintsViolation(
  resizeHandleId: string,
  flag: number,
) {
  panelConstraintFlags.set(resizeHandleId, flag);
}

function updateCursor() {
  let intersectsHorizontal = false;
  let intersectsVertical = false;

  intersectingHandles.forEach((data) => {
    const { orientation } = data;

    if (orientation === 'horizontal') {
      intersectsHorizontal = true;
    } else {
      intersectsVertical = true;
    }
  });

  let constraintFlags = 0;
  panelConstraintFlags.forEach((flag) => {
    constraintFlags |= flag;
  });

  if (intersectsHorizontal && intersectsVertical) {
    setGlobalCursorStyle('intersection', constraintFlags);
  } else if (intersectsHorizontal) {
    setGlobalCursorStyle('horizontal', constraintFlags);
  } else if (intersectsVertical) {
    setGlobalCursorStyle('vertical', constraintFlags);
  } else {
    resetGlobalCursorStyle();
  }
}

function updateListeners() {
  ownerDocumentCounts.forEach((_, ownerDocument) => {
    const { body } = ownerDocument;

    body.removeEventListener('contextmenu', handlePointerUp);
    body.removeEventListener('pointerdown', handlePointerDown);
    body.removeEventListener('pointerleave', handlePointerMove);
    body.removeEventListener('pointermove', handlePointerMove);
    body.removeEventListener('dblclick', handleDoubleClick);
  });

  window.removeEventListener('pointerup', handlePointerUp);
  window.removeEventListener('pointercancel', handlePointerUp);

  if (registeredResizeHandlers.size > 0) {
    if (isPointerDown) {
      if (intersectingHandles.length > 0) {
        ownerDocumentCounts.forEach((count, ownerDocument) => {
          const { body } = ownerDocument;

          if (count > 0) {
            body.addEventListener('contextmenu', handlePointerUp);
            body.addEventListener('pointerleave', handlePointerMove);
            body.addEventListener('pointermove', handlePointerMove);
          }
        });
      }

      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    } else {
      ownerDocumentCounts.forEach((count, ownerDocument) => {
        const { body } = ownerDocument;

        if (count > 0) {
          body.addEventListener('dblclick', handleDoubleClick);
          body.addEventListener('pointerdown', handlePointerDown, {
            capture: true,
          });
          body.addEventListener('pointermove', handlePointerMove);
        }
      });
    }
  }
}

function updateResizeHandlerStates(
  action: ResizeHandlerAction,
  event: ResizeEvent,
) {
  registeredResizeHandlers.forEach((data) => {
    const { setResizeHandlerState } = data;

    const isActive = intersectingHandles.includes(data);

    setResizeHandlerState(action, isActive, event);
  });
}

interface Rectangle {
  height: number;
  width: number;
  x: number;
  y: number;
}

function intersects(
  rectOne: Rectangle,
  rectTwo: Rectangle,
  strict: boolean,
): boolean {
  if (strict) {
    return (
      rectOne.x < rectTwo.x + rectTwo.width &&
      rectOne.x + rectOne.width > rectTwo.x &&
      rectOne.y < rectTwo.y + rectTwo.height &&
      rectOne.y + rectOne.height > rectTwo.y
    );
  } else {
    return (
      rectOne.x <= rectTwo.x + rectTwo.width &&
      rectOne.x + rectOne.width >= rectTwo.x &&
      rectOne.y <= rectTwo.y + rectTwo.height &&
      rectOne.y + rectOne.height >= rectTwo.y
    );
  }
}

function getInputType(): 'coarse' | 'fine' | undefined {
  if (typeof matchMedia === 'function') {
    return matchMedia('(pointer:coarse)').matches ? 'coarse' : 'fine';
  }
  return undefined;
}

type CursorState = 'horizontal' | 'intersection' | 'vertical';

let currentCursorStyle: string | null = null;
let styleElement: HTMLStyleElement | null = null;

function getCursorStyle(state: CursorState, constraintFlags: number): string {
  if (constraintFlags) {
    const horizontalMin = (constraintFlags & EXCEEDED_HORIZONTAL_MIN) !== 0;
    const horizontalMax = (constraintFlags & EXCEEDED_HORIZONTAL_MAX) !== 0;
    const verticalMin = (constraintFlags & EXCEEDED_VERTICAL_MIN) !== 0;
    const verticalMax = (constraintFlags & EXCEEDED_VERTICAL_MAX) !== 0;

    if (horizontalMin) {
      if (verticalMin) {
        return 'se-resize';
      } else if (verticalMax) {
        return 'ne-resize';
      } else {
        return 'e-resize';
      }
    } else if (horizontalMax) {
      if (verticalMin) {
        return 'sw-resize';
      } else if (verticalMax) {
        return 'nw-resize';
      } else {
        return 'w-resize';
      }
    } else if (verticalMin) {
      return 's-resize';
    } else if (verticalMax) {
      return 'n-resize';
    }
  }

  switch (state) {
    case 'horizontal':
      return 'ew-resize';
    case 'intersection':
      return 'move';
    case 'vertical':
      return 'ns-resize';
  }
}

function resetGlobalCursorStyle() {
  if (styleElement !== null) {
    document.head.removeChild(styleElement);

    currentCursorStyle = null;
    styleElement = null;
  }
}

function setGlobalCursorStyle(state: CursorState, constraintFlags: number) {
  const style = getCursorStyle(state, constraintFlags);

  if (currentCursorStyle === style) {
    return;
  }

  currentCursorStyle = style;

  if (styleElement === null) {
    styleElement = document.createElement('style');

    document.head.appendChild(styleElement);
  }

  styleElement.innerHTML = `*{cursor: ${style}!important;}`;
}
