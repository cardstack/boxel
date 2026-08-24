/**
 * glimmer-motion — Motion's React glue re-done for Glimmer, on the unchanged motion-dom engine.
 * Deep imports (`glimmer-motion/motion`, `glimmer-motion/presence`, …) are the same modules.
 */
export { beacon } from './beacon.ts';
export type { ChoreoContext } from './choreo.gts';
export { Choreo } from './choreo.gts';
export type { BeaconRef } from './choreo/beacons.ts';
export type { Changeset } from './choreo/changeset.ts';
export { easeIn, easeInAndOut, easeOut } from './choreo/easings.ts';
export type {
  Bounds,
  Easing,
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
export type { InertiaArgs, SpringArgs, TweenArgs } from './helpers.ts';
export {
  ease,
  inertia,
  perValue,
  spring,
  stagger,
  start,
  styles,
  to,
  tween,
} from './helpers.ts';
export {
  afterSettle,
  instantLayoutTransition,
  layoutChange,
  layoutLoopDetected,
  requestSettle,
  resetLayoutLoopGuard,
  snapshotAll,
} from './layout.ts';
export {
  closestLayoutGroup,
  LayoutGroup,
  snapshotOnRender,
} from './layout-group.gts';
export type { MotionEl, MotionProps } from './motion.ts';
export { default as motion, MotionModifier } from './motion.ts';
export type { MotionConfigContext } from './motion-config.gts';
export { closestMotionConfig, MotionConfig } from './motion-config.gts';
export { flushPendingMounts, MotionNode } from './node.ts';
export { Presence } from './presence.gts';
export type { PresenceHandle } from './presence-types.ts';
export { ReorderGroup } from './reorder/group.gts';
export { ReorderItem } from './reorder/item.gts';
export type { ReorderAxis, ReorderContextProps } from './reorder/types.ts';
export { postRender, setPostRender } from './scheduler.ts';
export type {
  ScrollValues,
  UseInViewOptions,
  UseScrollOptions,
} from './scroll.ts';
export { InView, scrollProgress, useInView, useScroll } from './scroll.ts';
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
