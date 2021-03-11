import { assert } from '@ember/debug';
import Changeset from '../models/changeset';
/**
  Fades inserted, removed, and kept sprites.

  @function fade
  @export default
*/
const FADE_DURATION = 300;

export default async function ({
  context,
  removedSprites,
  insertedSprites,
  keptSprites,
}: Changeset): Promise<void> {
  assert('context has an orphansElement', context.orphansElement);

  let animations: Animation[] = [];
  for (let s of [...removedSprites]) {
    context.orphansElement.appendChild(s.element);
    s.lockStyles();
    let a = s.element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: FADE_DURATION,
    });
    animations.push(a);
  }

  // TODO: if we get keptSprites of some things
  // were fading out and then we should get interrupted and decide to
  // keep them around after all.
  for (let s of [...insertedSprites, ...keptSprites]) {
    let a = s.element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: FADE_DURATION,
    });
    animations.push(a);
  }

  await Promise.all(animations.map((a) => a.finished));
  context.clearOrphans();
}
