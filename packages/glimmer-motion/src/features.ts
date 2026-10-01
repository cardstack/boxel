/**
 * The features the React layer contributes on top of the motion-dom engine (animation, exit, the gestures).
 * The feature classes are framer-motion's own (see framer-motion-internals.ts), with drag subclassed in
 * gestures/drag-gesture.ts. Everything else — springs, keyframes, variants, projection (layout / layoutId) —
 * lives in the engine.
 */
import type { MotionNodeOptions } from 'motion-dom';
import {
  addScaleCorrector,
  correctBorderRadius,
  correctBoxShadow,
  HTMLProjectionNode,
  setFeatureDefinitions,
} from 'motion-dom';

import {
  AnimationFeature,
  ExitAnimationFeature,
  FocusGesture,
  HoverGesture,
  InViewFeature,
  PanGesture,
  PressGesture,
} from './framer-motion-internals.ts';
import { GlimmerDragGesture } from './gestures/drag-gesture.ts';

const featureProps: Record<string, (keyof MotionNodeOptions)[]> = {
  animation: [
    'animate',
    'variants',
    'whileHover',
    'whileTap',
    'exit',
    'whileInView',
    'whileFocus',
    'whileDrag',
  ],
  exit: ['exit'],
  layout: ['layout', 'layoutId'],
  drag: ['drag', 'dragControls'],
  pan: ['onPan', 'onPanStart', 'onPanSessionStart', 'onPanEnd'],
  focus: ['whileFocus'],
  hover: ['whileHover', 'onHoverStart', 'onHoverEnd'],
  tap: ['whileTap', 'onTap', 'onTapStart', 'onTapCancel'],
  inView: ['whileInView', 'onViewportEnter', 'onViewportLeave'],
};
const isEnabled =
  (names: (keyof MotionNodeOptions)[]) => (props: MotionNodeOptions) =>
    names.some((n) => !!props[n]);

let initialized = false;
export function initFeatures() {
  if (initialized) {
    return;
  }
  initialized = true;
  // React registers these alongside MeasureLayout; without them a projecting
  // element's corners and shadow are stretched by whatever scale the layout
  // animation is applying — a square tile becoming a wide hero comes out with
  // oval corners, worst on a narrow viewport where the scale is most extreme.
  // The correction is per-frame, and it only reaches values the element
  // actually has: a radius that lives in the stylesheet is invisible to it, so
  // an element that wants round corners through a layout animation sets them
  // through the modifier (`style=(styles borderRadius='18px')`).
  addScaleCorrector({
    borderRadius: {
      ...correctBorderRadius,
      applyTo: [
        'borderTopLeftRadius',
        'borderTopRightRadius',
        'borderBottomLeftRadius',
        'borderBottomRightRadius',
      ],
    },
    borderTopLeftRadius: correctBorderRadius,
    borderTopRightRadius: correctBorderRadius,
    borderBottomLeftRadius: correctBorderRadius,
    borderBottomRightRadius: correctBorderRadius,
    boxShadow: correctBoxShadow,
  });
  setFeatureDefinitions({
    animation: {
      isEnabled: isEnabled(featureProps['animation']!),
      Feature: AnimationFeature as any,
    },
    exit: {
      isEnabled: isEnabled(featureProps['exit']!),
      Feature: ExitAnimationFeature as any,
    },
    layout: {
      isEnabled: isEnabled(featureProps['layout']!),
      ProjectionNode: HTMLProjectionNode as any,
    },
    drag: {
      isEnabled: isEnabled(featureProps['drag']!),
      Feature: GlimmerDragGesture as any,
      ProjectionNode: HTMLProjectionNode as any,
    },
    pan: {
      isEnabled: isEnabled(featureProps['pan']!),
      Feature: PanGesture as any,
    },
    // gestures (hover / press / focus / in-view): Motion's feature classes over the engine's hover() / press()
    hover: {
      isEnabled: isEnabled(featureProps['hover']!),
      Feature: HoverGesture as any,
    },
    tap: {
      isEnabled: isEnabled(featureProps['tap']!),
      Feature: PressGesture as any,
    },
    focus: {
      isEnabled: isEnabled(featureProps['focus']!),
      Feature: FocusGesture as any,
    },
    inView: {
      isEnabled: isEnabled(featureProps['inView']!),
      Feature: InViewFeature as any,
    },
  } as any);
}
