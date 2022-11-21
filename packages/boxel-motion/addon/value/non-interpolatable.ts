import Behavior, { timeToFrame } from '@cardstack/boxel-motion/behaviors/base';
import { Value } from '@cardstack/boxel-motion/value';

import SimpleFrame from './simple-frame';

interface NonInterpolatableOptions {
  behavior?: Behavior;
  duration?: number;
  delay?: number;
}

export default class NonInterpolatable {
  property: string;
  value: Value;
  timing: { duration?: number; delay?: number };

  get duration() {
    return this.timing.duration ?? 0;
  }

  constructor(
    property: string,
    value: Value,
    timing: NonInterpolatableOptions
  ) {
    this.property = property;
    this.value = value;
    this.timing = {
      duration: timing.duration,
      delay: timing.delay,
    };
  }

  toFrames(): SimpleFrame[] {
    let frameCount = timeToFrame(this.duration);
    let frames = new Array(frameCount);

    // we should be able to get away with just empty frames
    if (this.property === 'wait') {
      return frames;
    }

    let result = [...frames].map(
      () => new SimpleFrame(this.property, this.value)
    );

    return result;
  }
}
