import Modifier from 'ember-modifier';

interface DragRotateModifierSignature {
  Element: HTMLElement;
  Args: {
    Positional: [(deltaX: number) => void];
    Named: Record<string, never>;
  };
}

export default class DragRotateModifier extends Modifier<DragRotateModifierSignature> {
  modify(
    element: HTMLElement,
    [onRotate]: DragRotateModifierSignature['Args']['Positional'],
  ) {
    if (typeof onRotate !== 'function') {
      console.warn('DragRotateModifier: onRotate callback missing');
      return;
    }

    let isDragging = false;
    let startX = 0;

    const handleMouseDown = (event: MouseEvent) => {
      isDragging = true;
      startX = event.clientX;
      event.preventDefault();
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging) {
        return;
      }

      const deltaX = event.clientX - startX;
      startX = event.clientX;
      onRotate(deltaX);
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
      event.preventDefault();
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!isDragging || event.touches.length === 0) {
        return;
      }

      const deltaX = event.touches[0].clientX - startX;
      startX = event.touches[0].clientX;
      onRotate(deltaX);
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
