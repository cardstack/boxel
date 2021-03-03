// FADE OUT : ----------
// TRANSLATE:     ----------
// FADE IN  :          ----------

import { assert } from '@ember/debug';
import Changeset from '../models/changeset';

// const FADE_OUT_START = 0;
const FADE_OUT_DURATION = 1000;
const TRANSLATE_DURATION = 1000;
const TRANSLATE_START = 400;
const FADE_IN_DURATION = 1000;
const FADE_IN_START = 900;
const TOTAL_DURATION = FADE_IN_START + FADE_IN_DURATION;

export default function detailTransition({
  context,
  insertedSprites,
  receivedSprites,
  removedSprites,
}: Changeset): Promise<void> {
  assert('context has an orphansElement', context.orphansElement);
  let animations = [];
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
  for (let receivedSprite of Array.from(receivedSprites)) {
    assert(
      'receivedSprite always has an counterpart, initialBounds and finalBounds',
      receivedSprite.counterpart &&
        receivedSprite.initialBounds &&
        receivedSprite.finalBounds
    );
    let initialBounds = receivedSprite.initialBounds.relativeToPosition(
      receivedSprite.finalBounds.parent
    );
    let finalBounds = receivedSprite.finalBounds.relativeToPosition(
      receivedSprite.finalBounds.parent
    );
    receivedSprite.element.style.opacity = '0';

    let deltaX = initialBounds.left - finalBounds.left;
    let deltaY = initialBounds.top - finalBounds.top;

    context.orphansElement.appendChild(receivedSprite.counterpart.element);
    let initialFontSize = getComputedStyle(receivedSprite.counterpart.element)
      .fontSize;
    context.orphansElement.removeChild(receivedSprite.counterpart.element);
    let finalFontSize = getComputedStyle(receivedSprite.element).fontSize;

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
    context.orphansElement.appendChild(receivedSprite.counterpart.element);
    receivedSprite.counterpart.lockStyles(
      receivedSprite.finalBounds.relativeToPosition(
        receivedSprite.finalBounds.parent
      )
    );
    let animation = receivedSprite.counterpart.element.animate(
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

  let listContextElement = document.querySelector(
    '[data-animation-context="list"]'
  );
  assert('listContextElement was found', listContextElement);
  assert('context has an element', context.element);
  if (removedSprites.size) {
    let listContextRect = listContextElement.getBoundingClientRect();
    context.element.style.position = 'absolute';
    context.element.style.top = `${listContextRect.top}px`;
    context.element.style.left = `${listContextRect.left}px`;
    context.element.style.width = `${listContextRect.width}px`;
  }

  return Promise.all(animations.map((a) => a.finished)).then(() => {
    assert('context has an element', context.element);
    context.clearOrphans();
    for (let receivedSprite of Array.from(receivedSprites)) {
      assert(
        'receivedSprite always has a counterpart',
        receivedSprite.counterpart
      );
      receivedSprite.counterpart.unlockStyles();
      receivedSprite.element.style.removeProperty('opacity');
    }
    context.element.style.removeProperty('position');
    context.element.style.removeProperty('top');
    context.element.style.removeProperty('left');
  });
}
