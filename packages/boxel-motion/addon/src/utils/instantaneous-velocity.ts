import { type Frame, FPS } from '../behaviors/base.ts';

/**
 * Calculates an approximation of the instantaneous velocity (per second) for the given frame.
 *
 * @param index
 * @param frames
 */
export default function instantaneousVelocity(
  index: number,
  frames: Frame[],
): number {
  let previous = index > 0 ? frames[index - 1]?.value : undefined;
  let current = frames[index]?.value;
  let next = index < frames.length - 1 ? frames[index + 1]?.value : undefined;

  return instantaneousVelocityForValues(previous, current, next);
}

export function instantaneousVelocityForValues(
  previous: number | undefined,
  current: number | undefined,
  next: number | undefined,
) {
  if (previous !== undefined && current !== undefined && next !== undefined) {
    let frameDuration = 1 / FPS;
    let leftVelocity = (current - previous) / frameDuration / 1000;
    let rightVelocity = (next - current) / frameDuration / 1000;

    return (leftVelocity + rightVelocity) / 2;
  } else {
    return 0;
  }
}
