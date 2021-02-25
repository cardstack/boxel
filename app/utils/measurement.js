import ContextAwareBounds from '../models/context-aware-bounds';

function runWithoutAnimations(element, f) {
  let animations = element.getAnimations();
  let currentTimes = [];
  animations.forEach((a) => {
    a.pause();
    currentTimes.push(a.currentTime);
    let timing = a.effect.getComputedTiming();
    a.currentTime = timing.delay + timing.activeDuration;
  });
  let result = f();
  for (let i = 0; i < animations.length; i++) {
    animations[i].currentTime = currentTimes[i];
    animations[i].play();
  }
  return result;
}

function getDocumentPosition(element, opts = { withAnimations: false }) {
  let wrapper = (_el, f) => f();
  if (opts.withAnimations === false) {
    wrapper = runWithoutAnimations;
  }
  return wrapper(element, () => {
    let rect = element.getBoundingClientRect();

    return {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
    };
  });
}

export function measure({ contextElement, element, withAnimations = false }) {
  return new ContextAwareBounds({
    element: getDocumentPosition(element, { withAnimations }),
    contextElement: getDocumentPosition(contextElement),
  });
}
