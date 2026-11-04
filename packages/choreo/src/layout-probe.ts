import type { Cue } from './types.ts';

/**
 * Where layout puts a moving element while a Move animates sizes.
 *
 * A Move that animates real width and height FLIPs against the final box:
 * it translates by `initial − final` and lets the size run alongside. That
 * holds only while the element's layout position does not depend on the
 * sizes in flight. It does wherever layout places a box by its size: a
 * card centred by its parent (`justify-content: center`, auto margins), a
 * box aligned to the right, a sibling pushed along by a box growing before
 * it. Mid-flight the size is not the final one, so layout puts the box
 * somewhere else, and the translate is added on top: a centred card that
 * narrows starts out by half the change. A replacement pass then takes the
 * painted box as its start and adds the same error again, so a run
 * re-passed every frame drives the card off the screen.
 *
 * So the translate is taken from where layout puts each element at the
 * START of the flight: every size the moves animate stands at its first
 * value, the boxes are read, and every move's start translate is corrected
 * by the difference from its final box. Layout is affine in the sizes for
 * the usual cases (left, centred, right, flowed after), and every value of
 * the moves runs on the same progress, so the correction holds for the
 * whole flight, not just its first frame.
 *
 * Runs on the world at rest (after releaseForMeasure), before the run
 * stands anything up. Moves the cue targets in place.
 */
export function correctMovesForLayout(cues: Cue[], zoom = 1): void {
  const moves = cues.filter(
    (c) =>
      c.kind === 'move' &&
      !c.flight &&
      c.target &&
      c.sprite.type !== 'removed' &&
      c.sprite.element.isConnected,
  );
  const sized = moves.filter(
    (c) =>
      startOf(c, 'width') !== undefined || startOf(c, 'height') !== undefined,
  );
  if (!sized.length) {
    return;
  }
  const subjects = [...new Set(moves.map((c) => c.sprite.element))];
  const atRest = new Map(
    subjects.map((el) => [el, el.getBoundingClientRect()]),
  );
  const restore: (() => void)[] = [];
  for (const cue of sized) {
    const el = cue.sprite.element;
    for (const key of ['width', 'height'] as const) {
      const start = startOf(cue, key);
      if (start === undefined) {
        continue;
      }
      const prior = el.style.getPropertyValue(key);
      const priority = el.style.getPropertyPriority(key);
      restore.push(() =>
        prior
          ? el.style.setProperty(key, prior, priority)
          : el.style.removeProperty(key),
      );
      el.style.setProperty(key, `${start}px`);
    }
  }
  const atStart = new Map(
    subjects.map((el) => [el, el.getBoundingClientRect()]),
  );
  restore.reverse().forEach((put) => put());
  for (const cue of moves) {
    const el = cue.sprite.element;
    const rest = atRest.get(el)!;
    const start = atStart.get(el)!;
    // descaled like the move's own boxes: the values are local pixels
    shift(cue, 'x', (rest.x - start.x) / zoom);
    shift(cue, 'y', (rest.y - start.y) / zoom);
  }
}

function startOf(cue: Cue, key: string): number | undefined {
  const value = cue.target?.[key];
  return Array.isArray(value) && typeof value[0] === 'number'
    ? value[0]
    : undefined;
}

function shift(cue: Cue, key: 'x' | 'y', by: number) {
  if (Math.abs(by) < 0.5) {
    return;
  }
  const target = cue.target!;
  const value = target[key];
  if (Array.isArray(value) && typeof value[0] === 'number') {
    target[key] = [value[0] + by, ...value.slice(1)];
  } else if (value === undefined) {
    // the box ends where it began, and layout moves it on the way
    target[key] = [by, 0];
  }
}
