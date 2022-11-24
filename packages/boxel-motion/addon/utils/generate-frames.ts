import SpringBehavior from '@cardstack/boxel-motion/behaviors/spring';
import interpolateColor from '@cardstack/boxel-motion/interpolators/color';
import Sprite, {
  MotionOptions,
  MotionProperty,
  MotionTiming,
} from '@cardstack/boxel-motion/models/sprite';
import { parse as cssToUnitValue } from '@cardstack/boxel-motion/utils/css-to-unit-value';
import { Value } from '@cardstack/boxel-motion/value';
import SimpleFrame from '@cardstack/boxel-motion/value/simple-frame';
import { dasherize } from '@ember/string';
import {
  color,
  complex,
  HSLA,
  number as numberValueType,
  RGBA,
} from 'style-value-types';

import StaticBehavior from '../behaviors/static';
import WaitBehavior from '../behaviors/wait';

import interpolateNumeric from '../interpolators/numeric';

export function normalizeProperty(property: string): string {
  // TODO: possibly dasherize property argument

  let propertyMap = new Map([
    ['x', 'translateX'],
    ['y', 'translateY'],
  ]);
  return propertyMap.get(property) ?? property;
}

export default function generateFrames(
  sprite: Sprite,
  property: MotionProperty,
  options: MotionOptions | Value,
  timingArg: Partial<MotionTiming>
): SimpleFrame[] {
  let normalizedProperty = normalizeProperty(property);

  // TODO: this is temporary, since we likely won't require to pass a behavior to generateFrames since we'll assign defaults
  let timing = timingArg as MotionTiming;

  if (typeof options !== 'object' || timing.behavior instanceof WaitBehavior) {
    if (!timing.duration) {
      throw new Error('Static behavior requires a duration');
    }

    // TODO: use a "static" behavior
    if (property === 'wait') {
      return new WaitBehavior().toFrames({
        duration: timing.duration,
      }) as unknown as SimpleFrame[];
    }

    // todo maybe throw error if options is not numeric or string

    return new StaticBehavior()
      .toFrames({
        duration: timing.duration,
        value: options as Value,
      })
      .map((f) => new SimpleFrame(normalizedProperty, f.value));
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

    if (
      numberValueType.test(from) ||
      (typeof from === 'string' && from.split(' ').length === 1)
    ) {
      return interpolateNumeric(
        normalizedProperty,
        cssToUnitValue(from),
        cssToUnitValue(to),
        timing
      );
    }

    if (color.test(from)) {
      if (!color.test(to)) {
        throw new Error('From is a color, but to is not');
      }

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
          'Spring behavior is not currently supported for complex values'
        );
      }

      // we do not support a spring here currently since everything needs to have the same duration
      let frameSet = fromParts.map((v, index) => {
        if (typeof v === 'object') {
          return interpolateColor(
            normalizedProperty,
            fromParts[index] as RGBA | HSLA,
            toParts[index] as RGBA | HSLA,
            timing
          ).map((frame) => frame.value);
        } else {
          let _timing = {
            ...timing,
          };

          // if from and to are identical, we use a static behavior instead of whatever is passed in
          if (fromParts[index] === toParts[index]) {
            return new StaticBehavior()
              .toFrames({
                value: fromParts[index] as number,
                duration: timing.duration as number,
              })
              .map((frame) => frame.value);
          }

          return interpolateNumeric(
            normalizedProperty,
            cssToUnitValue(fromParts[index] as number),
            cssToUnitValue(toParts[index] as number),
            _timing
          ).map((frame) => frame.value);
        }
      });

      let result: SimpleFrame[] = [];
      frameSet[0]!.forEach((_, index) => {
        let values = frameSet.reduce((result, frames) => {
          result.push(frames[index]!);
          return result;
        }, [] as (Value | RGBA | HSLA)[]);
        result.push(new SimpleFrame(normalizedProperty, serialize(values)));
      });

      return result;
    }

    console.error(
      `Couldn't match value ${from} of property ${property} to a known type.`
    );
  }

  return [];
}
