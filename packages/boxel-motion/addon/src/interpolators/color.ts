import { type HSLA, type RGBA, color } from 'style-value-types';

import { type EasingToFramesArgument, type Frame } from '../behaviors/base.ts';
import TweenBehavior from '../behaviors/tween.ts';
import { type MotionTiming } from '../models/motion.ts';
import SimpleFrame from '../value/simple-frame.ts';

export default function interpolateColor(
  property: string,
  from: RGBA | HSLA,
  to: RGBA | HSLA,
  timing: MotionTiming,
) {
  let colorInterpolator = function (
    from: RGBA | HSLA,
    to: RGBA | HSLA,
    t: number,
  ): RGBA | HSLA {
    return Object.keys(from).reduce(
      (result, key) => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        result[key] = (1 - t) * from[key] + t * to[key];
        return result;
      },
      {} as RGBA | HSLA,
    );
  };

  let behavior = new TweenBehavior();
  // We interpolate from 0 to 1, if we want to support a spring here it might
  // make sense to calculate some "distance" for the color as a whole.
  let generator = behavior.getFrames({
    from: 0,
    to: 1,
    ...timing,
  } as EasingToFramesArgument);

  let frames: SimpleFrame[] = [];
  let next = generator.next();
  while (!next.done) {
    let { value, velocity } = next.value as Frame;
    let interpolatedColor = colorInterpolator(from, to, value);
    let frame = new SimpleFrame(property, color.transform!(interpolatedColor));
    frame.velocity = velocity;
    frames.push(frame);

    next = generator.next();
  }

  return frames;
}
