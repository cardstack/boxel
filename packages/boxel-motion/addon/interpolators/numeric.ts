import LinearBehavior from '@cardstack/boxel-motion/behaviors/linear';
import { MotionTiming } from '@cardstack/boxel-motion/models/sprite';
import { UnitValue } from '@cardstack/boxel-motion/utils/css-to-unit-value';
import SimpleFrame, {
  UnitValueSerializer,
} from '@cardstack/boxel-motion/value/simple-frame';

export default function interpolateNumeric(
  property: string,
  from: UnitValue,
  to: UnitValue,
  timing: MotionTiming,
  serialize?: UnitValueSerializer
) {
  let interpolatedValues = (timing.behavior ?? new LinearBehavior()).toFrames({
    from: from.value,
    to: to.value,
    ...timing,
  });

  // TODO: we should pass this as a "transform" on the behavior instead to save a loop
  return interpolatedValues.map(
    (frame) => new SimpleFrame(property, frame.value, from.unit, serialize)
  );
}
