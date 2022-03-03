import { SpriteAnimation } from 'animations/models/sprite-animation';
import Changeset from 'animations/models/changeset';

/**
 * Utility to compile & run all animations that were setup for a given changeset.
 *
 * @param changeset
 * @param time
 */
export default async function runAnimations(
  changeset: Changeset,
  time?: number
): Promise<Animation[]> {
  let { keptSprites, insertedSprites, removedSprites } = changeset;
  let animations: SpriteAnimation[] = [];
  let promises = [];
  for (let sprite of [...keptSprites, ...insertedSprites, ...removedSprites]) {
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
