import Behavior, { timeToFrame } from '../behaviors/base';
import { parse } from 'animations/utils/css-to-unit-value';

export type Value = string | number;
export type Keyframe = {
  [k: string]: Value;
};

type BaseValueOptions = {
  transferVelocity: boolean;
};

export default class BaseValue {
  private previousValue: Value;
  private currentValue: Value;
  private velocity = 0; // velocity between behaviors
  private previousFramesFromTime?: number[];

  private property: string;
  private behavior?: Behavior;
  private delay = 0;
  private duration = 0;
  private transferVelocity = false;

  constructor(
    property: string,
    value: Value,
    { transferVelocity }: BaseValueOptions = { transferVelocity: true }
  ) {
    this.property = property;
    this.previousValue = this.currentValue = value;
    this.transferVelocity = transferVelocity;
  }

  velocityAtTime(time: number, frames: number[] = this.frames): number {
    return (
      this.behavior?.instantaneousVelocity(time, this.duration, frames) ?? 0
    );
  }

  /**
   * E.g. spring, easing function
   * @param behavior
   * @param value
   * @param duration
   * @param delay
   * @param time
   */
  applyBehavior(
    behavior: Behavior,
    value: Value,
    duration: number,
    delay?: number,
    time?: number
  ): void {
    let previousFrames = this.frames;
    this.velocity = 0;

    if (time) {
      // we don't currently interpolate between frames, we find the closest frame
      let frame = Math.min(this.frames.length - 1, timeToFrame(time));

      this.currentValue = previousFrames[frame];
      this.velocity = this.velocityAtTime(time); // We probably only need this if the new behaviour is a spring

      if (this.transferVelocity) {
        this.previousFramesFromTime = previousFrames.slice(
          frame,
          previousFrames.length
        );
      }
    } else {
      this.previousFramesFromTime = undefined;
    }

    this.previousValue = this.currentValue;
    this.currentValue = value;
    this.duration = duration;
    this.behavior = behavior;
    this.delay = delay ?? 0;
  }

  get previousAsNumber(): number {
    if (typeof this.previousValue === 'number') {
      return this.previousValue;
    }

    return Number.parseFloat(this.previousValue);
  }

  get currentAsNumber(): number {
    if (typeof this.currentValue === 'number') {
      return this.currentValue;
    }

    return Number.parseFloat(this.currentValue);
  }

  get currentUnit(): string {
    return parse(this.currentValue).unit;
  }

  get frames(): number[] {
    return (
      this.behavior?.toFrames(
        this.previousAsNumber,
        this.currentAsNumber,
        this.duration,
        this.velocity,
        this.delay,
        this.previousFramesFromTime
      ) ?? []
    );
  }

  get keyframes(): Keyframe[] {
    return this.frames.map(
      (value) =>
        ({
          [this.property]: this.currentUnit
            ? `${value}${this.currentUnit}`
            : value,
        } as Keyframe)
    );
  }
}
