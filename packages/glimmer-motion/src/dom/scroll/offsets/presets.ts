// @ts-nocheck — vendored verbatim from Motion's packages/framer-motion/src/render/dom/scroll/offsets/presets.ts (motion@bbabb00)
import type { ProgressIntersection } from '../types.ts';

export const ScrollOffset: Record<string, ProgressIntersection[]> = {
  Enter: [
    [0, 1],
    [1, 1],
  ],
  Exit: [
    [0, 0],
    [1, 0],
  ],
  Any: [
    [1, 0],
    [0, 1],
  ],
  All: [
    [0, 0],
    [1, 1],
  ],
};
