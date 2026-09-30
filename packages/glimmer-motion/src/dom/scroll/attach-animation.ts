// @ts-nocheck — vendored verbatim from Motion's packages/framer-motion/src/render/dom/scroll/attach-animation.ts (motion@bbabb00)
import type { AnimationPlaybackControls } from 'motion-dom';
import { observeTimeline } from 'motion-dom';

import type { ScrollOptionsWithDefaults } from './types.ts';
import { canUseNativeTimeline } from './utils/can-use-native-timeline.ts';
import { getTimeline } from './utils/get-timeline.ts';
import { offsetToViewTimelineRange } from './utils/offset-to-range.ts';

export function attachToAnimation(
  animation: AnimationPlaybackControls,
  options: ScrollOptionsWithDefaults,
) {
  const timeline = getTimeline(options);

  const range = options.target
    ? offsetToViewTimelineRange(options.offset)
    : undefined;

  /**
   * Use native timeline when:
   * - No target: ScrollTimeline (existing behaviour)
   * - Target with mappable offset: ViewTimeline with named range
   * - Target with unmappable offset: fall back to JS observe
   */
  const useNative = options.target
    ? canUseNativeTimeline(options.target) && !!range
    : canUseNativeTimeline();

  return animation.attachTimeline({
    timeline: useNative ? timeline : undefined,
    ...(range &&
      useNative && {
        rangeStart: range.rangeStart,
        rangeEnd: range.rangeEnd,
      }),
    observe: (valueAnimation) => {
      valueAnimation.pause();

      return observeTimeline((progress) => {
        valueAnimation.time = valueAnimation.iterationDuration * progress;
      }, timeline);
    },
  });
}
