import Modifier from 'ember-modifier';

interface DragRotateModifierSignature {
  Element: HTMLElement;
  Args: {
    Positional: [(deltaX: number) => void, (() => void)?];
    Named: Record<string, never>;
  };
}

export default class DragRotateModifier extends Modifier<DragRotateModifierSignature> {
  modify(
    element: HTMLElement,
    [onRotate, onDragStart]: DragRotateModifierSignature['Args']['Positional'],
  ) {
    if (typeof onRotate !== 'function') {
      console.warn('DragRotateModifier: onRotate callback missing');
      return;
    }

    let isDragging = false;
    let startX = 0;
    let cumulativeDeltaX = 0;

    const handleMouseDown = (event: MouseEvent) => {
      isDragging = true;
      startX = event.clientX;
      cumulativeDeltaX = 0;
      if (typeof onDragStart === 'function') {
        onDragStart();
      }
      event.preventDefault();
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging) {
        return;
      }

      const deltaX = event.clientX - startX;
      cumulativeDeltaX += deltaX;
      startX = event.clientX;
      onRotate(cumulativeDeltaX);
    };

    const handleMouseUp = () => {
      isDragging = false;
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 0) {
        return;
      }
      isDragging = true;
      startX = event.touches[0].clientX;
      cumulativeDeltaX = 0;
      if (typeof onDragStart === 'function') {
        onDragStart();
      }
      event.preventDefault();
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!isDragging || event.touches.length === 0) {
        return;
      }

      const deltaX = event.touches[0].clientX - startX;
      cumulativeDeltaX += deltaX;
      startX = event.touches[0].clientX;
      onRotate(cumulativeDeltaX);
    };

    const handleTouchEnd = () => {
      isDragging = false;
    };

    element.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    element.addEventListener('touchstart', handleTouchStart, {
      passive: false,
    });
    element.addEventListener('touchmove', handleTouchMove);
    element.addEventListener('touchend', handleTouchEnd);

    // Return cleanup function - Ember will call this automatically
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
