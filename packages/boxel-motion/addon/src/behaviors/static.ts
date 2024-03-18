import type Behavior from './base.ts';
import {
  type Frame,
  type StaticToFramesArgument,
  timeToFrame,
} from './base.ts';

export default class StaticBehavior implements Behavior {
  *getFrames(options: StaticToFramesArgument) {
    let frameCount = timeToFrame(options.duration) + 1;

    for (let i = 0; i < frameCount; i++) {
      // TODO: this can explicitly be non-numeric, fix TS
      yield { value: options.value, velocity: 0 } as Frame;
    }
  }
}
