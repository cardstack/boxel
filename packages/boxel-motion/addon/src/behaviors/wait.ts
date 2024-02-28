import type Behavior from './base.ts';
import { type WaitToFramesArgument, timeToFrame } from './base.ts';

export default class WaitBehavior implements Behavior {
  *getFrames(options: WaitToFramesArgument) {
    let frameCount = timeToFrame(options.duration) + 1;

    for (let i = 0; i < frameCount; i++) {
      yield;
    }
  }
}
