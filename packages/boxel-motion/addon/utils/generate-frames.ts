import LinearBehavior from '@cardstack/boxel-motion/behaviors/linear';
import Sprite, {
  MotionOptions,
  MotionProperty,
  MotionTiming,
} from '@cardstack/boxel-motion/models/sprite';
import { parse as cssToUnitValue } from '@cardstack/boxel-motion/utils/css-to-unit-value';
import { Keyframe, Value } from '@cardstack/boxel-motion/value';
import Interpolatable from '@cardstack/boxel-motion/value/interpolatable';
import NonInterpolatable from '@cardstack/boxel-motion/value/non-interpolatable';
import SimpleFrame, { Frame } from '@cardstack/boxel-motion/value/simple-frame';
import TransformFrame from '@cardstack/boxel-motion/value/transform-frame';

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
  timing: MotionTiming
): SimpleFrame[] {
  let normalizedProperty = normalizeProperty(property);

  let frameGenerator: Interpolatable | NonInterpolatable;

  if (typeof options !== 'object') {
    frameGenerator = new NonInterpolatable(property, options as Value, timing);
  } else {
    let { from, to } = options;

    if (from === undefined) {
      // TODO: this may not be good enough, since we may also get other unitless stuff
      from = sprite.initial[normalizedProperty] as Value;
    }
    if (to === undefined) {
      to = sprite.final[normalizedProperty] as Value;
    }

    frameGenerator = new Interpolatable(
      normalizedProperty,
      [cssToUnitValue(from), cssToUnitValue(to)],
      {
        ...timing,
        behavior: timing.behavior ?? new LinearBehavior(), // TODO: we need a better setup to assign default behaviors and durations etc.
      }
    );
  }

  return frameGenerator.toFrames();
}

export function consolidateFrames(frames: Frame[]): Frame[] {
  let resultFrames: Frame[] = [];
  let consolidatedFramesMap: Map<
    new (frames: SimpleFrame[]) => Frame,
    SimpleFrame[]
  > = new Map([[TransformFrame, []]]);

  frames.forEach((frame) => {
    let matchedFrame = false;
    [...consolidatedFramesMap.entries()].forEach(([FrameClass, frameArray]) => {
      // TODO: we'll refactor this further anyway, so ignore this type issue for now
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (FrameClass.combinesProperties?.has(frame.property)) {
        matchedFrame = true;
        frameArray.push(frame as SimpleFrame);
      }
    });

    // frame is not part of a consolidated frame, so we can just push it onto the result array
    if (!matchedFrame) {
      resultFrames.push(frame);
    }
  });

  [...consolidatedFramesMap.entries()].forEach(([FrameClass, frameArray]) => {
    resultFrames.push(new FrameClass(frameArray));
  });

  return resultFrames;
}

export function generateKeyframe(frames: Frame[]): Keyframe {
  let result: Keyframe = {};
  frames.forEach((frame) => {
    result[frame.property] = frame.serializeValue();
  });

  return result;
}
