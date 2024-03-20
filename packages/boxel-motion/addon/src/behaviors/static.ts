import type Behavior from './base';
import {
  type Frame,
  type StaticToFramesArgument,
  timeToFrame,
} from './base.ts';

export interface StaticBehaviorOptions {
  fill?: boolean;
}
export default class StaticBehavior implements Behavior {
  fill: boolean;
  constructor(options?: StaticBehaviorOptions) {
    this.fill = options?.fill ?? false;
  }

  *getFrames(options: StaticToFramesArgument) {
    let frameCount = timeToFrame(options.duration) + 1;

    for (let i = 0; i < frameCount; i++) {
      yield { value: options.value, velocity: 0 } as Frame;
    }
  }
}
