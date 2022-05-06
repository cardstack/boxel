import { assert } from '@ember/debug';
import { KeyframeProvider } from '../motions/base';

export default class KeyframeGenerator {
  private copiedKeyframes = new Map<KeyframeProvider, Keyframe[]>();
  private copiedKeyframeAnimationOptions = new Map<
    KeyframeProvider,
    KeyframeAnimationOptions
  >();

  constructor(readonly motions: KeyframeProvider[]) {
    this.copyMotionData();
    this.normalizeDelays();
    this.normalizeDurations();
    this.labelKeyframeOffsets();
  }

  get keyframes(): Keyframe[] {
    let result = [];
    for (let offset of this.uniqueKeyframeOffsets) {
      let keyframe = {
        offset,
      } as Keyframe;
      for (let motion of this.motions) {
        // if motion has a keyframe for this offset, add it's prop/value to the keyframe
        let motionKeyframes = this.keyframesFor(motion);
        assert('we have keyframes for each motion', motionKeyframes);
        let motionKeyframe = motionKeyframes.find((k) => k.offset === offset);
        for (let prop in motionKeyframe) {
          if (Object.prototype.hasOwnProperty.call(motionKeyframe, prop)) {
            let value = motionKeyframe[prop];
            keyframe[prop] = value;
          }
        }
      }
      result.push(keyframe);
    }
    return result;
  }

  get keyframeAnimationOptions(): KeyframeAnimationOptions {
    let result = {} as KeyframeAnimationOptions;
    for (let motion of this.motions) {
      let motionOptions = this.keyframeAnimationOptionsFor(motion);
      for (let prop in motionOptions) {
        if (Object.prototype.hasOwnProperty.call(motionOptions, prop)) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          result[prop] = motionOptions[prop];
        }
      }
    }
    return result;
  }

  copyMotionData(): void {
    for (let motion of this.motions) {
      this.copiedKeyframes.set(
        motion,
        motion.keyframes.map((k) => {
          return { ...k };
        })
      );
      this.copiedKeyframeAnimationOptions.set(
        motion,
        Object.assign({}, motion.keyframeAnimationOptions)
      );
    }
  }

  keyframesFor(motion: KeyframeProvider): Keyframe[] {
    let result = this.copiedKeyframes.get(motion);
    assert('We have a mapping of each motions keyframes', result);
    return result;
  }

  keyframeAnimationOptionsFor(
    motion: KeyframeProvider
  ): KeyframeAnimationOptions {
    let result = this.copiedKeyframeAnimationOptions.get(motion);
    assert(
      'We have a mapping of each motions keyframeAnimationOptions',
      result
    );
    return result;
  }

  labelKeyframeOffsets(): void {
    for (let motion of this.motions) {
      let keyframes = this.keyframesFor(motion);
      keyframes[0].offset = 0;
      keyframes[keyframes.length - 1].offset = 1;
      for (let i = 0; i < keyframes.length; i++) {
        let keyframe = keyframes[i];
        if (keyframe.offset === undefined) {
          keyframe.offset = calculateOffset(keyframes, i);
        }
      }
      for (let keyframe of keyframes) {
        assert('offset has been set', keyframe.offset != null);
        keyframe.offset = Math.round(keyframe.offset * 100) / 100;
      }
    }
  }

  get uniqueKeyframeOffsets(): number[] {
    let result = new Set<number>();
    for (let motion of this.motions) {
      let keyframes = this.keyframesFor(motion);
      for (let keyframe of keyframes) {
        assert(
          'We have previously assigned an offset to every keyframe',
          keyframe.offset != undefined
        );
        result.add(keyframe.offset);
      }
    }
    return [...result].sort();
  }

  normalizeDelays(): void {
    for (let motion of this.motions) {
      let keyframeAnimationOptions = this.keyframeAnimationOptionsFor(motion);
      if (keyframeAnimationOptions.delay == null) {
        continue;
      }
      let keyframes = this.keyframesFor(motion);
      let delay = keyframeAnimationOptions.delay as number;
      let originalDuration = keyframeAnimationOptions.duration as number;
      let newDuration = delay + originalDuration;
      delete keyframeAnimationOptions.delay;
      keyframeAnimationOptions.duration = newDuration;
      let firstKeyframe = keyframes[0];
      let extraKeyframe = { ...firstKeyframe };
      keyframes.unshift(extraKeyframe);
      firstKeyframe.offset = delay / newDuration;
      for (let i = 2; i < keyframes.length - 1; i++) {
        let keyframe = keyframes[i];
        if (keyframe.offset) {
          keyframe.offset =
            (keyframe.offset * originalDuration + delay) / newDuration;
        }
      }
    }
  }

  normalizeDurations(): void {
    let durations: number[] = this.motions
      .map((m) => this.keyframeAnimationOptionsFor(m).duration as number)
      .filter((i) => Boolean(i));
    let maxDuration = Math.max(...durations);
    for (let motion of this.motions) {
      let keyframes = this.keyframesFor(motion);
      let keyframeAnimationOptions = this.keyframeAnimationOptionsFor(motion);
      if (keyframeAnimationOptions.duration == null) {
        keyframeAnimationOptions.duration = maxDuration;
      }
      if (keyframeAnimationOptions.duration !== maxDuration) {
        let lastKeyframe = keyframes[keyframes.length - 1];
        let extraKeyframe = { ...lastKeyframe };
        let originalDuration = keyframeAnimationOptions.duration as number;
        lastKeyframe.offset = originalDuration / maxDuration;
        keyframes.push(extraKeyframe);
        for (let i = 1; i < keyframes.length - 2; i++) {
          let keyframe = keyframes[i];
          if (keyframe.offset) {
            keyframe.offset =
              keyframe.offset * (originalDuration / maxDuration);
          }
        }
        keyframeAnimationOptions.duration = maxDuration;
      }
    }
  }
}

function calculateOffset(keyframes: Keyframe[], i: number): number {
  let previousOffset = keyframes[i - 1].offset;
  assert('previous offset has already been set', previousOffset != null);
  let indexOfNextKnownOffset;
  let j = i + 1;
  while (!indexOfNextKnownOffset) {
    if (keyframes[j].offset) {
      indexOfNextKnownOffset = j;
    }
    j++;
  }
  assert(
    'There is always an indexOfNextKnownOffset',
    indexOfNextKnownOffset !== undefined
  );
  let numFrames = indexOfNextKnownOffset - (i - 1);
  let nextKnownOffset = keyframes[indexOfNextKnownOffset].offset;
  assert('nextKnownOffset is defined', nextKnownOffset);
  return (nextKnownOffset - previousOffset) / numFrames + previousOffset;
}
