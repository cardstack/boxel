/**
 * Play a cue list on the motion-dom engine. Value animations go through
 * animateTarget (interruption and velocity are the engine's); holds and waits
 * are frame-clocked with the engine's delay(); a removed sprite is released at
 * the end of its row.
 */
import type { AnimationPlaybackControls, VisualElement } from 'motion-dom';
import { animateTarget, delay } from 'motion-dom';

import type { ChoreoNode, Cue, PropValue, Sprite } from './types.ts';

export interface Run {
  /** stop everything; removed sprites are released unless a next run is keeping them (`keep`) */
  cancel(keep?: Set<ChoreoNode>): void;
  cues: Cue[];
  finished: Promise<void>;
}

interface RunOptions {
  /** a removed sprite's row has ended (or the run was cancelled) */
  onSpriteDone(sprite: Sprite): void;
  removed: Sprite[];
}

const dash = (key: string) =>
  key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

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
  const active = new Map<Cue, HeldValue[]>();
  const pending = new Set(options.removed);
  let cancelled = false;

  const at = (ms: number, fn: () => void) => {
    if (ms <= 0) {
      fn();
    } else {
      timers.push(delay(fn, ms));
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

  for (const cue of cues) {
    const ve = cue.sprite.node.visualElement;
    if (!ve) {
      continue;
    }
    if (cue.target) {
      // FLIP sizes are the engine's only for the move: afterwards the stylesheet has the element again
      const borrowed =
        cue.kind === 'move'
          ? ['width', 'height'].filter(
              (key) => key in cue.target! && !ve.hasValue(key),
            )
          : [];
      const controls = animateTarget(ve, {
        ...cue.target,
        transition: { ...cue.transition, delay: cue.start / 1000 },
      } as never);
      animations.push(...controls);
      if (borrowed.length) {
        Promise.all(
          controls.map((c) => new Promise<void>((r) => c.then(r))),
        ).then(() => {
          if (!cancelled) {
            for (const key of borrowed) {
              ve.removeValue(key);
              cue.sprite.element.style.removeProperty(key);
            }
            ve.scheduleRender();
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

  const finished = new Promise<void>((resolve) => at(total, resolve));

  return {
    cancel(keep?: Set<ChoreoNode>) {
      if (cancelled) {
        return;
      }
      cancelled = true;
      timers.splice(0).forEach((cancel) => cancel());
      animations.splice(0).forEach((a) => a.stop());
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
  };
}
