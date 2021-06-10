export const FPS = 60 / 1000; // 60 FPS
export function timeToFrame(time: number): number {
  return Math.round(time * FPS);
}

export default interface Behavior {
  /**
   *
   * @param from
   * @param to
   * @param duration Duration in milliseconds
   * @param velocity
   * @param delay
   */
  toFrames(
    from: number,
    to: number,
    duration: number,
    velocity: number,
    delay?: number
  ): number[];
}
