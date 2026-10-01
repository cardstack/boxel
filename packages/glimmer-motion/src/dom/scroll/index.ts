// @ts-nocheck — vendored verbatim from Motion's packages/framer-motion/src/render/dom/scroll/index.ts (motion@bbabb00)
import type { AnimationPlaybackControls } from 'motion-dom';
import { noop } from 'motion-utils';

import { attachToAnimation } from './attach-animation.ts';
import { attachToFunction } from './attach-function.ts';
import type { OnScroll, ScrollOptions } from './types.ts';

export function scroll(
  onScroll: OnScroll | AnimationPlaybackControls,
  {
    axis = 'y',
    container = document.scrollingElement as Element,
    ...options
  }: ScrollOptions = {},
): VoidFunction {
  if (!container) {
    return noop as VoidFunction;
  }

  const optionsWithDefaults = { axis, container, ...options };

  return typeof onScroll === 'function'
    ? attachToFunction(onScroll, optionsWithDefaults)
    : attachToAnimation(onScroll, optionsWithDefaults);
}
