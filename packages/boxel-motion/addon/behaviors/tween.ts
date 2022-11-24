import linear from '@cardstack/boxel-motion/easings/linear';

import Behavior, { EasingToFramesArgument, FPS, timeToFrame } from './base';

export type Easing = (t: number) => number;

export interface TweenBehaviorOptions {
  easing?: Easing;
}

export default class TweenBehavior implements Behavior {
  easing: Easing;

  constructor(options?: TweenBehaviorOptions) {
    this.easing = options?.easing ?? linear;
  }

  *getFrames(options: EasingToFramesArgument) {
    let { from, to, duration, delay = 0 } = options;

    if (from === to) {
      return [];
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
      let velocity = 0; // TODO

      yield {
        value,
        velocity,
      };
    }
  }
}
