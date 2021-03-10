type ContextAwareBoundsConstructorArgs = {
  element: DOMRect;
  contextElement: DOMRect;
};

export interface Position {
  left: number;
  top: number;
}
export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export default class ContextAwareBounds {
  element: DOMRect;
  parent: DOMRect;

  constructor({ element, contextElement }: ContextAwareBoundsConstructorArgs) {
    this.element = element;
    this.parent = contextElement;
  }

  get relativeToContext(): DOMRect {
    let { element, parent } = this;
    return new DOMRect(
      element.left - parent.left,
      element.top - parent.top,
      element.width,
      element.height
    );
  }

  relativeToPosition({ left, top }: Position): DOMRect {
    let { element } = this;
    return new DOMRect(
      this.element.left - left,
      this.element.top - top,
      element.width,
      element.height
    );
  }

  isEqualTo(other: ContextAwareBounds): boolean {
    let parentLeftChange = other.parent.left - this.parent.left;
    let parentTopChange = other.parent.top - this.parent.top;

    return (
      other.element.left - this.element.left - parentLeftChange === 0 &&
      other.element.top - this.element.top - parentTopChange === 0 &&
      other.element.width - this.element.width === 0 &&
      other.element.height - this.element.height === 0
    );
  }
}
