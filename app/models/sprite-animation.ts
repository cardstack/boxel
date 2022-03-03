import Sprite from './sprite';

/**
 * Animates a sprite. By default, the animation is paused and must be started manually by calling `play()`.
 */
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
    this.animation.pause();

    // TODO: we likely don't need this anymore now that we measure beforehand
    /*if (sprite.type === SpriteType.Removed && keyframes.length) {
      let lastKeyframe: Keyframe = keyframes[keyframes.length - 1];
      for (let [property, value] of Object.entries(lastKeyframe)) {
        // TODO: fix typescript issue, lib.dom.d.ts seems to only accept numbers here
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        sprite.element.style[property] = value;
        console.log(property, value);
      }
    }*/
  }

  play(): void {
    this.animation.play();
  }

  get finished(): Promise<Animation> {
    return this.animation.finished;
  }
}
