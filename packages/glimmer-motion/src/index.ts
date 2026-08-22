/**
 * glimmer-motion — Motion's React glue re-done for Glimmer, on the unchanged motion-dom engine.
 * Deep imports (`glimmer-motion/motion`, `glimmer-motion/presence`, …) are the same modules.
 */
export { default as motion } from './motion';
export type { MotionProps, MotionEl } from './motion';
export { default as MotionNode, flushPendingMounts } from './node';
export { default as Presence } from './presence';
export type { PresenceHandle } from './presence-types';
export { default as LayoutGroup, closestLayoutGroup, snapshotOnRender } from './layout-group';
export { default as ReorderGroup } from './reorder/group';
export { default as ReorderItem } from './reorder/item';
export type { ReorderAxis, ReorderContextProps } from './reorder/types';
export { layoutChange, instantLayoutTransition, requestSettle, afterSettle, snapshotAll } from './layout';
export { createDragControls, DragControls } from './gestures/DragControls';
export { correctParentTransform, transformViewBoxPoint } from './gestures/transform-page-point';
export { postRender, setPostRender } from './scheduler';
