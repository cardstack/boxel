import linear from '@cardstack/boxel-motion/easings/linear';

import { instantaneousVelocityForValues } from '@cardstack/boxel-motion/utils/instantaneous-velocity';

import Behavior, {
  EasingToFramesArgument,
  FPS,
  FrameGenerator,
  timeToFrame,
} from './base';

export type Easing = (t: number) => number;

export interface TweenBehaviorOptions {
  easing?: Easing;
}

export default class TweenBehavior implements Behavior {
  easing: Easing;

  constructor(options?: TweenBehaviorOptions) {
    this.easing = options?.easing ?? linear;
  }

  *getFrames(options: EasingToFramesArgument): FrameGenerator {
    let { from, to, duration, delay = 0 } = options;

    // early exit if there is no movement, we do not just render delay frames
    if (from === to) {
      return;
    }

    // if from and to are not the same we generate at minimum 2 frames
    duration = Math.max(duration, 1 / FPS);

    let delayFrameCount = timeToFrame(delay);
    let frameCount = Math.max(timeToFrame(duration), 1);

    for (let i = 0; i < delayFrameCount; i++) {
      yield {
        value: from,
        velocity: 0,
      };
    }

    for (let i = 0; i <= frameCount; i++) {
      let t = i / frameCount;

      let value = from + (to - from) * this.easing(t);

      // TODO: We can possibly calculate velocity only when we need it and save some math here,
      //  but then we need to pass the previously calculated keyframes from the interrupted animation.
      let previousValue =
        i > 0
          ? from + (to - from) * this.easing((i - 1) / frameCount)
          : undefined;
      let nextValue =
        i < frameCount
          ? from + (to - from) * this.easing((i + 1) / frameCount)
          : undefined;
      let velocity = instantaneousVelocityForValues(
        previousValue,
        value,
        nextValue,
      );

      yield {
        value,
        velocity,
      };
    }
  }
}
