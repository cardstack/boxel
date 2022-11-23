import Behavior, { WaitToFramesArgument, Frame, timeToFrame } from './base';

export default class WaitBehavior implements Behavior {
  toFrames(options: WaitToFramesArgument): Frame[] {
    let frameCount = timeToFrame(options.duration) + 1;
    return new Array(frameCount);
  }
}
