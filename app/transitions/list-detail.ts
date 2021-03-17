import { assert } from '@ember/debug';
import { SpriteType } from 'animations/models/sprite';
import Changeset from '../models/changeset';

// FADE OUT : ----------
// TRANSLATE:     ----------
// FADE IN  :          ----------

// const FADE_OUT_START = 0;
const FADE_OUT_DURATION = 1000;
const TRANSLATE_DURATION = 1000;
const TRANSLATE_START = 400;
const FADE_IN_DURATION = 1000;
const FADE_IN_START = 900;
// const TOTAL_DURATION = FADE_IN_START + FADE_IN_DURATION;

export default function listTransition(changeset: Changeset): Promise<void> {
  let { context, insertedSprites, keptSprites, removedSprites } = changeset;
  let animations = [];
  let direction = 'to-list';
  if (changeset.spriteFor({ type: SpriteType.Inserted, role: 'card' })) {
    direction = 'to-detail';
  }

  if (direction === 'to-list') {
    let nameSprite = changeset.spriteFor({
      role: 'person-name',
      type: SpriteType.Kept,
    });
    let titleSprite = changeset.spriteFor({
      role: 'person-title',
      type: SpriteType.Kept,
    });
    let spaceholderSprite = changeset.spriteFor({
      role: 'spaceholder',
    });
    let cardSprite = changeset.spriteFor({
      role: 'card',
    });
    assert(
      'sprites are present',
      nameSprite &&
        titleSprite &&
        spaceholderSprite &&
        spaceholderSprite.initialBounds &&
        cardSprite
    );
    spaceholderSprite.element.style.height = `${spaceholderSprite.initialBounds.element.height}px`;

    for (let keptSprite of [nameSprite, titleSprite]) {
      let delta = keptSprite.boundsDelta;
      assert(
        'keptSprite always have finalBounds and counterpart',
        keptSprite &&
          keptSprite.initialBounds &&
          keptSprite.finalBounds &&
          keptSprite.counterpart &&
          delta
      );

      context.appendOrphan(keptSprite.counterpart);
      keptSprite.counterpart.lockStyles(
        keptSprite.finalBounds.relativeToPosition(keptSprite.finalBounds.parent)
      );
      keptSprite.hide();
      keptSprite.counterpart.setupAnimation('style', {
        property: 'fontSize',
        delay: TRANSLATE_START,
        duration: TRANSLATE_DURATION,
      });
      keptSprite.counterpart.setupAnimation('position', {
        startX: -delta.x,
        startY: -delta.y,
        endX: 0,
        endY: 0,
        delay: TRANSLATE_START,
        duration: TRANSLATE_DURATION,
      });
      keptSprite.counterpart.setupAnimation('size', {
        delay: TRANSLATE_START,
        duration: TRANSLATE_DURATION,
      });
      let animation = keptSprite.counterpart.startAnimation();
      animations.push(animation);
    }

    context.appendOrphan(cardSprite);
    cardSprite.lockStyles();
    cardSprite.setupAnimation('opacity', {
      to: 0,
      duration: FADE_OUT_DURATION,
    });
    animations.push(cardSprite.startAnimation());

    for (let insertedSprite of [...insertedSprites]) {
      insertedSprite.setupAnimation('opacity', {
        delay: FADE_IN_START,
        duration: FADE_IN_DURATION,
      });
      let animation = insertedSprite.startAnimation();
      animations.push(animation);
    }

    return Promise.all(animations.map((a) => a.finished)).then(() => {
      for (let keptSprite of [...keptSprites]) {
        keptSprite.unlockStyles();
      }
    });
  } else {
    let cardSprite = changeset.spriteFor({
      type: SpriteType.Inserted,
      role: 'card',
    });
    assert('cardSprite is found', !!cardSprite);
    cardSprite.setupAnimation('opacity', {
      delay: FADE_IN_START,
      duration: FADE_IN_DURATION,
    });
    let animation = cardSprite.startAnimation();
    animations.push(animation);
    for (let keptSprite of [...keptSprites]) {
      assert(
        'keptSprite always has an counterpart, initialBounds and finalBounds',
        keptSprite.counterpart &&
          keptSprite.initialBounds &&
          keptSprite.finalBounds
      );
      let initialBounds = keptSprite.initialBounds.relativeToPosition(
        keptSprite.finalBounds.parent
      );
      let finalBounds = keptSprite.finalBounds.relativeToPosition(
        keptSprite.finalBounds.parent
      );
      keptSprite.hide();

      let deltaX = initialBounds.left - finalBounds.left;
      let deltaY = initialBounds.top - finalBounds.top;

      context.appendOrphan(keptSprite.counterpart);
      keptSprite.counterpart.lockStyles(
        keptSprite.finalBounds.relativeToPosition(keptSprite.finalBounds.parent)
      );
      keptSprite.counterpart.setupAnimation('position', {
        startX: deltaX,
        startY: deltaY,
        endX: 0,
        endY: 0,
        delay: TRANSLATE_START,
        duration: TRANSLATE_DURATION,
      });
      keptSprite.counterpart.setupAnimation('style', {
        property: 'fontSize',
        delay: TRANSLATE_START,
        duration: TRANSLATE_DURATION,
      });
      let animation = keptSprite.counterpart.startAnimation();
      animations.push(animation);
    }

    for (let removedSprite of [...removedSprites]) {
      removedSprite.lockStyles();
      context.appendOrphan(removedSprite);
      removedSprite.setupAnimation('opacity', {
        to: 0,
        duration: FADE_OUT_DURATION,
      });
      let animation = removedSprite.startAnimation();
      animations.push(animation);
    }

    return Promise.all(animations.map((a) => a.finished)).then(() => {
      for (let keptSprite of [...keptSprites]) {
        keptSprite.unlockStyles();
      }
    });
  }
}
