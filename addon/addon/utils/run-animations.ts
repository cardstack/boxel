import { SpriteAnimation } from '@cardstack/boxel-motion/models/sprite-animation';
import Sprite from '@cardstack/boxel-motion/models/sprite';

/**
 * Utility to compile & run all animations that were setup for a given changeset.
 *
 * @param sprites
 * @param time
 */
export default async function runAnimations(
  sprites: Sprite[],
  time?: number
): Promise<Animation[]> {
  let animations: SpriteAnimation[] = [];
  let promises = [];
  for (let sprite of sprites) {
    let animation = sprite.compileAnimation({ time });
    if (animation) {
      animations.push(animation);
      promises.push(animation.finished);
    }
  }

  animations.forEach((a) => {
    a.play();
  });

  return Promise.all(promises);
}
