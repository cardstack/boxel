import { assert } from '@ember/debug';
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

export default function listTransition({
  context,
  insertedSprites,
  keptSprites,
  removedSprites,
}: Changeset): Promise<void> {
  assert('context has an orphansElement', context.orphansElement);
  let animations = [];
  let direction = 'to-list';
  if (
    Array.from(insertedSprites).any(
      (s) => !!(s.id && /person:.+:card/.test(s.id))
    )
  ) {
    direction = 'to-detail';
  }

  if (direction === 'to-list') {
    for (let keptSprite of Array.from(keptSprites)) {
      assert('keptSprite is not null', !!keptSprite);
      assert(
        'keptSprites always have intialBounds',
        !!keptSprite.initialBounds
      );
      assert('keptSprites always have finalBounds', !!keptSprite.finalBounds);
      assert('keptSprites always have a counterpart', !!keptSprite.counterpart);
      let initialBounds = keptSprite.initialBounds.relativeToContext;
      let finalBounds = keptSprite.finalBounds.relativeToContext;
      let deltaX = initialBounds.left - finalBounds.left;
      let deltaY = initialBounds.top - finalBounds.top;

      let clonedNode = keptSprite.counterpart.element.cloneNode(true);
      let clone: HTMLElement = clonedNode as HTMLElement;
      keptSprite.counterpart.element.style.opacity = '0';

      context.orphansElement.appendChild(clone);
      clone.style.position = 'absolute';
      let cloneBounds = keptSprite.finalBounds.relativeToPosition(
        keptSprite.finalBounds.parent
      );
      clone.style.left = cloneBounds.left + 'px';
      clone.style.top = cloneBounds.top + 'px';

      let initialFontSize = getComputedStyle(clone).fontSize;
      let finalFontSize = getComputedStyle(keptSprite.element).fontSize;
      keptSprite.element.style.opacity = '0';
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
        { transform: 'translate(0, 0)', fontSize: finalFontSize },
      ];

      let animation = clone.animate(translationKeyFrames, {
        duration: TOTAL_DURATION,
      });
      animations.push(animation);
    }

    for (let removedSprite of Array.from(removedSprites)) {
      removedSprite.lockStyles();
      context.orphansElement.appendChild(removedSprite.element);
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

    for (let insertedSprite of Array.from(insertedSprites)) {
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
      context.clearOrphans();
      for (let keptSprite of Array.from(keptSprites)) {
        keptSprite.element.style.removeProperty('opacity');
      }
    });
  } else {
    for (let insertedSprite of Array.from(insertedSprites)) {
      if (insertedSprite.id?.endsWith(':card')) {
        let animation = insertedSprite.element.animate(
          [
            { opacity: 0 },
            { opacity: 0, offset: FADE_IN_START / TOTAL_DURATION },
            {
              opacity: 1,
            },
          ],
          {
            duration: TOTAL_DURATION,
          }
        );
        animations.push(animation);
      }
    }
    for (let keptSprite of Array.from(keptSprites)) {
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
      keptSprite.element.style.opacity = '0';

      let deltaX = initialBounds.left - finalBounds.left;
      let deltaY = initialBounds.top - finalBounds.top;

      context.orphansElement.appendChild(keptSprite.counterpart.element);
      let initialFontSize = getComputedStyle(keptSprite.counterpart.element)
        .fontSize;
      context.orphansElement.removeChild(keptSprite.counterpart.element);
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
      context.orphansElement.appendChild(keptSprite.counterpart.element);
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

    for (let removedSprite of Array.from(removedSprites)) {
      removedSprite.lockStyles();
      context.orphansElement.appendChild(removedSprite.element);
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
      context.clearOrphans();
      for (let keptSprite of Array.from(keptSprites)) {
        assert('keptSprite always has a counterpart', keptSprite.counterpart);
        keptSprite.element.style.removeProperty('opacity');
      }
    });
  }
}
