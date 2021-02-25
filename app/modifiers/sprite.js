import Modifier from 'ember-modifier';
import ContextAwareBounds from '../models/context-aware-bounds';
// import DOMMatrix from 'geometry-interfaces/DOMMatrix';

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
function getTranslateXY(element) {
  const style = window.getComputedStyle(element);
  const matrix = new DOMMatrixReadOnly(style.transform);
  return {
    translateX: matrix.m42,
    translateY: matrix.m41,
  };
}
function getDocumentPosition(element) {
  // return withoutAnimations(element, () => {
  // let animations = element.getAnimations();

  let rect = element.getBoundingClientRect();

  return {
    left: rect.left + window.scrollX,
    top: rect.top + window.scrollY,
  };
  // });
}

function buildPosition({
  contextElement,
  element,
  lastBounds,
  currentBounds,
  id,
  context,
  context: { changeset },
}) {
  if (changeset && changeset.isAnimating && currentBounds) {
    let {
      element: { left, top },
    } = currentBounds;
    let { translateX, translateY } = getTranslateXY(element);
    // console.log('before', lastBounds);
    // changeset.pause();
    // console.log('after', lastBounds);
    // debugger;

    let bounds = new ContextAwareBounds({
      element: {
        left: left - translateX,
        top: top + translateY,
      },
      contextElement: getDocumentPosition(contextElement),
    });

    return bounds;
  }
  return new ContextAwareBounds({
    element: getDocumentPosition(element),
    contextElement: getDocumentPosition(contextElement),
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
    this.currentBounds = buildPosition(this);
  }

  checkForChanges() {
    this.trackPosition();
    return !this.currentBounds.isEqualTo(this.lastBounds);
  }

  willRemove() {
    this.context.unregister(this);
  }
}
