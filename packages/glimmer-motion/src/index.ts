/**
 * glimmer-motion — Motion's React glue re-done for Glimmer, on the unchanged motion-dom engine.
 * Deep imports (`glimmer-motion/motion`, `glimmer-motion/presence`, …) are the same modules.
 */
export { beacon } from './beacon.ts';
export type { ChoreoContext } from './choreo.gts';
export { Choreo } from './choreo.gts';
export type { AnchorRef } from './choreo/anchors.ts';
export { after, at } from './choreo/anchors.ts';
export type { Arming, ArmingOptions, ArmingRegion } from './choreo/arming.ts';
export { createArming } from './choreo/arming.ts';
export type { BeaconRef } from './choreo/beacons.ts';
export type { Changeset } from './choreo/changeset.ts';
export { easeIn, easeInAndOut, easeOut } from './choreo/easings.ts';
export type { GestureRef } from './choreo/gesture.ts';
export {
  type ChoreoHost,
  choreoHostAt,
  choreoHostById,
  type ChoreoProvider,
  closestChoreo,
} from './choreo/registry.ts';
export type { ChoreoRun } from './choreo/run.ts';
export type { PlanePoint } from './choreo/space.ts';
export { appliedCamera, toLocal, toPage } from './choreo/space.ts';
export type { StepArgs, StepArgsBase } from './choreo/steps.gts';
export { StepComponent, toMs } from './choreo/steps.gts';
export type {
  Block,
  Bounds,
  Camera3DState,
  Camera3DWaypoint,
  CameraState,
  DeliveryBy,
  DeliveryOrder,
  DeriveContext,
  Easing,
  FollowSource,
  GateNode,
  PerformCommand,
  PropSource,
  PropValue,
  Query,
  Rect,
  SpringSpec,
  Sprite,
  Step,
  TimelineNode,
} from './choreo/types.ts';
export { Film } from './film.ts';
export type {
  Beat as FilmBeat,
  Cam as FilmCam,
  Chapter as FilmChapter,
  FilmClock,
  FilmGrade,
  FilmHandle,
  Join as FilmJoin,
  Picture as FilmPicture,
} from './film/types.ts';
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
export type {
  MotionParticipant,
  ParticipantArgs,
  ParticipantHost,
} from './participant.ts';
export {
  closestParticipantHost,
  defineParticipantArg,
  PARTICIPANT_HOST_ATTRIBUTE,
  setParticipantHost,
} from './participant.ts';
export { Presence } from './presence.gts';
export type { PresenceHandle } from './presence-types.ts';
export { ReorderGroup } from './reorder/group.gts';
export { ReorderItem } from './reorder/item.gts';
export type { ReorderAxis, ReorderContextProps } from './reorder/types.ts';
export { postRender, setPostRender } from './scheduler.ts';
export type {
  InViewOptions,
  ScrollInfo,
  ScrollOffset,
  ScrollOptions,
  ScrollValues,
  UseInViewOptions,
  UseScrollOptions,
} from './scroll.ts';
export {
  InView,
  inView,
  scroll,
  scrollInfo,
  scrollProgress,
  useInView,
  useScroll,
} from './scroll.ts';
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
// The engine's imperative surface, curated: realm cards reach motion-dom only
// through these names, so each one is glimmer-motion API under semver. They are
// the engine's own functions, not copies, so they share its frame loop with
// `{{motion}}`. `animate` is the same function the `motion` package exports.
export { animate } from 'framer-motion/dom';
export {
  frame,
  type MotionValue,
  motionValue,
  styleEffect,
  transformValue,
} from 'motion-dom';
