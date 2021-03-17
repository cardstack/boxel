import Motion, { BaseOptions } from './base';
import Sprite from '../models/sprite';

const DEFAULT_DURATION = 300;

function safeParseInt(val: string | undefined) {
  return val == undefined ? undefined : parseInt(val);
}
export interface OpacityOptions extends BaseOptions {
  from?: number;
  to?: number;
}

export class Opacity extends Motion<OpacityOptions> {
  constructor(sprite: Sprite, opts: Partial<OpacityOptions>) {
    super(sprite, opts);
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

  get keyframes(): Keyframe[] {
    return [{ opacity: this.from }, { opacity: this.to }];
  }

  get keyframeAnimationOptions(): KeyframeAnimationOptions {
    return {
      delay: this.opts.delay,
      duration: this.opts.duration ?? DEFAULT_DURATION,
      easing: this.opts.easing,
    };
  }
}
