import Modifier from 'ember-modifier';

type ColorCanvasDragNamedArgs = {
  onDragStart?: (event: MouseEvent) => void;
  onDragMove?: (event: MouseEvent) => void;
  onDragEnd?: (event: MouseEvent) => void;
  disabled?: boolean;
};

export default class ColorCanvasDragModifier extends Modifier<{
  Element: HTMLElement;
  Args: { Named: ColorCanvasDragNamedArgs };
}> {
  private element: HTMLElement | null = null;
  private args: ColorCanvasDragNamedArgs = {};
  private isDragging = false;
  private interactiveSelector =
    'button, input, textarea, select, [role="button"], [role="menuitem"], [role="combobox"], [role="textbox"], [data-color-canvas-ignore-drag]';

  private shouldIgnoreEvent(event: MouseEvent): boolean {
    const target =
      event.target instanceof HTMLElement ? event.target : this.element;

    if (!target) {
      return false;
    }

    if (target.isContentEditable) {
      return true;
    }

    if (target.closest(this.interactiveSelector)) {
      return true;
    }

    return false;
  }

  private mouseDownHandler = (event: MouseEvent) => {
    if (this.args.disabled || this.shouldIgnoreEvent(event)) {
      return;
    }

    // Only handle left mouse button
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    this.isDragging = true;

    // Trigger initial interaction
    this.args.onDragStart?.(event);

    // Add window-level listeners for drag (like React code)
    window.addEventListener('mousemove', this.mouseMoveHandler);
    window.addEventListener('mouseup', this.mouseUpHandler);
  };

  private mouseMoveHandler = (event: MouseEvent) => {
    if (!this.isDragging || this.args.disabled) {
      return;
    }

    event.preventDefault();
    this.args.onDragMove?.(event);
  };

  private mouseUpHandler = (event: MouseEvent) => {
    if (!this.isDragging) {
      return;
    }

    event.preventDefault();
    this.isDragging = false;

    this.args.onDragEnd?.(event);

    // Clean up window listeners
    window.removeEventListener('mousemove', this.mouseMoveHandler);
    window.removeEventListener('mouseup', this.mouseUpHandler);
  };

  modify(
    element: HTMLElement,
    _positional: never[],
    named: ColorCanvasDragNamedArgs,
  ) {
    this.args = named;

    if (this.element !== element) {
      this.cleanupElement();
      this.element = element;
    }

    this.bindElementListeners();

    if (this.args.disabled) {
      this.stopDrag();
    }
  }

  private bindElementListeners() {
    if (!this.element) {
      return;
    }

    this.element.removeEventListener('mousedown', this.mouseDownHandler);

    if (this.args.disabled) {
      return;
    }

    this.element.addEventListener('mousedown', this.mouseDownHandler);
  }

  private stopDrag() {
    if (!this.isDragging) {
      return;
    }

    this.isDragging = false;
    window.removeEventListener('mousemove', this.mouseMoveHandler);
    window.removeEventListener('mouseup', this.mouseUpHandler);
  }

  private cleanupElement() {
    if (!this.element) {
      return;
    }

    this.element.removeEventListener('mousedown', this.mouseDownHandler);
  }

  willDestroy() {
    this.cleanupElement();
    this.stopDrag();
  }
}
