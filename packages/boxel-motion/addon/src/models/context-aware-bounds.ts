import { type BoundsVelocity } from '../utils/measurement.ts';

type ContextAwareBoundsConstructorArgs = {
  contextElement?: DOMRect;
  element: DOMRect;
  parent?: DOMRect;
};

export interface Position {
  left: number;
  top: number;
}
export type Bounds = {
  height: number;
  left: number;
  top: number;
  width: number;
};
export type BoundsDelta = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export default class ContextAwareBounds {
  element: DOMRectReadOnly;
  context: DOMRectReadOnly | undefined;
  parent: DOMRectReadOnly | undefined;
  velocity: BoundsVelocity = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };

  constructor({
    element,
    contextElement,
    parent,
  }: ContextAwareBoundsConstructorArgs) {
    this.element = DOMRectReadOnly.fromRect(element);
    if (contextElement) {
      this.context = DOMRectReadOnly.fromRect(contextElement);
    }
    if (parent) {
      this.parent = DOMRectReadOnly.fromRect(parent);
    }
  }

  within({
    parent,
    contextElement,
  }: Pick<ContextAwareBoundsConstructorArgs, 'contextElement' | 'parent'>) {
    return new ContextAwareBounds({
      element: this.element,
      parent,
      contextElement,
    });
  }

  get relativeToContext(): DOMRect {
    if (!this.context) {
      throw new Error('context not yet set on ContextAwareBounds');
    }
    let { element, context } = this;
    return new DOMRect(
      element.left - context.left,
      element.top - context.top,
      element.width,
      element.height,
    );
  }

  get relativeToParent(): DOMRect {
    let { element, parent } = this;

    if (!parent) {
      throw new Error('Could not access parent DOMRect in relativeToParent');
    }

    return new DOMRect(
      element.left - parent.left,
      element.top - parent.top,
      element.width,
      element.height,
    );
  }

  relativeToPosition({ left, top }: Position): DOMRect {
    let { element } = this;
    return new DOMRect(
      this.element.left - left,
      this.element.top - top,
      element.width,
      element.height,
    );
  }
}
