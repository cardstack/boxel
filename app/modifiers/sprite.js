import Modifier from 'ember-modifier';

// cases:
// 1. Sprite added
// 2. Sprite removed
// 3. far matching
// 4. css change that doesn't result in an attribute change in the observed subtree?

export default class SpriteModifier extends Modifier {
  context = null;
  lastPosition = null;

  // lifecycle hooks
  didReceiveArguments() {
    // this.removeEventListener();
    // this.addEventListener();
    this.contextElement = this.element.closest('.animation-context');
    this.context = this.args.named.context;

    this.context.registerSprite(this);

    this.logPosition();
  }

  logPosition() {
    this.lastPosition = {
      parent: this.getDocumentPosition(this.contextElement),
      element: this.getDocumentPosition(this.element)
    };

    console.log('Logged position', this.lastPosition);
  }

  handleDomChange() {
    let previousPosition = this.lastPosition;

    this.logPosition();

    if (this.positionsIdentical(previousPosition, this.lastPosition)) {
      console.log('nothing changed');
    } else {
      console.log('something changed');
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
      top: rect.top + window.scrollY
    };
  }

  willRemove() {
    this.context.removeSprite(this);
  }
}
