import Sprite, { SpriteType } from './sprite';
import { defer } from 'rsvp';

/**
 * Animates a sprite. By default, the animation is paused and must be started manually by calling `play()`.
 */
export class SpriteAnimation {
  animation!: Animation;

  sprite: Sprite;
  keyframes: Keyframe[];
  keyframeAnimationOptions: KeyframeAnimationOptions;
  keepAliveFor?: number;

  _finished = defer();

  constructor(
    sprite: Sprite,
    keyframes: Keyframe[],
    keyframeAnimationOptions: KeyframeAnimationOptions,
    keepAliveFor?: number
  ) {
    this.sprite = sprite;
    this.keyframes = keyframes;
    this.keyframeAnimationOptions = {
      ...keyframeAnimationOptions,
      fill: sprite.type === SpriteType.Removed ? 'forwards' : undefined,
      id: sprite.identifier.toString(),
    };
    this.keepAliveFor = keepAliveFor;
  }

  play(): void {
    if (!this.animation) {
      let endDelay =
        this.keepAliveFor &&
        this.keepAliveFor > Number(this.keyframeAnimationOptions.duration!)
          ? this.keepAliveFor -
            (this.keyframeAnimationOptions.duration as number)
          : undefined;
      this.animation = this.sprite.element.animate(this.keyframes, {
        ...this.keyframeAnimationOptions,
        endDelay,
      });
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
