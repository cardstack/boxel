import Modifier from 'ember-modifier';
import ContextAwarePosition from '../models/context-aware-position';
// cases:
// 1. Sprite added
// 2. Sprite removed
// 3. far matching
// 4. css change that doesn't result in an attribute change in the observed subtree?

function buildPosition(parentElement, element) {
  function getDocumentPosition(element) {
    let rect = element.getBoundingClientRect();

    return {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
    };
  }
  return new ContextAwarePosition({
    element: getDocumentPosition(element),
    contextElement: getDocumentPosition(parentElement),
  });
}
export default class SpriteModifier extends Modifier {
  id = null;
  context = null;
  lastPosition = null;
  currentPosition = null;
  farMatch = null; // Gets set to the "received" sprite modifier when this is becoming a "sent" sprite

  didReceiveArguments() {
    this.contextElement = this.element.closest('.animation-context');
    this.context = this.args.named.context;
    this.id = this.args.named.id;

    this.context.register(this);

    this.trackPosition();
  }

  trackPosition() {
    this.lastPosition = this.currentPosition;
    this.currentPosition = buildPosition(this.contextElement, this.element);
  }

  checkForChanges() {
    this.trackPosition();
    return !this.currentPosition.isEqualTo(this.lastPosition);
  }

  willRemove() {
    this.context.unregister(this);
  }
}
