import Motion, { BaseOptions } from './base';
import Sprite from '../models/sprite';
import { assert } from '@ember/debug';
import { dasherize } from '@ember/string';

const DEFAULT_DURATION = 300;

export interface CssMotionOptions extends BaseOptions {
  property: string;
  keyframeValues: string[];
}

export class CssMotion extends Motion<CssMotionOptions> {
  property: string;
  keyframeValues: string[] | undefined;
  constructor(sprite: Sprite, opts: Partial<CssMotionOptions>) {
    super(sprite, opts);
    assert(
      'required opts property and keyframeValues are passed',
      opts.property
    );
    this.property = opts.property;
    this.keyframeValues = opts.keyframeValues;
  }

  get defaultKeyframeValuesFromSprite(): string[] | undefined {
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
    return undefined;
  }

  get keyframes(): Keyframe[] {
    let values = this.keyframeValues || this.defaultKeyframeValuesFromSprite;
    assert(
      'either keyframeValues must be passed, or values must be inferrable from captured sprite styles',
      values
    );
    return values.map((v) => {
      let result: Record<string, string> = {};
      result[this.property] = v;
      return result;
    });
  }

  get keyframeAnimationOptions(): KeyframeAnimationOptions {
    return {
      delay: this.opts.delay,
      duration: this.opts.duration ?? DEFAULT_DURATION,
      easing: this.opts.easing,
    };
  }
}
