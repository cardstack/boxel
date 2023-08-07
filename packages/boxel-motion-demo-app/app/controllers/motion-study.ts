import StaticBehavior from '@cardstack/boxel-motion/behaviors/static';
import TweenBehavior from '@cardstack/boxel-motion/behaviors/tween';
import WaitBehavior from '@cardstack/boxel-motion/behaviors/wait';
import { easeInAndOut } from '@cardstack/boxel-motion/easings/cosine';
import { Changeset } from '@cardstack/boxel-motion/models/animator';
import { AnimationDefinition } from '@cardstack/boxel-motion/models/orchestration';
import { SpriteType } from '@cardstack/boxel-motion/models/sprite';
import Controller from '@ember/controller';

export default class MotionStudy extends Controller {
  transition(changeset: Changeset): AnimationDefinition {
    let fadeDuration = 300;
    let resizeAndMoveDuration = 500;

    let cardSprites = changeset.spritesFor({
      role: 'card',
      type: SpriteType.Kept,
    });

    let nonAnimatingCardSprites = Array.from(cardSprites).filter(
      (s) =>
        !(
          s.boundsDelta &&
          (s.boundsDelta.width !== 0 ||
            s.boundsDelta.height !== 0 ||
            s.boundsDelta.x !== 0 ||
            s.boundsDelta.y !== 0)
        ),
    );

    let removedCardSprites = changeset.spritesFor({
      role: 'card',
      type: SpriteType.Removed,
    });

    let removedCardContentSprites = changeset.spritesFor({
      role: 'card-content',
      type: SpriteType.Removed,
    });

    let cardContentSprites = changeset.spritesFor({
      role: 'card-content',
      type: SpriteType.Inserted,
    });

    let fadeOutClosingCardContent = {
      sprites: removedCardContentSprites,
      properties: {
        opacity: { to: 0 },
      },
      timing: {
        behavior: new TweenBehavior(),
        duration: fadeDuration,
      },
    };

    let moveClosingCardContentToForeground = {
      sprites: removedCardContentSprites,
      properties: {
        zIndex: 2,
      },
      timing: {
        behavior: new StaticBehavior(),
        duration: fadeDuration,
      },
    };

    let keepClosingCardContentHidden = {
      sprites: removedCardContentSprites,
      properties: {
        opacity: 0,
      },
      timing: {
        behavior: new StaticBehavior(),
        duration: resizeAndMoveDuration,
      },
    };

    let moveAllCardsToMidground = {
      sprites: cardSprites,
      properties: {
        zIndex: 1,
      },
      timing: {
        behavior: new StaticBehavior(),
        duration: fadeDuration,
      },
    };

    let moveNonAnimatingCardsToBackground = {
      sprites: new Set(nonAnimatingCardSprites),
      properties: {
        zIndex: 0,
      },
      timing: {
        behavior: new StaticBehavior(),
        duration: resizeAndMoveDuration,
      },
    };

    let resizeAnimatingCard = {
      sprites: cardSprites,
      properties: {
        translateX: {},
        translateY: {},
        width: {},
        height: {},
      },
      timing: {
        // TODO convert to SpringBehavior when its duration can be referenced by other animations
        behavior: new TweenBehavior({
          easing: easeInAndOut,
        }),
        duration: resizeAndMoveDuration,
      },
    };

    let keepCardsBeingRemovedUntilOpeningCompletes = {
      sprites: removedCardSprites,
      properties: {},
      timing: {
        behavior: new WaitBehavior(),
        duration: fadeDuration,
      },
    };

    let fadeInOpeningCardContent = {
      sprites: cardContentSprites,
      properties: {
        opacity: { from: 0 },
      },
      timing: {
        behavior: new TweenBehavior(),
        duration: fadeDuration,
      },
    };

    return {
      timeline: {
        type: 'sequence',
        animations: [
          {
            type: 'parallel',
            animations: [
              moveAllCardsToMidground,
              moveClosingCardContentToForeground,
              fadeOutClosingCardContent,
            ],
          },
          {
            type: 'parallel',
            animations: [
              keepClosingCardContentHidden,
              moveAllCardsToMidground,
              moveNonAnimatingCardsToBackground,
              resizeAnimatingCard,
              keepCardsBeingRemovedUntilOpeningCompletes,
            ],
          },
          fadeInOpeningCardContent,
        ],
      },
    };
  }

  /* imperative implementation preserved for reference
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

      // TODO: running things this way will trigger some events on the animation participant?
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
  */
}
