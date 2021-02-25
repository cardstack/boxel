import Modifier from 'ember-modifier';
import ContextAwareBounds from '../models/context-aware-bounds';
// cases:
// 1. Sprite added
// 2. Sprite removed
// 3. far matching
// 4. css change that doesn't result in an attribute change in the observed subtree?

function withoutAnimations(element, f) {
  let animations = element.getAnimations();
  let currentTimes = [];
  animations.forEach((a) => {
    a.pause();
    currentTimes.push(a.currentTime);
    a.currentTime =
      a.effect.getComputedTiming().delay +
      a.effect.getComputedTiming().activeDuration;
  });
  let result = f();
  for (let i = 0; i < animations.length; i++) {
    animations[i].currentTime = currentTimes[i];
    animations[i].play();
  }
  return result;
}

function buildPosition(parentElement, element) {
  function getDocumentPosition(element) {
    return withoutAnimations(element, () => {
      let rect = element.getBoundingClientRect();

      return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
      };
    });
  }
  return new ContextAwareBounds({
    element: getDocumentPosition(element),
    contextElement: getDocumentPosition(parentElement),
  });
}
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
    this.currentBounds = buildPosition(this.contextElement, this.element);
  }

  checkForChanges() {
    this.trackPosition();
    return !this.currentBounds.isEqualTo(this.lastBounds);
  }

  willRemove() {
    this.context.unregister(this);
  }
}
