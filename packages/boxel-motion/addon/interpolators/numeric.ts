import {
  EasingToFramesArgument,
  Frame,
} from '@cardstack/boxel-motion/behaviors/base';
import TweenBehavior from '@cardstack/boxel-motion/behaviors/tween';
import { MotionTiming } from '@cardstack/boxel-motion/models/sprite';
import { UnitValue } from '@cardstack/boxel-motion/utils/css-to-unit-value';
import SimpleFrame, {
  UnitValueSerializer,
} from '@cardstack/boxel-motion/value/simple-frame';

export default function interpolateNumeric(
  property: string,
  from: UnitValue,
  to: UnitValue,
  timing: Partial<MotionTiming>,
  serialize?: UnitValueSerializer,
) {
  let behavior = timing.behavior || new TweenBehavior();
  if (!behavior.getFrames) {
    console.log(behavior);
    throw new Error('illegal behavior');
  }
  let generator = behavior.getFrames({
    from: from.value,
    to: to.value,
    ...timing,
  } as EasingToFramesArgument);

  let frames: SimpleFrame[] = [];
  let next = generator.next();
  while (!next.done) {
    let { value, velocity } = next.value as Frame;
    let frame = new SimpleFrame(property, value, from.unit, serialize);
    frame.velocity = velocity;
    frames.push(frame);

    next = generator.next();
  }

  return frames;
}
