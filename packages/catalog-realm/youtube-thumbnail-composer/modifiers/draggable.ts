import Modifier from 'ember-modifier';

interface DragModifierSignature {
  Element: HTMLElement;
  Args: {
    Positional: [(x: number, y: number) => void, number, ((w: number, h: number) => void)?];
    Named: Record<string, never>;
  };
}

export class DragModifier extends Modifier<DragModifierSignature> {
  modify(
    element: HTMLElement,
    [onDrag, scaleRatio, onResize]: DragModifierSignature['Args']['Positional'],
  ) {
    if (typeof onDrag !== 'function') {
      console.warn('DragModifier: onDrag callback missing');
      return;
    }

    let isDragging = false;
    let isResizing = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;
    let initialWidth = 0;
    let initialHeight = 0;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // Check if clicking on resize handle
      if (target.classList.contains('resize-handle')) {
        if (!onResize) return;
        
        e.preventDefault();
        e.stopPropagation();
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;

        // Get current dimensions
        const computedStyle = window.getComputedStyle(element);
        initialWidth = parseFloat(computedStyle.width) / scaleRatio;
        initialHeight = parseFloat(computedStyle.height) / scaleRatio;

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return;
      }

      // Regular dragging
      e.stopPropagation();
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      // Get current position from element
      const left = parseFloat(element.style.left) || 0;
      const top = parseFloat(element.style.top) || 0;
      initialX = left / scaleRatio;
      initialY = top / scaleRatio;

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      element.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing && onResize) {
        const deltaX = (e.clientX - startX) / scaleRatio;
        const deltaY = (e.clientY - startY) / scaleRatio;

        const newWidth = Math.max(20, initialWidth + deltaX);
        const newHeight = Math.max(20, initialHeight + deltaY);

        onResize(newWidth, newHeight);
        return;
      }

      if (!isDragging) return;

      const deltaX = (e.clientX - startX) / scaleRatio;
      const deltaY = (e.clientY - startY) / scaleRatio;

      const newX = initialX + deltaX;
      const newY = initialY + deltaY;

      onDrag(newX, newY);
    };

    const handleMouseUp = () => {
      isDragging = false;
      isResizing = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      element.style.cursor = 'grab';
    };

    element.addEventListener('mousedown', handleMouseDown);

    // Return cleanup function
    return () => {
      element.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }
}