// import instantaneousVelocity from '@cardstack/boxel-motion/utils/instantaneous-velocity';

import Behavior, {
  EasingToFramesArgument,
  FPS,
  Frame,
  timeToFrame,
} from '../behaviors/base';

// We may need a layer below behaviors (i.e. an interpolator) for specific value types
// The below could be a numeric interpolator. We'd also need a color one etc.
export default class LinearBehavior implements Behavior {
  toFrames(
    options: EasingToFramesArgument,
    interpolator?: (from: any, to: any, t: number) => any,
    serializer?: (value: any) => any
  ): Frame[] {
    let {
      from,
      to,
      duration,
      delay = 0,
      /*
      lastFrame,
      previousFramesFromTime,
      */
    } = options;

    if (interpolator) {
      from = 0;
      to = 1;
    }

    if (from === to) {
      return [];
    }

    // if from and to are not the same we generate at minimum 2 frames
    duration = Math.max(duration, 1 / FPS);

    let frameCount = Math.max(timeToFrame(duration), 1);

    let delayFrameCount = timeToFrame(delay);
    let frames: Frame[] = Array.from(new Array(delayFrameCount)).map(() => ({
      value: from,
      velocity: 0,
    }));

    // probably only relevant for numerical values
    let velocity = (to - from) / duration / 1000;

    for (let i = 0; i <= frameCount; i++) {
      let t = i / frameCount;

      let value;
      if (interpolator) {
        value = interpolator(options.from, options.to, t);
      } else {
        value = (1 - t) * from + t * to;
      }

      if (serializer) {
        value = serializer(value);
      }

      frames.push({
        value,
        velocity,
      });
    }

    /*
    // linearly combine if a motion was still happening
    if (previousFramesFromTime?.length) {
      let frameCount =
        previousFramesFromTime.length < frames.length
          ? previousFramesFromTime.length
          : frames.length;
      frameCount--;
      for (let i = 0; i <= frameCount; i++) {
        let progress = i / frameCount;
        frames[i]!.value =
          progress * frames[i]!.value +
          (1 - progress) * previousFramesFromTime[i]!.value;
      }

      if (lastFrame) {
        // We explicitly add the lastFrame (if any) to correctly calculate the velocity at the transfer point.
        frames[0]!.velocity = instantaneousVelocity(1, [lastFrame, ...frames]);
      } else {
        frames[0]!.velocity = instantaneousVelocity(0, frames);
      }

      for (let i = 1; i <= frameCount; i++) {
        frames[i]!.velocity = instantaneousVelocity(i, frames);
      }
    }
    */

    return frames;
  }
}
