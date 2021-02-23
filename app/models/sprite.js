export default class Sprite {
  element;
  id;
  type = null;
  initialBounds = null;
  finalBounds = null;

  constructor(element, id, type) {
    this.element = element;
    this.id = id;
    this.type = type;
  }
}

export const INSERTED = Symbol('inserted');
export const REMOVED = Symbol('removed');
export const KEPT = Symbol('kept');
export const SENT = Symbol('sent');
export const RECEIVED = Symbol('received');
