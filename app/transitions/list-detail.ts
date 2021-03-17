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
const TOTAL_DURATION = FADE_IN_START + FADE_IN_DURATION;

export default function listTransition(changeset: Changeset): Promise<void> {
  let { context, insertedSprites, keptSprites, removedSprites } = changeset;
  let animations = [];
  let direction = 'to-list';
  if (changeset.spriteFor({ type: SpriteType.Inserted, role: 'card' })) {
    direction = 'to-detail';
  }

  if (direction === 'to-list') {
    for (let keptSprite of [...keptSprites]) {
      let delta = keptSprite.boundsDelta;
      assert(
        'keptSprite always have finalBounds and counterpart',
        keptSprite &&
          keptSprite.initialBounds &&
          keptSprite.finalBounds &&
          keptSprite.counterpart &&
          delta
      );

      let clone = keptSprite.counterpart.element.cloneNode(true) as HTMLElement;
      keptSprite.counterpart.hide();

      context.appendOrphan(clone);
      clone.style.position = 'absolute';
      let cloneBounds = keptSprite.finalBounds.relativeToPosition(
        keptSprite.finalBounds.parent
      );
      clone.style.left = cloneBounds.left + 'px';
      clone.style.top = cloneBounds.top + 'px';

      let initialFontSize = getComputedStyle(clone).fontSize;
      let finalFontSize = getComputedStyle(keptSprite.element).fontSize;
      keptSprite.hide();
      let translationKeyFrames = [
        {
          transform: `translate(${-delta.x}px, ${-delta.y}px)`,
          fontSize: initialFontSize,
        },
        {
          transform: `translate(${-delta.x}px, ${-delta.y}px)`,
          fontSize: initialFontSize,
          offset: TRANSLATE_START / TOTAL_DURATION,
        },
        {
          transform: 'translate(0, 0)',
          fontSize: finalFontSize,
          offset: (TRANSLATE_START + TRANSLATE_DURATION) / TOTAL_DURATION,
        },
        { transform: 'translate(0, 0)', fontSize: finalFontSize },
      ];

      let animation = clone.animate(translationKeyFrames, {
        duration: TOTAL_DURATION,
      });
      animations.push(animation);
    }

    for (let removedSprite of [...removedSprites]) {
      removedSprite.lockStyles();
      context.appendOrphan(removedSprite);
      let animation = removedSprite.element.animate(
        [
          { opacity: 1 },
          { opacity: 0, offset: FADE_OUT_DURATION / TOTAL_DURATION },
          { opacity: 0 },
        ],
        {
          duration: TOTAL_DURATION,
        }
      );
      animations.push(animation);
    }

    for (let insertedSprite of [...insertedSprites]) {
      let animation = insertedSprite.element.animate(
        [
          { opacity: 0 },
          { opacity: 0, offset: FADE_IN_START / TOTAL_DURATION },
          { opacity: 1 },
        ],
        {
          duration: TOTAL_DURATION,
        }
      );
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
    let animation = cardSprite.element.animate(
      [
        { opacity: 0 },
        { opacity: 0, offset: FADE_IN_START / TOTAL_DURATION },
        { opacity: 1 },
      ],
      {
        duration: TOTAL_DURATION,
      }
    );
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
      let initialFontSize = getComputedStyle(keptSprite.counterpart.element)
        .fontSize;
      context.removeOrphan(keptSprite.counterpart);
      let finalFontSize = getComputedStyle(keptSprite.element).fontSize;

      let translationKeyFrames = [
        {
          transform: `translate(${deltaX}px, ${deltaY}px)`,
          fontSize: initialFontSize,
        },
        {
          transform: `translate(${deltaX}px, ${deltaY}px)`,
          fontSize: initialFontSize,
          offset: TRANSLATE_START / TOTAL_DURATION,
        },
        {
          transform: 'translate(0, 0)',
          fontSize: finalFontSize,
          offset: (TRANSLATE_START + TRANSLATE_DURATION) / TOTAL_DURATION,
        },
        {
          transform: 'translate(0, 0)',
          fontSize: finalFontSize,
        },
      ];
      context.appendOrphan(keptSprite.counterpart);
      keptSprite.counterpart.lockStyles(
        keptSprite.finalBounds.relativeToPosition(keptSprite.finalBounds.parent)
      );
      let animation = keptSprite.counterpart.element.animate(
        translationKeyFrames,
        {
          duration: TOTAL_DURATION,
        }
      );
      animations.push(animation);
    }

    for (let removedSprite of [...removedSprites]) {
      removedSprite.lockStyles();
      context.appendOrphan(removedSprite);
      let animation = removedSprite.element.animate(
        [
          { opacity: 1 },
          { opacity: 0, offset: FADE_OUT_DURATION / TOTAL_DURATION },
          { opacity: 0 },
        ],
        {
          duration: TOTAL_DURATION,
        }
      );
      animations.push(animation);
    }

    return Promise.all(animations.map((a) => a.finished)).then(() => {
      for (let keptSprite of [...keptSprites]) {
        keptSprite.unlockStyles();
      }
    });
  }
}
