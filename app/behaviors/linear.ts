import Behavior, { timeToFrame } from '../behaviors/base';

export default class LinearBehavior implements Behavior {
  toFrames(
    from: number,
    to: number,
    duration: number,
    velocity: number,
    delay = 0
  ): number[] {
    let frameCount = Math.max(timeToFrame(duration), 1);
    let delayFrameCount = timeToFrame(delay);

    let frames = Array.from(new Array(delayFrameCount)).map(() => from);
    for (let i = 0; i <= frameCount; i++) {
      let t = i / frameCount;
      let v = (1 - t) * from + t * to;
      frames.push(v);
    }

    return frames;
  }
}
