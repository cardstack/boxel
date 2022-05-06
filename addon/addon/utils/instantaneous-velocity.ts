import { FPS, Frame } from 'animations-experiment/behaviors/base';

/**
 * Calculates an approximation of the instantaneous velocity (per second) for the given frame.
 *
 * @param index
 * @param frames
 */
export default function instantaneousVelocity(
  index: number,
  frames: Frame[]
): number {
  let frame = frames[index]?.value;
  let previousFrame = index > 0 ? frames[index - 1]?.value : undefined;
  let nextFrame =
    index < frames.length - 1 ? frames[index + 1]?.value : undefined;

  if (
    frame !== undefined &&
    previousFrame !== undefined &&
    nextFrame !== undefined
  ) {
    let frameDuration = 1 / FPS;
    let leftVelocity = (frame - previousFrame) / frameDuration / 1000;
    let rightVelocity = (nextFrame - frame) / frameDuration / 1000;

    return (leftVelocity + rightVelocity) / 2;
  } else {
    return 0;
  }
}
