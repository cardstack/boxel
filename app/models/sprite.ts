import ContextAwareBounds, { Position } from './context-aware-bounds';

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

  lockStyles(bounds: Position | null = null): void {
    if (!bounds) {
      if (this.initialBounds) {
        bounds = this.initialBounds.relativeToContext;
      } else {
        bounds = { left: 0, top: 0 };
      }
    }
    this.element.style.position = 'absolute';
    this.element.style.left = bounds.left + 'px';
    this.element.style.top = bounds.top + 'px';
  }

  unlockStyles(): void {
    this.element.style.removeProperty('position');
    this.element.style.removeProperty('left');
    this.element.style.removeProperty('top');
  }
}

export enum SpriteType {
  Inserted = 'inserted',
  Removed = 'removed',
  Kept = 'kept',
  Sent = 'sent',
  Received = 'received',
}
