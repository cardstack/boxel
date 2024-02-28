import { dasherize } from '@ember/string';
import {
  type HSLA,
  type RGBA,
  color,
  complex,
  number as numberValueType,
} from 'style-value-types';

import { type Frame, type FrameGenerator } from '../behaviors/base.ts';
import SpringBehavior from '../behaviors/spring.ts';
import StaticBehavior from '../behaviors/static.ts';
import WaitBehavior from '../behaviors/wait.ts';
import interpolateColor from '../interpolators/color.ts';
import interpolateNumeric from '../interpolators/numeric.ts';
import {
  type MotionOptions,
  type MotionProperty,
  type MotionTiming,
} from '../models/motion.ts';
import type Sprite from '../models/sprite.ts';
import { parse as cssToUnitValue } from '../utils/css-to-unit-value.ts';
import { type Value } from '../value/index.ts';
import SimpleFrame from '../value/simple-frame.ts';

export function normalizeProperty(property: string): string {
  // TODO: possibly dasherize property argument

  let propertyMap = new Map([
    ['x', 'translateX'],
    ['y', 'translateY'],
    ['z', 'translateZ'],
  ]);
  return propertyMap.get(property) ?? property;
}

function resolveFrameGenerator(property: string, generator: FrameGenerator) {
  let frames: SimpleFrame[] = [];
  let next = generator.next();
  while (!next.done) {
    let frame;
    if (next.value) {
      let { value, velocity } = next.value as Frame;

      frame = new SimpleFrame(property, value);
      frame.velocity = velocity ?? 0;
    }
    frames.push(frame as SimpleFrame);

    next = generator.next();
  }

  return frames;
}

export default function generateFrames(
  sprite: Sprite,
  property: MotionProperty,
  options: MotionOptions | Value,
  timingArg: Partial<MotionTiming>,
): SimpleFrame[] {
  let normalizedProperty = normalizeProperty(property);

  // TODO: this is temporary, since we likely won't require to pass a behavior to generateFrames since we'll assign defaults
  let timing = timingArg as MotionTiming;

  if (timing.behavior instanceof WaitBehavior) {
    if (!timing.duration) {
      throw new Error('Wait behavior requires a duration');
    }

    let generator = new WaitBehavior().getFrames({
      duration: timing.duration,
    });

    return resolveFrameGenerator(normalizedProperty, generator);
  }

  if (typeof options !== 'object') {
    if (!(timing.behavior instanceof StaticBehavior)) {
      throw new Error(
        'Behavior must be StaticBehavior when passing a Value instead of MotionOptions',
      );
    }

    if (!timing.duration) {
      throw new Error('Static behavior requires a duration');
    }

    // todo maybe throw error if options is not numeric or string
    let generator = new StaticBehavior().getFrames({
      duration: timing.duration,
      value: options as Value,
    });

    return resolveFrameGenerator(normalizedProperty, generator);
  } else {
    let { from, to } = options;

    // if no from or to is defined, we assign the value from the before or after render snapshots respectively
    if (from === undefined) {
      // TODO: this may not be good enough, since we may also get other unitless stuff
      from = sprite.initial[dasherize(normalizedProperty)] as Value;
    }
    if (to === undefined) {
      to = sprite.final[dasherize(normalizedProperty)] as Value;
    }

    // TODO: this is naïve as we may be getting from/to defined in
    //  different manners, but it should catch most things for now.
    if (from === to) {
      return [];
    }

    if (
      numberValueType.test(from) ||
      (typeof from === 'string' && from.split(' ').length === 1)
    ) {
      return interpolateNumeric(
        normalizedProperty,
        cssToUnitValue(from),
        cssToUnitValue(to),
        timing,
      );
    }

    if (color.test(from)) {
      if (!color.test(to)) {
        throw new Error('From is a color, but to is not');
      }
      // TODO: guard against from/to being different color types of color definitions (RGBA, HSLA etc.)

      let fromParts = color.parse(from);
      let toParts = color.parse(to);

      return interpolateColor(normalizedProperty, fromParts, toParts, timing);
    }

    if (complex.test(from)) {
      let fromParts = complex.parse(from);
      let toParts = complex.parse(to);
      let serialize = complex.createTransformer(from);

      if (timing.behavior instanceof SpringBehavior) {
        throw new Error(
          'Spring behavior is not currently supported for complex values',
        );
      }

      // we do not support a spring here currently since everything needs to have the same duration
      let frameSet = fromParts.map((v, index) => {
        if (typeof v === 'object') {
          return interpolateColor(
            normalizedProperty,
            fromParts[index] as RGBA | HSLA,
            toParts[index] as RGBA | HSLA,
            timing,
          ).map((frame) => frame.value);
        } else {
          let _timing = {
            ...timing,
          };

          // if from and to are identical, we use a static behavior instead of whatever is passed in
          if (fromParts[index] === toParts[index]) {
            let generator = new StaticBehavior().getFrames({
              value: fromParts[index] as number,
              duration: timing.duration as number,
            });

            let frames: Value[] = [];
            let next = generator.next();
            while (!next.done) {
              let { value } = next.value as Frame;
              if (value) {
                frames.push(value);
              }

              next = generator.next();
            }

            return frames;
          }

          return interpolateNumeric(
            normalizedProperty,
            cssToUnitValue(fromParts[index] as number),
            cssToUnitValue(toParts[index] as number),
            _timing,
          ).map((frame) => frame.value);
        }
      });

      let result: SimpleFrame[] = [];
      frameSet[0]!.forEach((_, index) => {
        let values = frameSet.reduce(
          (result, frames) => {
            result.push(frames[index]!);
            return result;
          },
          [] as (Value | RGBA | HSLA)[],
        );
        result.push(new SimpleFrame(normalizedProperty, serialize(values)));
      });

      return result;
    }

    console.error(
      `Couldn't match value ${from} of property ${property} to a known type.`,
    );
  }

  return [];
}
