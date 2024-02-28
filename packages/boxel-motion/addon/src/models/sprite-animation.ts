import { defer } from 'rsvp';

import Sprite, { SpriteType } from './sprite.ts';

/**
 * Animates a sprite. By default, the animation is paused and must be started manually by calling `play()`.
 */
export class SpriteAnimation {
  animation!: Animation;

  sprite: Sprite;
  keyframes: Keyframe[];
  keyframeAnimationOptions: KeyframeAnimationOptions;

  _finished = defer();
  animationStartCallback: (animation: Animation) => void;

  constructor(
    sprite: Sprite,
    keyframes: Keyframe[],
    keyframeAnimationOptions: KeyframeAnimationOptions,
    animationStartCallback: (animation: Animation) => void,
  ) {
    this.sprite = sprite;
    this.keyframes = keyframes;
    this.keyframeAnimationOptions = {
      ...keyframeAnimationOptions,
      fill: sprite.type === SpriteType.Removed ? 'forwards' : undefined,
      id: sprite.identifier.toString(),
    };
    this.animationStartCallback = animationStartCallback;
  }

  play(): void {
    if (!this.animation) {
      this.animation = this.sprite.element.animate(
        this.keyframes,
        this.keyframeAnimationOptions,
      );
      this.animation.finished
        .then(() => this._finished.resolve(this.animation))
        .catch((error) => {
          if (
            error instanceof DOMException &&
            error.message === 'The user aborted a request.'
          ) {
            console.warn(`A sprite animation's web animation was cancelled`);
            return;
          }

          throw error;
        });
    }
    this.animationStartCallback(this.animation);
    this.animation.play();
  }

  get finished(): Promise<Animation> {
    return this._finished.promise as Promise<Animation>;
  }
}
