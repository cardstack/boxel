import Modifier from 'ember-modifier';
import { measure } from '../utils/measurement';

export default class SpriteModifier extends Modifier {
  id = null;
  context = null;
  lastBounds = null;
  currentBounds = null;
  farMatch = null; // Gets set to the "received" sprite modifier when this is becoming a "sent" sprite

  didReceiveArguments() {
    this.contextElement = this.element.closest('.animation-context');
    this.context = this.args.named.context;
    this.id = this.args.named.id;

    this.context.register(this);

    this.trackPosition();
  }

  trackPosition() {
    this.lastBounds = this.currentBounds;
    this.currentBounds = measure({
      contextElement: this.contextElement,
      element: this.element,
    });
  }

  checkForChanges() {
    this.trackPosition();
    return !this.currentBounds.isEqualTo(this.lastBounds);
  }

  willRemove() {
    this.context.unregister(this);
  }
}
