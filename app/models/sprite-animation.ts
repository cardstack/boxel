import Sprite from './sprite';
import { defer } from 'rsvp';

/**
 * Animates a sprite. By default, the animation is paused and must be started manually by calling `play()`.
 */
export class SpriteAnimation {
  animation!: Animation;

  sprite: Sprite;
  keyframes: Keyframe[];
  keyframeAnimationOptions: KeyframeAnimationOptions;

  _finished = defer();

  constructor(
    sprite: Sprite,
    keyframes: Keyframe[],
    keyframeAnimationOptions: KeyframeAnimationOptions
  ) {
    this.sprite = sprite;
    this.keyframes = keyframes;
    this.keyframeAnimationOptions = {
      ...keyframeAnimationOptions,
      id: sprite.identifier.toString(),
    };
  }

  play(): void {
    if (!this.animation) {
      this.animation = this.sprite.element.animate(
        this.keyframes,
        this.keyframeAnimationOptions
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
    this.animation.play();
  }

  get finished(): Promise<Animation> {
    return this._finished.promise as Promise<Animation>;
  }
}
