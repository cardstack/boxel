import Behavior, { Frame, StaticToFramesArgument, timeToFrame } from './base';

export default class StaticBehavior implements Behavior {
  toFrames(options: StaticToFramesArgument): Frame[] {
    let frameCount = timeToFrame(options.duration) + 1;
    let frames = new Array(frameCount);

    return [...frames].map(
      () => ({ value: options.value, velocity: 0 } as Frame)
    );
  }
}
