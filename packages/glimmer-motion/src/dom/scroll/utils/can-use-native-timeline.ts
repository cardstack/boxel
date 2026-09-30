// @ts-nocheck — vendored verbatim from Motion's packages/framer-motion/src/render/dom/scroll/utils/can-use-native-timeline.ts (motion@bbabb00)
import { supportsScrollTimeline, supportsViewTimeline } from 'motion-dom';

export function canUseNativeTimeline(target?: Element) {
  if (typeof window === 'undefined') {
    return false;
  }
  return target ? supportsViewTimeline() : supportsScrollTimeline();
}
