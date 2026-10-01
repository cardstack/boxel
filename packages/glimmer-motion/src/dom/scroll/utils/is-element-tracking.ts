// @ts-nocheck — vendored verbatim from Motion's packages/framer-motion/src/render/dom/scroll/utils/is-element-tracking.ts (motion@bbabb00)
import type { ScrollOptionsWithDefaults } from '../types.ts';

/**
 * Currently, we only support element tracking with `scrollInfo`, though in
 * the future we can also offer ViewTimeline support.
 */
export function isElementTracking(options?: ScrollOptionsWithDefaults) {
  return options && (options.target || options.offset);
}
