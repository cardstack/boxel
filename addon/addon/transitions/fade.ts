import { Changeset } from '../models/animator';
import { TransitionOptions } from '@cardstack/boxel-motion/transitions/magic-move';

/**
  Fades inserted, removed, and kept sprites.

  @function fade
  @export default
*/
export default async function (
  { context, removedSprites, insertedSprites, keptSprites }: Changeset,
  options: TransitionOptions = {}
): Promise<void> {
  let { behavior, duration } = options;

  for (let s of [...removedSprites]) {
    context.appendOrphan(s);
    s.lockStyles();
    s.setupAnimation('opacity', { to: 0, behavior, duration });
  }

  // TODO: if we get keptSprites of some things
  // were fading out and then we should get interrupted and decide to
  // keep them around after all.
  for (let s of [...insertedSprites, ...keptSprites]) {
    s.setupAnimation('opacity', { from: 0, behavior, duration });
  }
}
