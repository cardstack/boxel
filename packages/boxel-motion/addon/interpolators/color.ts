import {
  EasingToFramesArgument,
  Frame,
} from '@cardstack/boxel-motion/behaviors/base';
import TweenBehavior from '@cardstack/boxel-motion/behaviors/tween';
import { MotionTiming } from '@cardstack/boxel-motion/models/sprite';
import SimpleFrame from '@cardstack/boxel-motion/value/simple-frame';
import { color, HSLA, RGBA } from 'style-value-types';

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
