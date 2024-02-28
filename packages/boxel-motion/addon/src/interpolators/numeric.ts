import { type EasingToFramesArgument, type Frame } from '../behaviors/base.ts';
import TweenBehavior from '../behaviors/tween.ts';
import { type MotionTiming } from '../models/motion.ts';
import { type UnitValue } from '../utils/css-to-unit-value.ts';
import SimpleFrame, {
  type UnitValueSerializer,
} from '../value/simple-frame.ts';

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
