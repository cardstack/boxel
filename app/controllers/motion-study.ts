import Controller from '@ember/controller';
import Changeset from 'animations/models/changeset';
import magicMove from 'animations/transitions/magic-move';
import { SpriteType } from 'animations/models/sprite';
import fade from 'animations/transitions/fade';
import runAnimations from 'animations/utils/run-animations';
import SpringBehavior from 'animations/behaviors/spring';

export default class MotionStudy extends Controller {
  async transition(changeset: Changeset): Promise<void> {
    let { context } = changeset;

    let behavior = new SpringBehavior({
      overshootClamping: false,
      stiffness: 100,
      damping: 15,
    });
    //let moveDuration = 1000;
    let fadeDuration = 300;
    let magicMoveDelay = 0;

    let cardSprites = changeset.spritesFor({
      role: 'card',
      type: SpriteType.Kept,
    });

    let removedCardSprites = changeset.spritesFor({
      role: 'card',
      type: SpriteType.Removed,
    });
    removedCardSprites.forEach((removedSprite) => {
      context.appendOrphan(removedSprite);
      removedSprite.lockStyles();
      removedSprite.element.style.zIndex = '0';
    });

    let removedCardContentSprites = changeset.spritesFor({
      role: 'card-content',
      type: SpriteType.Removed,
    });

    if (removedCardContentSprites.size) {
      magicMoveDelay = fadeDuration;
      fade(
        {
          context,
          insertedSprites: new Set(),
          removedSprites: removedCardContentSprites,
          keptSprites: new Set(),
        } as Changeset,
        {
          duration: fadeDuration,
        }
      );

      removedCardContentSprites.forEach((s) => {
        s.element.style.zIndex = '2';
      });

      cardSprites.forEach((s) => {
        // only lock styles & set z-index for the animating card
        if (
          s.boundsDelta &&
          (s.boundsDelta.width !== 0 ||
            s.boundsDelta.height !== 0 ||
            s.boundsDelta.x !== 0 ||
            s.boundsDelta.y !== 0)
        ) {
          s.lockStyles();
          s.element.style.zIndex = '1';
        }
      });

      await runAnimations([...removedCardContentSprites]);

      cardSprites.forEach((s) => {
        s.unlockStyles();
      });

      removedCardContentSprites.forEach((r) => r.hide());
      // TODO: this is too late as the fade duration is shorter
    }

    magicMove(
      {
        context,
        insertedSprites: new Set(),
        removedSprites: new Set(),
        keptSprites: cardSprites,
      } as Changeset,
      {
        behavior,
        //duration: moveDuration,
        delay: magicMoveDelay,
      }
    );

    let cardContentSprites = changeset.spritesFor({
      role: 'card-content',
      type: SpriteType.Inserted,
    });
    cardContentSprites.forEach((s) => {
      s.element.style.opacity = '0';
    });

    await runAnimations([...cardSprites]);

    removedCardSprites.forEach((r) => r.hide());

    fade(
      {
        context,
        insertedSprites: cardContentSprites,
        removedSprites: new Set(),
        keptSprites: new Set(),
      } as Changeset,
      {
        duration: fadeDuration,
      }
    );

    await runAnimations([...cardContentSprites]);

    cardContentSprites.forEach((s) => {
      s.element.style.removeProperty('opacity');
    });
  }
}
