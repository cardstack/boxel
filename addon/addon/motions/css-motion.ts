import Motion, { BaseOptions } from './base';
import Sprite from '../models/sprite';
import { assert } from '@ember/debug';
import BaseValue, { Value } from 'animations-experiment/value';
import LinearBehavior from 'animations-experiment/behaviors/linear';
import Behavior from 'animations-experiment/behaviors/base';
import { dasherize } from '@ember/string';

const DEFAULT_DURATION = 300;
const DEFAULT_BEHAVIOR = LinearBehavior;

export interface CssMotionOptions extends BaseOptions {
  property: string;
  keyframeValues: string[];
  behavior: Behavior;
}

export class CssMotion extends Motion<CssMotionOptions> {
  keyframeValues: Value[];
  property: string;
  value: BaseValue;
  duration: number;
  behavior: Behavior;

  constructor(sprite: Sprite, opts: Partial<CssMotionOptions>) {
    super(sprite, opts);
    assert(
      'required opts property and keyframeValues are passed',
      opts.property
    );
    this.property = opts.property;
    this.keyframeValues =
      opts.keyframeValues ?? this.defaultKeyframeValuesFromSprite;
    this.value = new BaseValue(opts.property, this.from);
    this.duration = opts.duration ?? DEFAULT_DURATION;
    this.behavior = opts.behavior ?? new DEFAULT_BEHAVIOR();

    assert(
      'keyframeValues must be an array of length 2',
      this.keyframeValues?.length === 2
    );
  }

  get from(): Value {
    return this.keyframeValues[0];
  }

  get to(): Value {
    return this.keyframeValues[1];
  }

  get defaultKeyframeValuesFromSprite(): string[] {
    let dasherizedProperty = dasherize(this.property);
    let { initialComputedStyle, finalComputedStyle } = this.sprite;
    if (
      initialComputedStyle &&
      initialComputedStyle[dasherizedProperty] &&
      finalComputedStyle &&
      finalComputedStyle[dasherizedProperty]
    ) {
      return [
        initialComputedStyle[dasherizedProperty],
        finalComputedStyle[dasherizedProperty],
      ];
    }
    return [];
  }

  get keyframes(): Keyframe[] {
    return this.value.keyframes;
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  applyBehavior(time?: number): void {
    this.value.applyBehavior(
      this.behavior,
      this.to,
      this.duration,
      this.opts.delay,
      time
    );
  }
}
