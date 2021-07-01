export const FPS = 60 / 1000; // 60 FPS
export function timeToFrame(time: number): number {
  return Math.round(time * FPS);
}

export default interface Behavior {
  /**
   * Calculates the frames for the given parameters.
   *
   * @param from
   * @param to
   * @param duration Duration in milliseconds
   * @param velocity
   * @param delay
   * @param previousFramesFromTime The previous frames (if any) that would have happened without an interruption.
   */
  toFrames(
    from: number,
    to: number,
    duration: number,
    velocity: number,
    delay?: number,
    previousFramesFromTime?: number[]
  ): number[];

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
