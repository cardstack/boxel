import Motion, { BaseOptions } from './base';
import Sprite from '../models/sprite';
import Behavior from 'animations-experiment/behaviors/base';
import { BoundsVelocity } from 'animations-experiment/utils/measurement';
import BaseValue from 'animations-experiment/value';
import SpringBehavior from 'animations-experiment/behaviors/spring';

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
  keyframes: Keyframe[] = [];

  constructor(sprite: Sprite, opts: Partial<ResizeOptions>) {
    super(sprite, opts);

    this.behavior = opts.behavior || new DEFAULT_BEHAVIOR();
    this.duration = opts.duration ?? DEFAULT_DURATION;
    this.width = new BaseValue('width', this.startSize.width);
    this.height = new BaseValue('height', this.startSize.height);
    //this.updateKeyframes();
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

  updateKeyframes(): void {
    let widthFrames = this.width.frames;
    let heightFrames = this.height.frames;

    let count = Math.max(widthFrames.length, heightFrames.length);

    let keyframes = [];
    for (let i = 0; i < count; i++) {
      let keyframe: Keyframe = {};

      // only add height/width to this keyframe if we need to animate the property, we could only be animating one of them.
      if (widthFrames.length) {
        let width =
          widthFrames[i]?.value ?? widthFrames[widthFrames.length - 1]?.value;
        keyframe['width'] = `${width}px`;
      }

      if (heightFrames.length) {
        let height =
          heightFrames[i]?.value ??
          heightFrames[heightFrames.length - 1]?.value;
        keyframe['height'] = `${height}px`;
      }

      keyframes.push(keyframe);
    }

    this.keyframes = keyframes;
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
    this.updateKeyframes();
  }
}
