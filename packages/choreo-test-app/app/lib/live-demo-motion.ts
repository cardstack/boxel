import type { VisualElement } from 'motion-dom';
import { animateVisualElement, frame, visualElementStore } from 'motion-dom';

interface MotionSnapshot {
  phases: Map<string, number>;
  timing: string;
}

/** Motion retargets changed destinations; an editor must also apply timing-only edits. */
export function captureDemoMotion(stage: Element | null) {
  const snapshot = new Map<VisualElement, MotionSnapshot>();
  for (const element of stage?.querySelectorAll('*') ?? []) {
    const visual = visualElementStore.get(element);
    if (visual) {
      const phases = new Map<string, number>();
      if (visual.getProps().transition?.repeat === Infinity) {
        visual.values.forEach((value, key) => {
          const animation = value.animation;
          if (
            animation &&
            animation.duration > 0 &&
            Number.isFinite(animation.duration)
          ) {
            phases.set(key, (animation.time / animation.duration) % 1);
          }
        });
      }
      snapshot.set(visual, { timing: timingOf(visual), phases });
    }
  }
  return snapshot;
}
function timingOf(visual: VisualElement) {
  const props = visual.getProps();
  return JSON.stringify([
    props.transition,
    props.transition?.repeat === Infinity ? props.animate : null,
    Object.entries(props.variants ?? {}).map(([name, variant]) => [
      name,
      typeof variant === 'object' ? variant.transition : null,
    ]),
  ]);
}

/** Runs after Glimmer has delivered the new variables to the existing Motion nodes. */
export function refreshDemoMotion(
  snapshot: Map<VisualElement, MotionSnapshot>
) {
  for (const [visual, previous] of snapshot) {
    if (!visual.current || previous.timing === timingOf(visual)) {
      continue;
    }
    const props = visual.getProps();
    const state = visual.animationState?.getState();
    if (state?.exit?.isActive) {
      continue;
    }
    const priority = [
      'whileDrag',
      'whileTap',
      'whileHover',
      'whileFocus',
      'whileInView',
      'animate',
    ] as const;
    const mode = priority.find(
      (mode) => state?.[mode]?.isActive && props[mode]
    );
    const definition = mode ? props[mode] : undefined;
    if (
      !definition ||
      typeof definition === 'boolean' ||
      (typeof definition === 'object' && 'start' in definition)
    ) {
      continue;
    }
    // Reuse the visual element: no component reset, DOM replacement, or second animation engine.
    void animateVisualElement(visual, definition);
    if (previous.phases.size) {
      frame.postRender(() => {
        if (!visual.current) {
          return;
        }
        for (const [key, phase] of previous.phases) {
          const animation = visual.values.get(key)?.animation;
          if (
            animation &&
            animation.duration > 0 &&
            Number.isFinite(animation.duration)
          ) {
            animation.time = phase * animation.duration;
          }
        }
      });
    }
  }
}
