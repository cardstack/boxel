import Sprite from './sprite';

export class SpriteAnimation {
  animation: Animation;

  constructor(
    sprite: Sprite,
    keyframes: Keyframe[],
    keyframeAnimationOptions: KeyframeAnimationOptions
  ) {
    this.animation = sprite.element.animate(
      keyframes,
      keyframeAnimationOptions
    );
  }

  get finished(): Promise<Animation> {
    return this.animation.finished;
  }
}
