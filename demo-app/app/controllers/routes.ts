import Controller from '@ember/controller';
import { Changeset } from '@cardstack/boxel-motion/models/animator';
import magicMove from '@cardstack/boxel-motion/transitions/magic-move';
import runAnimations from '@cardstack/boxel-motion/utils/run-animations';

export default class RoutesController extends Controller {
  async transition(changeset: Changeset): Promise<void> {
    let { removedSprites, keptSprites, insertedSprites, context } = changeset;

    magicMove({ keptSprites } as Changeset, {
      duration: 1000,
    });

    insertedSprites.forEach((s) => {
      s.setupAnimation('position', {
        startX: -s.finalBounds!.relativeToContext.width,
        duration: 1000,
      });
    });

    removedSprites.forEach((s) =>{
      if (context.hasOrphan(s)) context.removeOrphan(s);
      context.appendOrphan(s);
      s.lockStyles();
      s.setupAnimation('position', {
        endX: -s.initialBounds!.relativeToContext.width,
        duration: 1000,
      })
    });

    await runAnimations([
      ...removedSprites,
      ...keptSprites,
      ...insertedSprites,
    ]);
  }
}
