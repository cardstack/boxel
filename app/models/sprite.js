export default class Sprite {
  element;
  id;
  type = null;
  initialBounds = null;
  finalBounds = null;
  counterpart = null; // the sent sprite if this is the received sprite, or vice versa

  constructor(element, id, type) {
    this.element = element;
    this.id = id;
    this.type = type;
  }

  lockStyles() {
    let bounds = this.initialBounds.relativeToContext;
    this.element.style.position = 'absolute';
    this.element.style.left = bounds.left + 'px';
    this.element.style.top = bounds.top + 'px';
  }
}

export const INSERTED = Symbol('inserted');
export const REMOVED = Symbol('removed');
export const KEPT = Symbol('kept');
export const SENT = Symbol('sent');
export const RECEIVED = Symbol('received');
