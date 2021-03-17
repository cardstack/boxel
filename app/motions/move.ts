import Motion, { BaseOptions } from './base';
import Sprite, { SpriteType } from '../models/sprite';
import { BoundsDelta } from '../models/context-aware-bounds';

const DEFAULT_DURATION = 300;

export default function move(sprite: Sprite, opts: Partial<MoveOptions>): Move {
  return new Move(sprite, opts);
}

export interface MoveOptions extends BaseOptions {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface Position {
  x: number;
  y: number;
}
export class Move extends Motion<MoveOptions> {
  boundsDelta: BoundsDelta | undefined;
  constructor(sprite: Sprite, opts: Partial<MoveOptions>) {
    super(sprite, opts);
    this.boundsDelta = sprite.boundsDelta;
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

  get keyframes(): Keyframe[] {
    let { startPosition, endPosition } = this;
    return [
      { transform: `translate(${startPosition.x}px,${startPosition.y}px)` },
      { transform: `translate(${endPosition.x}px,${endPosition.y}px)` },
    ];
  }

  get keyframeAnimationOptions(): KeyframeAnimationOptions {
    return {
      delay: this.opts.delay,
      duration: this.opts.duration ?? DEFAULT_DURATION,
      easing: this.opts.easing,
    };
  }
}
