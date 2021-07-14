import { EasingBehavior, timeToFrame } from '../behaviors/base';

export default class LinearBehavior implements EasingBehavior {
  toFrames(
    from: number,
    to: number,
    duration: number,
    _velocity: number, // TODO: velocity is unused currently
    delay = 0,
    previousFramesFromTime?: number[]
  ): number[] {
    let frameCount = Math.max(timeToFrame(duration), 1);
    let delayFrameCount = timeToFrame(delay);

    let frames = Array.from(new Array(delayFrameCount)).map(() => from);
    for (let i = 0; i <= frameCount; i++) {
      let t = i / frameCount;
      let v = (1 - t) * from + t * to;
      frames.push(v);
    }

    // linearly combine if a motion was still happening
    if (previousFramesFromTime?.length) {
      let frameCount =
        previousFramesFromTime.length < frames.length
          ? previousFramesFromTime.length
          : frames.length;
      frameCount--;
      for (let i = 0; i <= frameCount; i++) {
        let progress = i / frameCount;
        frames[i] =
          progress * frames[i] + (1 - progress) * previousFramesFromTime[i];
      }
    }

    return frames;
  }

  // TODO: is this good enough or do we want every behavior to provide its derivative?
  // TODO: do we want velocity precalculated by the behaviour per frame?
  /**
   * Calculates an approximation of the instantaneous velocity at the given time
   * @param time
   * @param duration
   * @param frames
   */
  instantaneousVelocity(
    time: number,
    duration: number,
    frames: number[]
  ): number {
    let frame = Math.min(frames.length - 1, timeToFrame(time));
    let from = frames[0];
    let to = frames[frames.length - 1];

    if (frame > 0 && frame < frames.length - 1) {
      let distance = to - from;

      return distance / duration / 1000;
    }

    return 0;
  }
}
