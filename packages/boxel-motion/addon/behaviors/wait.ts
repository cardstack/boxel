import Behavior, { WaitToFramesArgument, timeToFrame } from './base';

export default class WaitBehavior implements Behavior {
  *getFrames(options: WaitToFramesArgument) {
    let frameCount = timeToFrame(options.duration) + 1;

    for (let i = 0; i < frameCount; i++) {
      yield;
    }
  }
}
