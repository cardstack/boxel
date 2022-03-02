import Motion, { BaseOptions } from './base';
import Sprite, { SpriteType } from '../models/sprite';
import { BoundsDelta } from '../models/context-aware-bounds';
import SpringBehavior from 'animations/behaviors/spring';
import BaseValue from 'animations/value';
import Behavior from 'animations/behaviors/base';
import { BoundsVelocity } from 'animations/utils/measurement';

const DEFAULT_DURATION = 300;
const DEFAULT_BEHAVIOR = SpringBehavior;

export default function move(sprite: Sprite, opts: Partial<MoveOptions>): Move {
  return new Move(sprite, opts);
}

export interface MoveOptions extends BaseOptions {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  behavior: Behavior;
  velocity: BoundsVelocity;
}

interface Position {
  x: number;
  y: number;
}
export class Move extends Motion<MoveOptions> {
  boundsDelta: BoundsDelta | undefined;
  behavior: Behavior;
  duration: number;
  x: BaseValue;
  y: BaseValue;
  keyframes: Keyframe[] = [];

  constructor(sprite: Sprite, opts: Partial<MoveOptions>) {
    super(sprite, opts);
    this.boundsDelta = sprite.boundsDelta;
    this.behavior = opts.behavior || new DEFAULT_BEHAVIOR();
    this.duration = opts.duration ?? DEFAULT_DURATION;
    this.x = new BaseValue('x', this.startPosition.x);
    this.y = new BaseValue('y', this.startPosition.y);
    this.updateKeyframes();
  }

  get startPosition(): Position {
    let { boundsDelta, opts, sprite } = this;
    let defaultStartX = boundsDelta ? -boundsDelta?.x : undefined;
    let defaultStartY = boundsDelta ? -boundsDelta?.y : undefined;
    if (sprite.type === SpriteType.Removed) {
      defaultStartX = 0;
      defaultStartY = 0;
    }
    return {
      x: opts.startX ?? defaultStartX ?? 0,
      y: opts.startY ?? defaultStartY ?? 0,
    };
  }

  get endPosition(): Position {
    let { boundsDelta, opts, sprite } = this;
    let defaultEndX: number | undefined = 0;
    let defaultEndY: number | undefined = 0;
    if (sprite.type === SpriteType.Removed) {
      defaultEndX = boundsDelta ? boundsDelta?.x : undefined;
      defaultEndY = boundsDelta ? boundsDelta?.y : undefined;
    }
    return {
      x: opts.endX ?? defaultEndX ?? 0,
      y: opts.endY ?? defaultEndY ?? 0,
    };
  }

  updateKeyframes(): void {
    let xFrames = this.x.frames;
    let yFrames = this.y.frames;

    let count = Math.max(xFrames.length, yFrames.length);

    let keyframes = [];
    for (let i = 0; i < count; i++) {
      let x = xFrames[i]?.value ?? xFrames[xFrames.length - 1]?.value ?? 0;
      let y = yFrames[i]?.value ?? yFrames[yFrames.length - 1]?.value ?? 0;
      keyframes.push({
        transform: `translate(${x}px, ${y}px)`,
      });
    }

    this.keyframes = keyframes;
  }

  applyBehavior(time?: number): void {
    this.x.applyBehavior(
      this.behavior,
      this.endPosition.x,
      this.duration,
      this.opts.delay,
      time,
      (this.opts.velocity?.x ?? 0) / -1000 // TODO: the behaviors take velocity in units per ms instead of per second
    );
    this.y.applyBehavior(
      this.behavior,
      this.endPosition.y,
      this.duration,
      this.opts.delay,
      time,
      (this.opts.velocity?.y ?? 0) / -1000
    );
    this.updateKeyframes();
  }
}
