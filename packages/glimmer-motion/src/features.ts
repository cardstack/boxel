/**
 * The two features the React layer contributes on top of the motion-dom engine
 * (ported from framer-motion/motion/features/animation/*). Everything else —
 * springs, keyframes, variants, projection (layout / layoutId) — lives in the engine.
 */
import { DragGesture } from './gestures/DragGesture';
import { PanGesture } from './gestures/PanGesture';
import { Feature, createAnimationState, isAnimationControls, resolveVariant, setFeatureDefinitions, HTMLProjectionNode } from 'motion-dom';
import type { VisualElement, MotionNodeOptions } from 'motion-dom';

class AnimationFeature extends Feature<unknown> {
  unmountControls?: VoidFunction;
  constructor(node: VisualElement) {
    super(node);
    node.animationState ||= createAnimationState(node);
  }
  updateAnimationControlsSubscription() {
    const { animate } = this.node.getProps();
    if (isAnimationControls(animate)) this.unmountControls = animate.subscribe(this.node);
  }
  mount() {
    this.updateAnimationControlsSubscription();
  }
  update() {
    const { animate } = this.node.getProps();
    const { animate: prevAnimate } = this.node.prevProps || {};
    if (animate !== prevAnimate) this.updateAnimationControlsSubscription();
  }
  unmount() {
    this.node.animationState!.reset();
    this.unmountControls?.();
  }
}

let exitId = 0;
class ExitAnimationFeature extends Feature<unknown> {
  id = exitId++;
  isExitComplete = false;
  update() {
    if (!this.node.presenceContext) return;
    const { isPresent, onExitComplete } = this.node.presenceContext;
    const { isPresent: prevIsPresent } = this.node.prevPresenceContext || {};
    if (!this.node.animationState || isPresent === prevIsPresent) return;
    if (isPresent && prevIsPresent === false) {
      if (this.isExitComplete) {
        const { initial, custom } = this.node.getProps();
        if (typeof initial === 'string' || (typeof initial === 'object' && initial !== null && !Array.isArray(initial))) {
          const resolved = resolveVariant(this.node, initial as any, custom);
          if (resolved) {
            const { transition, transitionEnd, ...target } = resolved as any;
            for (const key in target) this.node.getValue(key)?.jump(target[key]);
          }
        }
        this.node.animationState.reset();
        this.node.animationState.animateChanges();
      } else {
        this.node.animationState.setActive('exit', false);
      }
      this.isExitComplete = false;
      return;
    }
    const exitAnimation = this.node.animationState.setActive('exit', !isPresent);
    if (onExitComplete && !isPresent) {
      exitAnimation.then(() => {
        this.isExitComplete = true;
        onExitComplete(this.id);
      });
    }
  }
  mount() {
    const { register, onExitComplete } = this.node.presenceContext || {};
    if (onExitComplete) onExitComplete(this.id);
    if (register) this.unmount = register(this.id);
  }
  unmount() {}
}

const featureProps: Record<string, (keyof MotionNodeOptions)[]> = {
  animation: ['animate', 'variants', 'whileHover', 'whileTap', 'exit', 'whileInView', 'whileFocus', 'whileDrag'],
  exit: ['exit'],
  layout: ['layout', 'layoutId'],
  drag: ['drag', 'dragControls'],
  pan: ['onPan', 'onPanStart', 'onPanSessionStart', 'onPanEnd'],
};
const isEnabled = (names: (keyof MotionNodeOptions)[]) => (props: MotionNodeOptions) => names.some((n) => !!props[n]);

let initialized = false;
export function initFeatures() {
  if (initialized) return;
  initialized = true;
  setFeatureDefinitions({
    animation: { isEnabled: isEnabled(featureProps['animation']!), Feature: AnimationFeature as any },
    exit: { isEnabled: isEnabled(featureProps['exit']!), Feature: ExitAnimationFeature as any },
    layout: { isEnabled: isEnabled(featureProps['layout']!), ProjectionNode: HTMLProjectionNode as any },
    // the drag and pan gestures are vendored from framer-motion (they are not exported by motion-dom)
    drag: { isEnabled: isEnabled(featureProps['drag']!), Feature: DragGesture as any, ProjectionNode: HTMLProjectionNode as any },
    pan: { isEnabled: isEnabled(featureProps['pan']!), Feature: PanGesture as any },
  } as any);
}
