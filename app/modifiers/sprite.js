import Modifier from 'ember-modifier';

// cases:
// 1. Sprite added
// 2. Sprite removed
// 3. far matching
// 4. css change that doesn't result in an attribute change in the observed subtree?

class ContextAwarePosition {
  constructor({ parent, element }) {
    this.parent = parent;
    this.element = element;
  }
  // TODO: getter to calculate element position offets by parent top/left
}
export default class SpriteModifier extends Modifier {
  id = null;
  context = null;
  lastPosition = null;
  currentPosition = null;

  didReceiveArguments() {
    this.contextElement = this.element.closest('.animation-context');
    this.context = this.args.named.context;
    this.id = this.args.named.id;

    this.context.register(this);

    this.trackPosition();
  }

  trackPosition() {
    this.lastPosition = this.currentPosition;
    this.currentPosition = {
      parent: this.getDocumentPosition(this.contextElement),
      element: this.getDocumentPosition(this.element),
    };
    console.log(`Positions updated Sprite ${this.id}`, {
      last: this.lastPosition && this.lastPosition.element.top,
      current: this.currentPosition && this.currentPosition.element.top,
    });
  }

  checkForChanges() {
    this.trackPosition();

    if (this.positionsIdentical(this.lastPosition, this.currentPosition)) {
      return false;
    } else {
      return true;
    }
  }

  positionsIdentical(a, b) {
    let parentLeftChange = b.parent.left - a.parent.left;
    let parentTopChange = b.parent.top - a.parent.top;

    return (
      b.element.left - a.element.left - parentLeftChange === 0 &&
      b.element.top - a.element.top - parentTopChange === 0
    );
  }

  getDocumentPosition(element) {
    let rect = element.getBoundingClientRect();

    return {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
    };
  }

  willRemove() {
    this.context.unregister(this);
  }
}
