import ContextAwareBounds, { Bounds } from './context-aware-bounds';

export default class Sprite {
  element: HTMLElement;
  id: string | null;
  type: SpriteType | null = null;
  initialBounds: ContextAwareBounds | undefined;
  finalBounds: ContextAwareBounds | undefined;
  counterpart: Sprite | null = null; // the sent sprite if this is the received sprite, or vice versa

  constructor(
    element: HTMLElement,
    id: string | null,
    type: SpriteType | null
  ) {
    this.element = element;
    this.id = id;
    this.type = type;
  }

  lockStyles(bounds: Bounds | null = null): void {
    if (!bounds) {
      if (this.initialBounds) {
        bounds = this.initialBounds.relativeToContext;
      } else {
        bounds = { left: 0, top: 0, width: 0, height: 0 };
      }
    }
    this.element.style.position = 'absolute';
    this.element.style.left = bounds.left + 'px';
    this.element.style.top = bounds.top + 'px';
    if (bounds.width) {
      this.element.style.width = bounds.width + 'px';
    }
    if (bounds.height) {
      this.element.style.height = bounds.height + 'px';
    }
  }

  unlockStyles(): void {
    this.element.style.removeProperty('position');
    this.element.style.removeProperty('left');
    this.element.style.removeProperty('top');
    this.element.style.removeProperty('width');
    this.element.style.removeProperty('height');
  }
}

export enum SpriteType {
  Inserted = 'inserted',
  Removed = 'removed',
  Kept = 'kept',
}
