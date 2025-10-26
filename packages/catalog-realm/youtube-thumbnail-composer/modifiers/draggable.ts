import Modifier from 'ember-modifier';

interface DraggableModifierSignature {
  Element: HTMLElement;
  Args: {
    Positional: [
      (deltaX: number, deltaY: number) => void,
      (() => void)?,
      (() => void)?,
    ];
    Named: Record<string, never>;
  };
}

export default class DraggableModifier extends Modifier<DraggableModifierSignature> {
  modify(
    element: HTMLElement,
    [
      onDrag,
      onDragStart,
      onDragEnd,
    ]: DraggableModifierSignature['Args']['Positional'],
  ) {
    if (typeof onDrag !== 'function') {
      console.warn('DraggableModifier: onDrag callback missing');
      return;
    }

    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const handleMouseDown = (event: MouseEvent) => {
      // Only handle left mouse button
      if (event.button !== 0) {
        return;
      }

      isDragging = true;
      startX = event.clientX;
      startY = event.clientY;

      if (typeof onDragStart === 'function') {
        onDragStart();
      }

      event.preventDefault();
      event.stopPropagation();
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging) {
        return;
      }

      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;

      onDrag(deltaX, deltaY);

      startX = event.clientX;
      startY = event.clientY;
    };

    const handleMouseUp = () => {
      if (isDragging) {
        isDragging = false;
        if (typeof onDragEnd === 'function') {
          onDragEnd();
        }
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 0) {
        return;
      }

      isDragging = true;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;

      if (typeof onDragStart === 'function') {
        onDragStart();
      }

      event.preventDefault();
      event.stopPropagation();
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!isDragging || event.touches.length === 0) {
        return;
      }

      const deltaX = event.touches[0].clientX - startX;
      const deltaY = event.touches[0].clientY - startY;

      onDrag(deltaX, deltaY);

      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    };

    const handleTouchEnd = () => {
      if (isDragging) {
        isDragging = false;
        if (typeof onDragEnd === 'function') {
          onDragEnd();
        }
      }
    };

    // Add event listeners
    element.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    element.addEventListener('touchstart', handleTouchStart, {
      passive: false,
    });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd);

    // Set cursor style
    element.style.cursor = 'move';

    // Return cleanup function
    return () => {
      element.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }
}
