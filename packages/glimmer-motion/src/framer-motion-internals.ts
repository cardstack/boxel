/**
 * Motion's framework-free gesture, feature and Reorder modules, taken from
 * framer-motion's own build. framer-motion's exports map doesn't expose them,
 * so rollup.config.mjs resolves these paths into `framer-motion/dist/es` and
 * inlines the modules into glimmer-motion's dist: the published package
 * doesn't import them from framer-motion at runtime.
 *
 * framer-motion ships one rolled-up, React-typed declaration file for its
 * public API and none for these modules, so each import is untyped and the
 * part of its surface glimmer-motion uses is declared here, matching
 * framer-motion's source at the pinned version.
 */
/* eslint-disable no-redeclare -- each class below is a value with a same-named instance type, as a class declaration would be */
import {
  autoScrollIfNeeded as autoScrollIfNeededFn,
  resetAutoScrollState as resetAutoScrollStateFn,
  // @ts-expect-error not in framer-motion's exports map; resolved by rollup
} from 'framer-motion/dist/es/components/Reorder/utils/auto-scroll.mjs';
// @ts-expect-error not in framer-motion's exports map; resolved by rollup
import { checkReorder as checkReorderFn } from 'framer-motion/dist/es/components/Reorder/utils/check-reorder.mjs';
// @ts-expect-error not in framer-motion's exports map; resolved by rollup
import { detectAxis as detectAxisFn } from 'framer-motion/dist/es/components/Reorder/utils/detect-axis.mjs';
// @ts-expect-error not in framer-motion's exports map; resolved by rollup
import { DragGesture as dragGesture } from 'framer-motion/dist/es/gestures/drag/index.mjs';
// @ts-expect-error not in framer-motion's exports map; resolved by rollup
import { DragControls as dragControls } from 'framer-motion/dist/es/gestures/drag/use-drag-controls.mjs';
// @ts-expect-error not in framer-motion's exports map; resolved by rollup
import { VisualElementDragControls as visualElementDragControls } from 'framer-motion/dist/es/gestures/drag/VisualElementDragControls.mjs';
// @ts-expect-error not in framer-motion's exports map; resolved by rollup
import { FocusGesture as focusGesture } from 'framer-motion/dist/es/gestures/focus.mjs';
// @ts-expect-error not in framer-motion's exports map; resolved by rollup
import { HoverGesture as hoverGesture } from 'framer-motion/dist/es/gestures/hover.mjs';
// @ts-expect-error not in framer-motion's exports map; resolved by rollup
import { PanGesture as panGesture } from 'framer-motion/dist/es/gestures/pan/index.mjs';
// @ts-expect-error not in framer-motion's exports map; resolved by rollup
import { PressGesture as pressGesture } from 'framer-motion/dist/es/gestures/press.mjs';
// @ts-expect-error not in framer-motion's exports map; resolved by rollup
import { ExitAnimationFeature as exitAnimationFeature } from 'framer-motion/dist/es/motion/features/animation/exit.mjs';
// @ts-expect-error not in framer-motion's exports map; resolved by rollup
import { AnimationFeature as animationFeature } from 'framer-motion/dist/es/motion/features/animation/index.mjs';
// @ts-expect-error not in framer-motion's exports map; resolved by rollup
import { InViewFeature as inViewFeature } from 'framer-motion/dist/es/motion/features/viewport/index.mjs';
import type { Feature, VisualElement } from 'motion-dom';
import type { Box, Point } from 'motion-utils';

import type { ItemData, ReorderAxis } from './reorder/types.ts';

type FeatureClass = new (node: VisualElement) => Feature<unknown>;

export const AnimationFeature: FeatureClass = animationFeature;
export const ExitAnimationFeature: FeatureClass = exitAnimationFeature;
export const InViewFeature: FeatureClass = inViewFeature;
export const PanGesture: FeatureClass = panGesture;
export const FocusGesture: FeatureClass = focusGesture;
export const HoverGesture: FeatureClass = hoverGesture;
export const PressGesture: FeatureClass = pressGesture;

export interface DragControlOptions {
  /** The distance after which dragging starts and a direction is locked in. */
  distanceThreshold?: number;
  /** Whether to snap to the cursor immediately when dragging starts. */
  snapToCursor?: boolean;
}

/** The per-element drag state machine behind the drag feature. */
export interface VisualElementDragControls {
  addListeners(): () => void;
  cancel(): void;
  endPanSession(): void;
  isDragging: boolean;
  /**
   * Private upstream. Set by `start()` to the session it opens and cleared by
   * `endPanSession()`. The session's `end()` removes its listeners, and runs
   * on every pointerup.
   */
  panSession?: { end(): void };
  start(originEvent: PointerEvent, options?: DragControlOptions): void;
  stop(event?: PointerEvent): void;
}
export const VisualElementDragControls: new (
  visualElement: VisualElement<HTMLElement>,
) => VisualElementDragControls = visualElementDragControls;

export interface DragGesture extends Feature<HTMLElement> {
  controls: VisualElementDragControls;
  mount(): void;
  removeGroupControls(): void;
  removeListeners(): void;
  unmount(): void;
  update(): void;
}
export const DragGesture: new (
  node: VisualElement<HTMLElement>,
) => DragGesture = dragGesture;

/**
 * Start, stop or cancel a drag on every `motion` element given these controls
 * as `dragControls`, from a pointer event anywhere on the page.
 */
export interface DragControls {
  /** End the drag where it is: no momentum and no `onDragEnd`. */
  cancel(): void;
  /** Start a drag on every subscribed element, from `event`. */
  start(event: PointerEvent, options?: DragControlOptions): void;
  /** End the drag as a pointerup would: momentum, then `onDragEnd`. */
  stop(): void;
  /** Called by the drag feature of each element given these controls. */
  subscribe(controls: VisualElementDragControls): () => void;
}
export const DragControls: new () => DragControls = dragControls;

export const checkReorder: <T>(
  order: ItemData<T>[],
  value: T,
  offset: Point,
  velocity: Point,
  axis: ReorderAxis,
  direction?: 'ltr' | 'rtl',
) => ItemData<T>[] = checkReorderFn;

export const detectAxis: (layouts: Box[]) => ReorderAxis = detectAxisFn;

export const autoScrollIfNeeded: (
  groupElement: Element | null,
  pointerPosition: number,
  axis: 'x' | 'y',
  velocity: number,
) => void = autoScrollIfNeededFn;

export const resetAutoScrollState: () => void = resetAutoScrollStateFn;
