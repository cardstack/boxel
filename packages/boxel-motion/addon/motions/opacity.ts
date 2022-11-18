import Behavior from '@cardstack/boxel-motion/behaviors/base';
import LinearBehavior from '@cardstack/boxel-motion/behaviors/linear';

import BaseValue from '@cardstack/boxel-motion/value';

import Sprite from '../models/sprite';

import Motion, { BaseOptions } from './base';

const DEFAULT_DURATION = 300;
const DEFAULT_BEHAVIOR = LinearBehavior;

function safeParseInt(val: string | undefined) {
  return val == undefined ? undefined : parseInt(val);
}
export interface OpacityOptions extends BaseOptions {
  from?: number;
  to?: number;
  behavior?: Behavior;
}

export class Opacity extends Motion<OpacityOptions> {
  behavior: Behavior;
  duration: number;
  value: BaseValue;
  keyframes: Keyframe[] = [];

  constructor(sprite: Sprite, opts: Partial<OpacityOptions>) {
    super(sprite, opts);

    this.behavior = opts.behavior || new DEFAULT_BEHAVIOR();
    this.duration = opts.duration ?? DEFAULT_DURATION;
    this.value = new BaseValue('opacity', this.from);

    //this.updateKeyframes();
  }

  get from(): number {
    let initialSpriteValue = safeParseInt(
      this.sprite.initialComputedStyle?.opacity
    );
    return this.opts.from ?? initialSpriteValue ?? 0;
  }

  get to(): number {
    let finalSpriteValue = safeParseInt(
      this.sprite.finalComputedStyle?.opacity
    );
    return this.opts.to ?? finalSpriteValue ?? 1;
  }

  updateKeyframes(): void {
    let frames = this.value.frames;

    let keyframes = [];
    for (let frame of frames) {
      keyframes.push({
        opacity: `${frame.value ?? 0}`,
      });
    }

    this.keyframes = keyframes;
  }

  applyBehavior(time?: number): void {
    this.value.applyBehavior(
      this.behavior,
      this.to,
      this.duration,
      this.opts.delay,
      time
    );
    this.updateKeyframes();
  }
}
