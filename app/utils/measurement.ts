import { assert } from '@ember/debug';

export type MeasuredSpeed = number; // pixels per second
export type BoundsVelocity = {
  x: MeasuredSpeed;
  y: MeasuredSpeed;
  width: MeasuredSpeed;
  height: MeasuredSpeed;
};

function runWithoutAnimations(element: HTMLElement, f: () => DOMRect) {
  let animations = element.getAnimations();
  let currentTimes: number[] = [];
  animations.forEach((a) => {
    a.pause();
    currentTimes.push(a.currentTime || 0);
    let timing = a.effect && a.effect.getComputedTiming();
    if (timing) {
      a.currentTime = (timing.delay || 0) + (timing.activeDuration || 0);
    }
  });
  let result = f();
  for (let i = 0; i < animations.length; i++) {
    animations[i].currentTime = currentTimes[i];
    animations[i].play();
  }
  return result;
}

function runWithAnimations(element: HTMLElement, f: () => DOMRect) {
  let animations = element.getAnimations();
  animations.forEach((a) => {
    a.pause();
  });
  let result = f();
  for (let i = 0; i < animations.length; i++) {
    animations[i].play();
  }
  return result;
}

function runWithAnimationOffset(offset: number) {
  return function (element: HTMLElement, f: () => DOMRect) {
    let animations = element.getAnimations();
    let currentTimes: number[] = [];
    animations.forEach((a) => {
      a.pause();
      currentTimes.push(a.currentTime || 0);
      let timing = a.effect && a.effect.getComputedTiming();
      if (timing) {
        a.currentTime = (timing.localTime || 0) + offset;
      }
    });
    let result = f();
    for (let i = 0; i < animations.length; i++) {
      animations[i].currentTime = currentTimes[i];
      animations[i].play();
    }
    return result;
  };
}

type DocumentPositionArgs = {
  withAnimations: boolean;
  withAnimationOffset: number;
};
export function getDocumentPosition(
  element: HTMLElement,
  opts: Partial<DocumentPositionArgs> = {
    withAnimations: false,
    withAnimationOffset: undefined,
  }
): DOMRect {
  let wrapper = (_el: HTMLElement, f: () => DOMRect) => f();
  assert(
    'cannot set withAnimations true and withAnimationOffset',
    !(opts.withAnimations && opts.withAnimationOffset)
  );
  if (opts.withAnimations === false) {
    wrapper = runWithoutAnimations;
  } else {
    wrapper = runWithAnimations;
  }
  if (opts.withAnimationOffset) {
    wrapper = runWithAnimationOffset(opts.withAnimationOffset);
  }
  return wrapper(element, () => {
    let rect = element.getBoundingClientRect();

    return new DOMRect(
      rect.left + window.scrollX,
      rect.top + window.scrollY,
      rect.width,
      rect.height
    );
  });
}

export function calculateBoundsVelocity(
  startBounds: DOMRect,
  endBounds: DOMRect,
  diffMs: number
): BoundsVelocity {
  let seconds = diffMs / 1000;
  return {
    x: (endBounds.x - startBounds.x) / seconds,
    y: (endBounds.y - startBounds.y) / seconds,
    width: (endBounds.width - startBounds.width) / seconds,
    height: (endBounds.height - startBounds.height) / seconds,
  };
}

// getComputedStyle returns a *live* CSSStyleDeclaration that will
// keep changing as the element changes. So we use this to copy off a
// snapshot of the properties we potentially care about.
export function copyComputedStyle(element: Element): CopiedCSS {
  let computed = getComputedStyle(element);
  let output = new CopiedCSS();
  for (let property of COPIED_CSS_PROPERTIES) {
    output[property as keyof CopiedCSS] = computed.getPropertyValue(property);
  }
  return output;
}

export class CopiedCSS {
  'opacity': string;
  'font-size': string;
  'font-family': string;
  'font-weight': string;
  'color': string;
  'background-color': string;
  'border-color': string;
  'letter-spacing': string;
  'line-height': string;
  'text-align': string;
  'text-transform': string;
  'padding': string;
  'padding-top': string;
  'padding-bottom': string;
  'padding-left': string;
  'padding-right': string;
  'border-radius': string;
  'border-top-left-radius': string;
  'border-top-right-radius': string;
  'border-bottom-left-radius': string;
  'border-bottom-right-radius': string;
  'box-shadow': string;
  [k: string]: string;
}

export const COPIED_CSS_PROPERTIES = Object.keys(new CopiedCSS());
