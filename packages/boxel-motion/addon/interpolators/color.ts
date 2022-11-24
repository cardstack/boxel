import LinearBehavior from '@cardstack/boxel-motion/behaviors/linear';
import { MotionTiming } from '@cardstack/boxel-motion/models/sprite';
import SimpleFrame from '@cardstack/boxel-motion/value/simple-frame';
import { color, HSLA, RGBA } from 'style-value-types';

export default function interpolateColor(
  property: string,
  from: RGBA | HSLA,
  to: RGBA | HSLA,
  timing: MotionTiming,
  serialize = color.transform
) {
  let interpolator = function (from: RGBA | HSLA, to: RGBA | HSLA, t: number) {
    return Object.keys(from).reduce((result, key) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      result[key] = (1 - t) * from[key] + t * to[key];
      return result;
    }, {});
  };

  // TODO: revisit the toFrames interface to take either a numeric from/to OR an interpolator
  //  function which already has knowledge about the whatever from/to is

  return (timing.behavior ?? new LinearBehavior())
    .toFrames(
      {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        from,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        to,
        ...timing,
      },
      interpolator,
      serialize
    )
    .map((frame) => new SimpleFrame(property, frame.value));
}
