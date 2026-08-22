/**
 * glimmer-motion — Motion's React glue re-done for Glimmer, on the unchanged motion-dom engine.
 * Deep imports (`glimmer-motion/motion`, `glimmer-motion/presence`, …) are the same modules.
 */
export type { ChoreoContext } from './choreo.gts';
export { default as Choreo } from './choreo.gts';
export type { default as Changeset } from './choreo/changeset.ts';
export type {
  Bounds,
  Query,
  Rect,
  SpringSpec,
  Sprite,
} from './choreo/types.ts';
export { scroll } from './dom/scroll/index.ts';
export { scrollInfo } from './dom/scroll/track.ts';
export type {
  ScrollInfo,
  ScrollOffset,
  ScrollOptions,
} from './dom/scroll/types.ts';
export type { InViewOptions } from './dom/viewport.ts';
export { inView } from './dom/viewport.ts';
export { createDragControls, DragControls } from './gestures/drag-controls.ts';
export {
  correctParentTransform,
  transformViewBoxPoint,
} from './gestures/transform-page-point.ts';
export {
  afterSettle,
  instantLayoutTransition,
  layoutChange,
  requestSettle,
  snapshotAll,
} from './layout.ts';
export {
  closestLayoutGroup,
  default as LayoutGroup,
  snapshotOnRender,
} from './layout-group.gts';
export type { MotionEl, MotionProps } from './motion.ts';
export { default as motion } from './motion.ts';
export type { MotionConfigContext } from './motion-config.gts';
export {
  closestMotionConfig,
  default as MotionConfig,
} from './motion-config.gts';
export { flushPendingMounts, default as MotionNode } from './node.ts';
export { default as Presence } from './presence.gts';
export type { PresenceHandle } from './presence-types.ts';
export { default as ReorderGroup } from './reorder/group.gts';
export { default as ReorderItem } from './reorder/item.gts';
export type { ReorderAxis, ReorderContextProps } from './reorder/types.ts';
export { postRender, setPostRender } from './scheduler.ts';
export type {
  ScrollValues,
  UseInViewOptions,
  UseScrollOptions,
} from './scroll.ts';
export { InView, useInView, useScroll } from './scroll.ts';
export {
  motionSpeed,
  onMotionSpeed,
  scaleTransition,
  setMotionSpeed,
} from './speed.ts';
export type {
  ViewTransitionBuilder,
  ViewTransitionOptions,
  ViewTransitionUpdate,
} from './view-transition.ts';
export { animateView, viewTransition } from './view-transition.ts';
