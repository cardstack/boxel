import Motion, { BaseOptions } from './base';
import Sprite from '../models/sprite';

const DEFAULT_DURATION = 300;

export interface ResizeOptions extends BaseOptions {
  startWidth: number;
  startHeight: number;
  endWidth: number;
  endHeight: number;
}

interface Size {
  width: number;
  height: number;
}

export class Resize extends Motion<ResizeOptions> {
  constructor(sprite: Sprite, opts: Partial<ResizeOptions>) {
    super(sprite, opts);
  }

  get startSize(): Size {
    let { opts, sprite } = this;
    return {
      width: opts.startWidth ?? sprite.initialWidth ?? 0,
      height: opts.startHeight ?? sprite.initialHeight ?? 0,
    };
  }

  get endSize(): Size {
    let { opts, sprite } = this;
    return {
      width: opts.endWidth ?? sprite.finalWidth ?? 0,
      height: opts.endHeight ?? sprite.finalHeight ?? 0,
    };
  }

  get keyframes(): Keyframe[] {
    let { startSize, endSize } = this;
    return [
      { width: `${startSize.width}px`, height: `${startSize.height}px` },
      { width: `${endSize.width}px`, height: `${endSize.height}px` },
    ];
  }

  get keyframeAnimationOptions(): KeyframeAnimationOptions {
    let { opts } = this;
    return {
      delay: opts.delay,
      duration: opts.duration ?? DEFAULT_DURATION,
      easing: opts.easing,
    };
  }
}
