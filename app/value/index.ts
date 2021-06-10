import Behavior, { timeToFrame } from '../behaviors/base';
import { parse } from 'animations/utils/css-to-unit-value';

export type Value = string | number;
export type Keyframe = {
  [k: string]: Value;
};

export default class BaseValue {
  private previousValue: Value;
  private currentValue: Value;

  private property: string;
  private behavior?: Behavior;
  private delay = 0;
  private duration = 0;

  constructor(property: string, value: Value) {
    this.property = property;
    this.previousValue = this.currentValue = value;
  }

  /**
   * E.g. spring, easing function
   * @param behavior
   */
  applyBehavior(
    behavior: Behavior,
    value: Value,
    duration: number,
    delay?: number,
    time?: number
  ): void {
    if (time) {
      // we don't currently interpolate between frames, we find the closest frame
      let frames = this.frames;
      let frame = Math.min(frames.length - 1, timeToFrame(time));
      this.currentValue = frames[frame];
      // TODO: update velocity based on the above
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

  get frames(): Value[] {
    return (
      this.behavior?.toFrames(
        this.previousAsNumber,
        this.currentAsNumber,
        this.duration,
        0,
        this.delay
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
