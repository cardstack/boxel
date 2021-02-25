export default class Sprite {
  changeset;
  spriteModifier;
  element;
  id;
  type = null;
  initialBounds = null;
  finalBounds = null;
  counterpart = null; // the sent sprite if this is the received sprite, or vice versa

  constructor(changeset, spriteModifier, type) {
    this.changeset = changeset;
    this.spriteModifier = spriteModifier;
    this.element = spriteModifier.element;
    this.id = spriteModifier.id;
    this.type = type;
  }

  lockStyles(bounds = this.initialBounds.relativeToContext) {
    this.element.style.position = 'absolute';
    this.element.style.left = bounds.left + 'px';
    this.element.style.top = bounds.top + 'px';
  }

  unlockStyles() {
    this.element.style.position = null;
    this.element.style.left = null;
    this.element.style.top = null;
  }
}

export const INSERTED = Symbol('inserted');
export const REMOVED = Symbol('removed');
export const KEPT = Symbol('kept');
export const SENT = Symbol('sent');
export const RECEIVED = Symbol('received');
