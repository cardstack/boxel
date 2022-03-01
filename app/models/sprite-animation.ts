import Sprite, { SpriteType } from './sprite';

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

  get finished(): Promise<Animation> {
    return this.animation.finished;
  }
}
