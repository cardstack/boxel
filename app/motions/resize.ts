import Motion, { BaseOptions } from './base';
import Sprite from '../models/sprite';
import Behavior from 'animations/behaviors/base';
import { BoundsVelocity } from 'animations/utils/measurement';
import BaseValue from 'animations/value';
import SpringBehavior from 'animations/behaviors/spring';

const DEFAULT_DURATION = 300;
const DEFAULT_BEHAVIOR = SpringBehavior;

export interface ResizeOptions extends BaseOptions {
  startWidth: number;
  startHeight: number;
  endWidth: number;
  endHeight: number;
  behavior: Behavior;
  velocity: BoundsVelocity;
}

interface Size {
  width: number;
  height: number;
}

export class Resize extends Motion<ResizeOptions> {
  behavior: Behavior;
  duration: number;
  height: BaseValue;
  width: BaseValue;

  constructor(sprite: Sprite, opts: Partial<ResizeOptions>) {
    super(sprite, opts);

    this.behavior = opts.behavior || new DEFAULT_BEHAVIOR();
    this.duration = opts.duration ?? DEFAULT_DURATION;
    console.log(
      sprite.initialWidth,
      sprite.initialHeight,
      sprite.finalWidth,
      sprite.finalHeight
    );
    this.width = new BaseValue('width', this.startSize.width);
    this.height = new BaseValue('height', this.startSize.height);
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
    let widthFrames = this.width.frames;
    let heightFrames = this.height.frames;

    let count = Math.max(widthFrames.length, heightFrames.length);

    let keyframes = [];
    for (let i = 0; i < count; i++) {
      let width =
        widthFrames[i]?.value ??
        widthFrames[widthFrames.length - 1]?.value ??
        0;
      let height =
        heightFrames[i]?.value ??
        heightFrames[heightFrames.length - 1]?.value ??
        0;
      keyframes.push({
        width: `${width}px`,
        height: `${height}px`,
      });
    }

    return keyframes;
  }

  applyBehavior(time?: number): void {
    this.width.applyBehavior(
      this.behavior,
      this.endSize.width,
      this.duration,
      this.opts.delay,
      time,
      (this.opts.velocity?.width ?? 0) / -1000 // TODO: the behaviors take velocity in units per ms instead of per second
    );
    this.height.applyBehavior(
      this.behavior,
      this.endSize.height,
      this.duration,
      this.opts.delay,
      time,
      (this.opts.velocity?.height ?? 0) / -1000
    );
  }
}
