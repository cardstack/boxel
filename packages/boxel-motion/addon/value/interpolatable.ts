import Behavior from '@cardstack/boxel-motion/behaviors/base';
import { MotionTiming } from '@cardstack/boxel-motion/models/sprite';
import { UnitValue } from '@cardstack/boxel-motion/utils/css-to-unit-value';
import SimpleFrame from '@cardstack/boxel-motion/value/simple-frame';
import { assert } from '@ember/debug';

interface InterpolatableOptions {
  behavior: Behavior;
  duration?: number;
  delay?: number;
}

export default class Interpolatable {
  property: string;
  values: number[]; // minimum length 2 for from/to. These should be unitless
  unit: string;
  behavior: Behavior;
  timing: MotionTiming;

  constructor(
    property: string,
    values: UnitValue[],
    timing: InterpolatableOptions
  ) {
    assert(
      'Value should have a minimum length of 2 (for from/to)',
      values.length >= 2
    );
    assert(
      'More than 2 values (i.e. keyframes) are not supported yet',
      values.length <= 2
    );

    this.property = property;
    this.unit = values[0]!.unit as string; // we assume the unit is identical between from/to so we grab the first
    this.values = values.map((v) => v.value);
    this.behavior = timing.behavior;
    this.timing = {
      duration: timing.duration,
      delay: timing.delay,
    };
  }

  // frames will need to be easily merge-able constructs
  toFrames(): SimpleFrame[] {
    let interpolatedValues = this.behavior.toFrames({
      from: this.values[0] as number,
      to: this.values[1] as number,
      ...this.timing,
    });

    return interpolatedValues.map(
      (frame) => new SimpleFrame(this.property, frame.value, this.unit)
    );
  }
}
