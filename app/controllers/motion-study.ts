import Controller from '@ember/controller';
import Changeset from 'animations/models/changeset';
import magicMove from 'animations/transitions/magic-move';
import { SpriteType } from 'animations/models/sprite';
import fade from 'animations/transitions/fade';
import runAnimations from 'animations/utils/run-animations';

export default class MotionStudy extends Controller {
  async transition(changeset: Changeset): Promise<void> {
    let { context } = changeset;

    let removedCardContentSprites = changeset.spritesFor({
      role: 'card-content',
      type: SpriteType.Removed,
    });

    if (removedCardContentSprites.size) {
      fade({
        context,
        insertedSprites: new Set(),
        removedSprites: removedCardContentSprites,
        keptSprites: new Set(),
      } as Changeset);
    }

    let removedCardSprites = changeset.spritesFor({
      role: 'card',
      type: SpriteType.Removed,
    });
    removedCardSprites.forEach((removedSprite) => {
      context.appendOrphan(removedSprite);
      removedSprite.lockStyles();
      removedSprite.element.style.zIndex = '0';
    });

    let cardSprites = changeset.spritesFor({
      role: 'card',
      type: SpriteType.Kept,
    });

    magicMove({
      context,
      insertedSprites: new Set(),
      removedSprites: new Set(),
      keptSprites: cardSprites,
    } as Changeset);

    let cardContentSprites = changeset.spritesFor({
      role: 'card-content',
      type: SpriteType.Inserted,
    });
    cardContentSprites.forEach((s) => {
      s.element.style.opacity = '0';
    });

    await runAnimations(changeset);

    removedCardSprites.forEach((r) => r.hide());

    fade({
      context,
      insertedSprites: cardContentSprites,
      removedSprites: new Set(),
      keptSprites: new Set(),
    } as Changeset);

    await runAnimations(changeset);

    cardContentSprites.forEach((s) => {
      s.element.style.removeProperty('opacity');
    });
  }
}
