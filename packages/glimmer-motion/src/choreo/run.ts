/**
 * Play a cue list on the motion-dom engine. Value animations go through
 * animateTarget (interruption and velocity are the engine's); holds and waits
 * are frame-clocked with the engine's delay(); a removed sprite is released at
 * the end of its row.
 */
import type { AnimationPlaybackControls, VisualElement } from 'motion-dom';
import { animateTarget, delay } from 'motion-dom';

import { motionSpeed, scaleTransition } from '../speed.ts';
import { deliver, type Delivery } from './deliver.ts';
import type { ChoreoNode, Cue, PropValue, Sprite } from './types.ts';

/** how fast each value was moving, in units per second, keyed by element then property */
export type Velocities = Map<HTMLElement, Map<string, number>>;

export interface Run {
  /** stop everything; removed sprites are released unless a next run is keeping them (`keep`) */
  cancel(keep?: Set<ChoreoNode>): void;
  cues: Cue[];
  finished: Promise<void>;
  /** nothing left to play: every row has ended, or the run was cancelled */
  isDone(): boolean;
  /**
   * Put every element this run has touched back to its resting layout NOW:
   * borrowed width/height handed back to the stylesheet, and any transform
   * this run applied returned to zero.
   *
   * The region calls this before it measures a new pass. A Move's values are
   * the engine's only while it runs, and an element left mid-flight would
   * otherwise be measured where it currently LOOKS rather than where the
   * stylesheet puts it — the new pass would see no change at all, generate no
   * cue, and strand that transform on the element permanently.
   */
  releaseForMeasure(): void;
  /**
   * What every value this run was driving was doing at the moment it was
   * interrupted. Sampled before anything is stopped or jumped, because both
   * of those wipe velocity.
   */
  velocities: Velocities;
}

interface RunOptions {
  /**
   * Velocities from the run this one is interrupting. A spring that inherits
   * one leaves at the speed the old animation was travelling, so a second
   * click bends the motion instead of restarting it.
   */
  inherit?: Velocities;
  /** a removed sprite's row has ended (or the run was cancelled) */
  onSpriteDone(sprite: Sprite): void;
  removed: Sprite[];
}

/** does this transition resolve to a spring? only a spring can use a velocity */
function isSpring(transition: Record<string, unknown> | undefined): boolean {
  if (!transition) {
    return false;
  }
  if (transition['type']) {
    return transition['type'] === 'spring';
  }
  return (
    'bounce' in transition ||
    'damping' in transition ||
    'stiffness' in transition ||
    'visualDuration' in transition
  );
}

/**
 * Give each inherited property its own copy of the transition carrying the
 * velocity it was already travelling at.
 *
 * The engine reads `transition[key]` in preference to the transition itself,
 * so a per-property override has to be the whole transition plus the
 * velocity — not just the velocity on its own.
 */
function carryVelocity(
  transition: Record<string, unknown>,
  cue: Cue,
  inherit: Velocities | undefined,
): Record<string, unknown> {
  if (!inherit || !cue.target || !isSpring(transition)) {
    return transition;
  }
  // a counterpart hands its momentum to the element that replaced it
  const was =
    inherit.get(cue.sprite.element) ??
    (cue.sprite.counterpart && inherit.get(cue.sprite.counterpart.element));
  if (!was) {
    return transition;
  }
  let out = transition;
  for (const key in cue.target) {
    const velocity = was.get(key);
    if (velocity) {
      if (out === transition) {
        out = { ...transition };
      }
      out[key] = { ...transition, velocity };
    }
  }
  return out;
}

const dash = (key: string) =>
  key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

/** the values a Move borrows from the stylesheet and must hand back */
const SIZES: Record<string, true> = { height: true, width: true };

interface HeldValue {
  /** the engine had this value before the hold */
  had: boolean;
  key: string;
  prior: unknown;
  /** what the inline style said before the hold (a static `style`, or the stylesheet's silence) */
  priorStyle: string;
}

function applyHold(
  ve: VisualElement,
  el: HTMLElement,
  values: Record<string, PropValue>,
): HeldValue[] {
  const held: HeldValue[] = [];
  for (const key in values) {
    const had = ve.hasValue(key);
    const prior = had ? ve.getValue(key)!.get() : undefined;
    const priorStyle = key.startsWith('--')
      ? el.style.getPropertyValue(key)
      : ((el.style as unknown as Record<string, string>)[key] ?? '');
    const mv = ve.getValue(key, values[key]!)!;
    mv.jump(values[key]!);
    held.push({ had, key, prior, priorStyle });
  }
  ve.scheduleRender();
  return held;
}

function releaseHold(ve: VisualElement, el: HTMLElement, held: HeldValue[]) {
  for (const { had, key, prior, priorStyle } of held) {
    if (had) {
      ve.getValue(key)?.jump(prior as PropValue);
    } else {
      ve.removeValue(key);
      if (priorStyle) {
        el.style.setProperty(dash(key), priorStyle);
      } else {
        el.style.removeProperty(dash(key));
      }
    }
  }
  ve.scheduleRender();
}

export function execute(cues: Cue[], options: RunOptions): Run {
  const timers: (() => void)[] = [];
  const animations: AnimationPlaybackControls[] = [];
  const deliveries: Delivery[] = [];
  const active = new Map<Cue, HeldValue[]>();
  const pending = new Set(options.removed);
  /** width/height a Move took over for its duration, to give back after */
  const borrowedValues: { el: HTMLElement; key: string; ve: VisualElement }[] =
    [];
  /** transforms a Move applied, to return to rest */
  const movedValues: { key: string; ve: VisualElement }[] = [];
  /** every value this run drives, so an interruption can read its speed */
  const owned: { el: HTMLElement; key: string; ve: VisualElement }[] = [];
  const velocities: Velocities = new Map();
  let cancelled = false;
  let ended = false;

  /**
   * Read how fast everything is going, once. Must run before `jump` or `stop`
   * touches anything — both of those reset velocity to zero, so a sample taken
   * afterwards would report a still element that was in fact mid-flight.
   */
  const sampleVelocities = () => {
    for (const { ve, el, key } of owned) {
      let byKey = velocities.get(el);
      if (byKey?.has(key)) {
        continue; // the first sample was the live one; later ones are post-jump
      }
      const velocity = ve.getValue(key)?.getVelocity();
      if (!velocity) {
        continue;
      }
      if (!byKey) {
        velocities.set(el, (byKey = new Map()));
      }
      byKey.set(key, velocity);
    }
  };

  const releaseForMeasure = () => {
    sampleVelocities();
    const touched = new Set<VisualElement>();
    for (const { ve, el, key } of borrowedValues.splice(0)) {
      ve.removeValue(key);
      el.style.removeProperty(dash(key));
      touched.add(ve);
    }
    for (const { ve, key } of movedValues.splice(0)) {
      // back to rest, so the element measures where the stylesheet puts it
      ve.getValue(key)?.jump(0);
      touched.add(ve);
    }
    // Synchronously, not scheduled. The caller measures the moment this
    // returns, and a batched render would not have written the style yet —
    // `final` would come back with the transform this run is trying to undo
    // still on the element, and the FLIP delta would be the distance the
    // element had already travelled ADDED to the distance it still has to go.
    touched.forEach((ve) => ve.render());
  };

  // the phases keep their proportions under slow motion, so a hold still
  // covers exactly the move it was written to cover
  const scale = motionSpeed();
  const at = (ms: number, fn: () => void) => {
    if (ms <= 0) {
      fn();
    } else {
      timers.push(delay(fn, ms * scale));
    }
  };
  const done = (sprite: Sprite) => {
    if (pending.delete(sprite)) {
      options.onSpriteDone(sprite);
    }
  };

  let total = 0;
  const rowEnd = new Map<Sprite, number>();
  for (const cue of cues) {
    const end = cue.start + cue.duration;
    total = Math.max(total, end);
    rowEnd.set(cue.sprite, Math.max(rowEnd.get(cue.sprite) ?? 0, end));
  }
  // a counterpart lives at least as long as the sprite that replaced it
  for (const [sprite, end] of rowEnd) {
    if (sprite.counterpart) {
      rowEnd.set(
        sprite.counterpart,
        Math.max(rowEnd.get(sprite.counterpart) ?? 0, end),
      );
    }
  }

  /**
   * Apply every animation's starting value NOW, synchronously, before the
   * browser paints.
   *
   * Two things go wrong without this. The pass has already patched the DOM, so
   * one frame of the *destination* layout paints before the engine's batched
   * render lands the FLIP transform — the elements visibly jump to where they
   * are going and snap back. And a cue that starts later (anything after the
   * first block of a sequence) would sit at its destination for the whole
   * delay, because the engine only applies a keyframe's first value when that
   * animation actually begins.
   *
   * Only explicit [from, to] keyframes are pinned; a target with no `from`
   * animates out of whatever the value already is, which is correct as it is.
   */
  const pinned = new Set<string>();
  const rendered = new Set<VisualElement>();
  for (const cue of [...cues].sort((a, b) => a.start - b.start)) {
    const ve = cue.sprite.node.visualElement;
    if (!ve || !cue.target) {
      continue;
    }
    for (const key in cue.target) {
      const value = cue.target[key];
      if (!Array.isArray(value) || value[0] === undefined) {
        continue;
      }
      const seen = `${cue.sprite.node.layoutKey}:${key}`;
      if (pinned.has(seen)) {
        continue; // an earlier cue already owns this property's start
      }
      pinned.add(seen);
      owned.push({ el: cue.sprite.element, key, ve });
      if (cue.kind === 'move') {
        if (key in SIZES) {
          if (!ve.hasValue(key)) {
            borrowedValues.push({ el: cue.sprite.element, key, ve });
          }
        } else {
          movedValues.push({ key, ve });
        }
      }
      ve.getValue(key, value[0] as PropValue)!.jump(value[0] as PropValue);
      rendered.add(ve);
    }
  }
  rendered.forEach((ve) => ve.render());

  for (const cue of cues) {
    const ve = cue.sprite.node.visualElement;
    if (!ve) {
      continue;
    }
    if (cue.delivery) {
      // a split sprite delivers by slots on the platform's own animations
      at(cue.start, () => {
        if (!cancelled) {
          deliveries.push(deliver(cue, scale));
        }
      });
    } else if (cue.target) {
      const controls = animateTarget(ve, {
        ...cue.target,
        transition: carryVelocity(
          scaleTransition(
            { ...cue.transition, delay: cue.start / 1000 } as never,
            scale,
          ) as unknown as Record<string, unknown>,
          cue,
          options.inherit,
        ),
      } as never);
      animations.push(...controls);
      if (cue.kind === 'move') {
        // FLIP sizes are the engine's only while the move runs; afterwards the
        // stylesheet owns the element again
        Promise.all(
          controls.map((c) => new Promise<void>((r) => c.then(r))),
        ).then(() => {
          if (!cancelled) {
            releaseForMeasure();
          }
        });
      }
    } else if (cue.hold) {
      const { values, fill } = cue.hold;
      at(cue.start, () => {
        if (!cancelled) {
          active.set(cue, applyHold(ve, cue.sprite.element, values));
        }
      });
      if (!fill) {
        at(cue.start + cue.duration, () => {
          const held = active.get(cue);
          if (held) {
            active.delete(cue);
            releaseHold(ve, cue.sprite.element, held);
          }
        });
      }
    }
  }

  for (const sprite of options.removed) {
    at(rowEnd.get(sprite) ?? 0, () => done(sprite));
  }

  const finished = new Promise<void>((resolve) =>
    at(total, () => {
      ended = true;
      resolve();
    }),
  );

  return {
    cancel(keep?: Set<ChoreoNode>) {
      if (cancelled) {
        return;
      }
      cancelled = true;
      // before stop(), which zeroes velocity along with everything else
      sampleVelocities();
      timers.splice(0).forEach((cancel) => cancel());
      animations.splice(0).forEach((a) => a.stop());
      deliveries.splice(0).forEach((d) => d.cancel());
      // an interrupted Move must give its values back too, or the element
      // stays frozen mid-flight — squeezing every track around it, and
      // measuring as though it had never needed to move at all
      releaseForMeasure();
      for (const [cue, held] of active) {
        const ve = cue.sprite.node.visualElement;
        if (ve) {
          releaseHold(ve, cue.sprite.element, held);
        }
      }
      active.clear();
      for (const sprite of [...pending]) {
        if (keep?.has(sprite.node)) {
          pending.delete(sprite);
        } else {
          done(sprite);
        }
      }
    },
    cues,
    finished,
    isDone: () => ended || cancelled,
    releaseForMeasure,
    velocities,
  };
}
