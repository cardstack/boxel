export const FPS = 60 / 1000; // 60 FPS
export function timeToFrame(time: number): number {
  return Math.round(time * FPS);
}

export type EasingToFramesArgument = {
  from: number;
  to: number;
  duration: number;
  lastFrame?: Frame;
  previousFramesFromTime?: Frame[];
  delay?: number;
};

export type SpringToFramesArgument = {
  from: number;
  to: number;
  velocity?: number;
  delay?: number;
};

export type Frame = {
  value: number;
  velocity: number; // units per second
};

export default interface Behavior {
  /**
   * Calculates the frames for the given parameters.
   *
   * @param options
   */
  toFrames(options: EasingToFramesArgument | SpringToFramesArgument): Frame[];
}

export interface EasingBehavior extends Behavior {
  /**
   * Calculates (an approximation of) the instantaneous velocity in units per second at the given time.
   *
   * @param time
   * @param duration
   * @param frames
   */
  instantaneousVelocity(
    time: number,
    duration: number,
    frames: number[]
  ): number;
}
