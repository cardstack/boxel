import Controller from '@ember/controller';
import Sprite, { SpriteType } from '@cardstack/boxel-motion/models/sprite';
import { Changeset } from '@cardstack/boxel-motion/models/changeset';
import magicMove from '@cardstack/boxel-motion/transitions/magic-move';
import { assert } from '@ember/debug';
import ContextAwareBounds from '@cardstack/boxel-motion/models/context-aware-bounds';
import runAnimations from '@cardstack/boxel-motion/utils/run-animations';
import SpringBehavior from '@cardstack/boxel-motion/behaviors/spring';

const springBehavior = new SpringBehavior({
  overshootClamping: true,
  damping: 100,
});

export default class RoutesController extends Controller {
  async transition(changeset: Changeset): Promise<void> {
    let { removedSprites, keptSprites, insertedSprites, context } = changeset;

    magicMove({ keptSprites } as Changeset, {
      duration: 1000,
    });

    insertedSprites.forEach((s) =>
      s.setupAnimation('position', {
        startX: -s.finalBounds!.relativeToContext.width,
        duration: 1000,
      })
    );

    removedSprites.forEach((s) =>
      s.setupAnimation('position', {
        endX: -s.initialBounds!.relativeToContext.width,
        duration: 1000,
      })
    );

    await runAnimations([
      ...removedSprites,
      ...keptSprites,
      ...insertedSprites,
    ]);
  }
}
