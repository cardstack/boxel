import Controller from '@ember/controller';
import Changeset from 'animations/models/changeset';
import magicMove from 'animations/transitions/magic-move';
import { SpriteType } from 'animations/models/sprite';
import fade from 'animations/transitions/fade';

export default class MotionStudy extends Controller {
  async transition(changeset: Changeset) {
    let { context } = changeset;

    let removedCardContentSprites = changeset.spritesFor({
      role: 'card-content',
      type: SpriteType.Removed,
    });

    if (removedCardContentSprites.size) {
      await fade({
        context,
        insertedSprites: new Set(),
        removedSprites: removedCardContentSprites,
        keptSprites: new Set(),
      } as Changeset);
    }

    let animations = [];

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
    animations.push(
      magicMove({
        context,
        insertedSprites: new Set(),
        removedSprites: new Set(),
        keptSprites: cardSprites,
      } as Changeset)
    );

    let cardContentSprites = changeset.spritesFor({
      role: 'card-content',
      type: SpriteType.Inserted,
    });
    cardContentSprites.forEach((s) => {
      s.element.style.opacity = '0';
    });

    await Promise.all(animations);

    removedCardSprites.forEach((r) => r.hide());

    await fade({
      context,
      insertedSprites: cardContentSprites,
      removedSprites: new Set(),
      keptSprites: new Set(),
    } as Changeset);

    cardContentSprites.forEach((s) => {
      s.element.style.removeProperty('opacity');
    });
  }
}
