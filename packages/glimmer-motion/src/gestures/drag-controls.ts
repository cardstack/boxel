/**
 * Motion's DragControls (upstream's class, see framer-motion-internals.ts) and
 * the Glimmer stand-in for its `useDragControls()` hook.
 */
import { DragControls } from '../framer-motion-internals.ts';

export {
  type DragControlOptions,
  DragControls,
} from '../framer-motion-internals.ts';

/** Motion's useDragControls(): one DragControls per owner, created once */
export const createDragControls = (): DragControls => new DragControls();
