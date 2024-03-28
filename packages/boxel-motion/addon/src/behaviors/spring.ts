import { assert } from '@ember/debug';

import type Behavior from './base.ts';
import {
  type Frame,
  type FrameGenerator,
  type SpringToFramesArgument,
  FPS,
  timeToFrame,
} from './base.ts';

type SpringOptionsArgument = {
  allowsOverdamping?: boolean;
  damping?: number;
  mass?: number;
  overshootClamping?: boolean;
  restDisplacementThreshold?: number;
  restVelocityThreshold?: number;
  stiffness?: number;
};

type SpringOptions = {
  allowsOverdamping: boolean;
  damping: number;
  mass: number;
  overshootClamping: boolean;
  restDisplacementThreshold: number;
  restVelocityThreshold: number;
  stiffness: number;
};

type SpringValues = {
  fromValue: number;
  initialVelocity: number;
  toValue: number;
};

export default class SpringBehavior implements Behavior {
  fill = true;
  private options: SpringOptions;

  constructor(options?: SpringOptionsArgument) {
    this.options = {
      stiffness: 100,
      damping: 10,
      mass: 1,
      overshootClamping: false,
      allowsOverdamping: false,
      restVelocityThreshold: 0.001,
      restDisplacementThreshold: 0.001,
      ...options,
    };

    assert('Mass value must be greater than 0', this.options.mass > 0);
    assert(
      'Stiffness value must be greater than 0',
      this.options.stiffness > 0,
    );
    assert('Damping value must be greater than 0', this.options.damping > 0);
  }

  *getFrames(options: SpringToFramesArgument) {
    let { from = 0, to = 1, velocity = 0, delay = 0 } = options;

    // early exit if there will be no movement, we do not generate any frames if there is only a delay
    if (from === to && velocity === 0) {
      return;
    }

    let delayFrameCount = timeToFrame(delay);

    for (let i = 0; i < delayFrameCount; i++) {
      yield {
        value: from,
        velocity: 0,
      };
    }

    let generator = this.springToFrames({
      fromValue: from,
      toValue: to,
      initialVelocity: velocity,
    });

    let next = generator.next();
    while (!next.done) {
      yield next.value;

      next = generator.next();
    }
  }

  private isSpringOvershooting({
    fromValue,
    toValue,
    value,
  }: {
    fromValue: number;
    toValue: number;
    value: number;
  }) {
    let isOvershooting = false;
    if (this.options.overshootClamping && this.options.stiffness !== 0) {
      if (fromValue < toValue) {
        isOvershooting = value > toValue;
      } else {
        isOvershooting = value < toValue;
      }
    }
    return isOvershooting;
  }

  private isSpringAtRest({
    toValue,
    value,
    velocity,
  }: {
    toValue: number;
    value: number;
    velocity: number;
  }) {
    let isNoVelocity = Math.abs(velocity) <= this.options.restVelocityThreshold;
    let isNoDisplacement =
      this.options.stiffness !== 0 &&
      Math.abs(toValue - value) <= this.options.restDisplacementThreshold;
    return isNoDisplacement && isNoVelocity;
  }

  private finalizeSpring(
    frame: Frame,
    fromValue: number,
    toValue: number,
  ): Frame {
    let { velocity, value } = frame;

    // If the Spring is overshooting (when overshoot clamping is on), or if the
    // spring is at rest (based on the thresholds set in the config), stop the
    // animation.
    if (
      (this.isSpringOvershooting({
        fromValue,
        toValue,
        value,
      }) ||
        this.isSpringAtRest({
          toValue,
          value,
          velocity,
        })) &&
      this.options.stiffness !== 0
    ) {
      // Ensure that we end up with a round value
      return {
        value: toValue,
        velocity: 0,
      };
    }

    return {
      value,
      velocity,
    };
  }

  private getSpringFunction({
    fromValue,
    toValue,
    initialVelocity,
  }: SpringValues): (t: number) => Frame {
    let { damping: c, mass: m, stiffness: k, allowsOverdamping } = this.options;
    let v0 = initialVelocity ?? 0;

    let zeta = c / (2 * Math.sqrt(k * m)); // damping ratio (dimensionless)

    let omega0 = Math.sqrt(k / m) / 1000; // undamped angular frequency of the oscillator (rad/ms)
    let omega1 = omega0 * Math.sqrt(1.0 - zeta * zeta); // exponential decay
    let omega2 = omega0 * Math.sqrt(zeta * zeta - 1.0); // frequency of damped oscillation
    let x0 = toValue - fromValue; // initial displacement of the spring at t = 0

    if (zeta > 1 && !allowsOverdamping) {
      zeta = 1;
    }

    if (zeta < 1) {
      // Underdamped
      return (t: number): Frame => {
        let envelope = Math.exp(-zeta * omega0 * t);
        let oscillation =
          toValue -
          envelope *
            (((v0 + zeta * omega0 * x0) / omega1) * Math.sin(omega1 * t) +
              x0 * Math.cos(omega1 * t));

        // Derivative of the oscillation function
        let velocity =
          zeta *
            omega0 *
            envelope *
            ((Math.sin(omega1 * t) * (v0 + zeta * omega0 * x0)) / omega1 +
              x0 * Math.cos(omega1 * t)) -
          envelope *
            (Math.cos(omega1 * t) * (v0 + zeta * omega0 * x0) -
              omega1 * x0 * Math.sin(omega1 * t));

        return this.finalizeSpring(
          {
            value: oscillation,
            velocity,
          },
          fromValue,
          toValue,
        );
      };
    } else if (zeta === 1) {
      // Critically damped
      return (t: number): Frame => {
        let envelope = Math.exp(-omega0 * t);
        let oscillation = toValue - envelope * (x0 + (v0 + omega0 * x0) * t);
        let velocity =
          envelope * (v0 * (t * omega0 - 1) + t * x0 * (omega0 * omega0));

        return this.finalizeSpring(
          {
            value: oscillation,
            velocity,
          },
          fromValue,
          toValue,
        );
      };
    } else {
      // Overdamped
      return (t: number): Frame => {
        let envelope = Math.exp(-zeta * omega0 * t);
        let oscillation =
          toValue -
          (envelope *
            ((v0 + zeta * omega0 * x0) * Math.sinh(omega2 * t) +
              omega2 * x0 * Math.cosh(omega2 * t))) /
            omega2;
        let velocity =
          (envelope *
            zeta *
            omega0 *
            (Math.sinh(omega2 * t) * (v0 + zeta * omega0 * x0) +
              x0 * omega2 * Math.cosh(omega2 * t))) /
            omega2 -
          (envelope *
            (omega2 * Math.cosh(omega2 * t) * (v0 + zeta * omega0 * x0) +
              omega2 * omega2 * x0 * Math.sinh(omega2 * t))) /
            omega2;
        return this.finalizeSpring(
          {
            value: oscillation,
            velocity,
          },
          fromValue,
          toValue,
        );
      };
    }
  }

  private *springToFrames(values: SpringValues): FrameGenerator {
    let { fromValue, toValue, initialVelocity } = values;

    if (isNaN(fromValue) || isNaN(toValue)) {
      throw new Error(
        `Cannot calculate spring for non-numerical values: ${fromValue} -> ${toValue}`,
      );
    }

    let springFunction = this.getSpringFunction({
      fromValue,
      toValue,
      initialVelocity,
    });

    let time = 0;
    let value = fromValue;
    let velocity = initialVelocity;
    let deltaTimeMs = 1 / FPS;
    let i = 0;
    while (
      !this.isSpringAtRest({
        value,
        toValue,
        velocity,
      }) &&
      i < 10000
    ) {
      i++;
      let frame = springFunction(time);
      time += deltaTimeMs;
      value = frame.value;
      velocity = frame.velocity;
      yield frame;
    }
  }
}
