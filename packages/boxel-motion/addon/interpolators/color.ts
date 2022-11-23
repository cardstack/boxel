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

  return (timing.behavior ?? new LinearBehavior())
    .toFrames(
      {
        from,
        to,
        ...timing,
      },
      interpolator,
      serialize
    )
    .map((frame) => new SimpleFrame(property, frame.value));
}
