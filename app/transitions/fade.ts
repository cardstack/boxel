import Changeset from '../models/changeset';
import { SpriteAnimation } from '../models/sprite-animation';

/**
  Fades inserted, removed, and kept sprites.

  @function fade
  @export default
*/
// const FADE_DURATION = 1500;

export default async function ({
  context,
  removedSprites,
  insertedSprites,
  keptSprites,
}: Changeset): Promise<void> {
  let animations: SpriteAnimation[] = [];
  for (let s of [...removedSprites]) {
    context.appendOrphan(s);
    s.lockStyles();
    s.setupAnimation('opacity', { to: 0 });
    animations.push(s.startAnimation());
  }

  // TODO: if we get keptSprites of some things
  // were fading out and then we should get interrupted and decide to
  // keep them around after all.
  for (let s of [...insertedSprites, ...keptSprites]) {
    s.setupAnimation('opacity', { from: 0 });
    animations.push(s.startAnimation());
  }

  await Promise.all(animations.map((a) => a.finished));
}
